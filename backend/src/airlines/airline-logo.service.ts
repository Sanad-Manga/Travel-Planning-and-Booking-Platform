import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthenticatedUser, Role } from '../common';
import { UploadFile, UploadService } from '../uploads';
import { AirlineLogoDto } from './dto/airline-logo.dto';
import { Airline } from './schemas/airline.schema';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * GEN-08: the moderator of an airline uploads THE logo of their airline (one per airline) and removes it.
 * The shared UploadService checks the file (JPG/PNG, real image, 5 MB) and keeps a single numbered slot per airline,
 * so two uploads at the same time can never both succeed. A second logo is refused with 409 until the first one is
 * removed: replacing in one step would have to delete the old file before the new one is known to be valid.
 */
@Injectable()
export class AirlineLogoService {
  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    private readonly uploads: UploadService,
  ) {}

  /**
   * 403 unless the caller is the moderator of this very airline (airline profiles are public, so nothing to hide),
   * 404 if the airline is gone. If the push of the reference fails, or the airline has a logo already, the freshly
   * stored file is removed again.
   */
  async attach(
    id: string,
    actor: AuthenticatedUser,
    file: UploadFile,
  ): Promise<AirlineLogoDto> {
    this.assertOwner(id, actor);
    if (!(await this.airlines.exists({ _id: id })))
      throw new NotFoundException('Airline not found');

    const logo = await this.uploads.save(file, {
      kind: 'airline',
      ownerId: id,
    });
    try {
      // One conditional update: only an airline without a logo takes it.
      const result = await this.airlines
        .updateOne(
          { _id: id, logoId: { $exists: false } },
          { $set: { logoId: logo.id, logoUrl: logo.url } },
        )
        .exec();
      if (result.matchedCount === 1) return logo;
    } catch (error) {
      await this.removeFile(id, logo.id);
      throw error;
    }
    await this.removeFile(id, logo.id);
    throw new ConflictException(
      'The airline already has a logo; remove it first',
    );
  }

  /** Removes the logo: the file first (safe to repeat), then the reference in one conditional update. */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    this.assertOwner(id, actor);
    const airline = await this.airlines
      .findOne({ _id: id })
      .select('logoId')
      .lean<{ logoId?: string }>()
      .exec();
    if (!airline?.logoId)
      throw new NotFoundException('Airline or logo not found');

    await this.removeFile(id, airline.logoId);
    const result = await this.airlines
      .updateOne(
        { _id: id, logoId: airline.logoId },
        { $unset: { logoId: '', logoUrl: '' } },
      )
      .exec();
    if (result.matchedCount === 0)
      throw new NotFoundException('Airline or logo not found');
  }

  private assertOwner(id: string, actor: AuthenticatedUser): void {
    if (
      actor.role !== Role.AIRLINE_MODERATOR ||
      actor.airlineId !== id ||
      !OBJECT_ID.test(id)
    ) {
      throw new ForbiddenException(
        'You can only manage the logo of your own airline',
      );
    }
  }

  // removeForTarget only deletes a file that the upload service stored for THIS airline.
  private async removeFile(airlineId: string, logoId: string): Promise<void> {
    if (!OBJECT_ID.test(logoId)) return;
    await this.uploads.removeForTarget(logoId, {
      kind: 'airline',
      ownerId: airlineId,
    });
  }
}
