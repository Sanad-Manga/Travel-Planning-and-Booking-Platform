import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, Role } from '../common';
import { UploadFile, UploadService } from '../uploads';
import { HotelPhotoDto } from './dto/create-hotel.dto';
import { Hotel } from './schemas/hotel.schema';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * GEN-08: the moderator of a hotel attaches photos to THEIR hotel and removes them. Same pattern as the post and
 * activity images. The shared UploadService checks the file (JPG/PNG, real image, 5 MB) and the limit of 5 photos
 * per hotel: it keeps one numbered slot per photo, so two uploads at the same time can never both take the 5th.
 */
@Injectable()
export class HotelPhotosService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly uploads: UploadService,
  ) {}

  /**
   * 403 unless the caller is the moderator of this very hotel (hotel profiles are public, so nothing to hide), 404
   * if their hotel is gone. Then the upload service validates and stores the file (400 bad file, 409 when the 5
   * places are taken) and only then is the reference pushed. If that push fails, or the hotel disappeared in
   * between, the stored file is removed again.
   */
  async attach(
    id: string,
    actor: AuthenticatedUser,
    file: UploadFile,
  ): Promise<HotelPhotoDto> {
    this.assertOwner(id, actor);
    if (!(await this.hotels.exists({ _id: id })))
      throw new NotFoundException('Hotel not found');

    const photo = await this.uploads.save(file, { kind: 'hotel', ownerId: id });
    try {
      const result = await this.hotels
        .updateOne(
          { _id: id },
          { $push: { photos: { id: photo.id, url: photo.url } } },
        )
        .exec();
      if (result.matchedCount === 1) return photo;
    } catch (error) {
      await this.removeFile(id, photo.id);
      throw error;
    }
    await this.removeFile(id, photo.id);
    throw new NotFoundException('Hotel not found');
  }

  /**
   * The photo must be one of this hotel's photos (404 otherwise), so nobody can delete another entity's file
   * through this route. The file is removed first (safe to repeat), then the reference is pulled in one
   * conditional update, so a failure in between can simply be retried.
   */
  async remove(
    id: string,
    photoId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    this.assertOwner(id, actor);
    const filter = { _id: id, 'photos.id': photoId };
    if (!(await this.hotels.exists(filter)))
      throw new NotFoundException('Hotel or photo not found');

    await this.removeFile(id, photoId);
    const result = await this.hotels
      .updateOne(filter, { $pull: { photos: { id: photoId } } })
      .exec();
    if (result.matchedCount === 0)
      throw new NotFoundException('Hotel or photo not found');
  }

  private assertOwner(id: string, actor: AuthenticatedUser): void {
    if (actor.role !== Role.HOTEL_MODERATOR)
      throw new ForbiddenException(
        'Only a hotel moderator can manage hotel photos',
      );
    if (actor.hotelId !== id || !OBJECT_ID.test(id))
      throw new ForbiddenException(
        'You can only manage the photos of your own hotel',
      );
  }

  // removeForTarget only deletes a file that the upload service stored for THIS hotel.
  private async removeFile(hotelId: string, photoId: string): Promise<void> {
    if (!OBJECT_ID.test(photoId)) return;
    await this.uploads.removeForTarget(photoId, {
      kind: 'hotel',
      ownerId: new Types.ObjectId(hotelId).toString(),
    });
  }
}
