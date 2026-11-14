import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../common';
import { UploadFile, UploadService } from '../uploads';
import { ActivityDto, toActivityDto } from './dto/activity.dto';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { Itinerary } from './schemas/itinerary.schema';
import { Activity, ActivityLean } from './schemas/activity.schema';

/**
 * ITN-10: the activities planned for the days of an itinerary. Every write is ONE query whose filter holds the
 * caller as owner, so there is no read-then-write gap and someone else's row matches nothing (404, the same
 * as a missing one, so its existence is not revealed).
 */
@Injectable()
export class ActivitiesService {
  constructor(
    @InjectModel(Activity.name)
    private readonly model: Model<Activity>,
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    private readonly uploads: UploadService,
  ) {}

  /**
   * The owner adds an activity to one of the days of their itinerary. The itinerary id, the owner and the day id
   * must all match one itinerary, or the answer is 404. The new row copies the owner from the itinerary filter
   * (the caller), the itinerary id and the day id come from the URL, never from the body.
   */
  async create(
    user: AuthenticatedUser,
    itineraryId: string,
    dayId: string,
    dto: CreateActivityDto,
  ): Promise<ActivityDto> {
    const ownerId = new Types.ObjectId(user.userId);
    const dayObjectId = new Types.ObjectId(dayId);
    const hasDay = await this.itineraries.exists({
      _id: itineraryId,
      authorId: ownerId,
      'days._id': dayObjectId,
    });
    if (!hasDay) throw new NotFoundException('Itinerary or day not found');

    const created = await this.model.create({
      itineraryId: new Types.ObjectId(itineraryId),
      dayId: dayObjectId,
      ownerId,
      name: dto.name,
      description: dto.description ?? '',
      ...(dto.time !== undefined && { time: dto.time }),
      ...(dto.costCents !== undefined && { costCents: dto.costCents }),
    });
    return toActivityDto(created.toObject<ActivityLean>());
  }

  /**
   * The owner edits an activity: name, description, time and/or cost. `null` clears the time or the cost (the
   * field is removed, so the activity counts as "no time" / "no cost"). Ownership is in the filter of the one
   * atomic update; someone else's activity or an unknown id matches nothing and answers 404.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateActivityDto,
  ): Promise<ActivityDto> {
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.description !== undefined) set.description = dto.description;
    if (dto.time === null) unset.time = 1;
    else if (dto.time !== undefined) set.time = dto.time;
    if (dto.costCents === null) unset.costCents = 1;
    else if (dto.costCents !== undefined) set.costCents = dto.costCents;

    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
      throw new BadRequestException({
        message: 'Nothing to update',
        details: [
          {
            field: 'body',
            message: 'send at least one of name, description, time, costCents',
          },
        ],
      });
    }

    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, ownerId: new Types.ObjectId(user.userId) },
        {
          ...(Object.keys(set).length > 0 && { $set: set }),
          ...(Object.keys(unset).length > 0 && { $unset: unset }),
        },
        { new: true, runValidators: true },
      )
      .lean<ActivityLean>()
      .exec();
    if (!updated) throw new NotFoundException('Activity not found');
    return toActivityDto(updated);
  }

  /**
   * The owner deletes an activity. Someone else's, an unknown one and one already deleted all answer 404. The
   * images of the activity (ITN-12) are deleted from the upload service right after.
   */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const deleted = await this.model
      .findOneAndDelete({ _id: id, ownerId: new Types.ObjectId(user.userId) })
      .select('images')
      .lean<{ images?: { id: string }[] }>()
      .exec();
    if (!deleted) throw new NotFoundException('Activity not found');
    await this.removeStoredImages(deleted.images ?? []);
  }

  /**
   * ITN-12: the owner attaches one image to their activity. The activity is looked up with the owner in the filter
   * first (404), then the shared UploadService validates and stores the file: JPG/PNG, 5 MB, at most 5 per
   * activity (400 for a bad file, 409 when the 5 places are taken). Only then is the reference saved on the
   * activity; if that fails, or the activity was deleted in between, the stored file is removed again.
   */
  async attachImage(
    user: AuthenticatedUser,
    id: string,
    file: UploadFile,
  ): Promise<ActivityDto> {
    const ownerFilter = { _id: id, ownerId: new Types.ObjectId(user.userId) };
    if (!(await this.model.exists(ownerFilter))) {
      throw new NotFoundException('Activity not found');
    }

    const reference = await this.uploads.save(file, {
      kind: 'activity',
      ownerId: id,
    });
    try {
      const updated = await this.model
        .findOneAndUpdate(
          ownerFilter,
          { $push: { images: { id: reference.id, url: reference.url } } },
          { new: true },
        )
        .lean<ActivityLean>()
        .exec();
      if (!updated) {
        await this.removeStoredImages([reference]);
        throw new NotFoundException('Activity not found');
      }
      return toActivityDto(updated);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.removeStoredImages([reference]);
      }
      throw error;
    }
  }

  /**
   * ITN-12: the owner removes one image of their activity. The image id must be one of the images stored on that
   * activity (so nobody can delete another entity's file through this route): the activity is found by id, owner
   * AND image id (404 otherwise). The file is removed first, which is safe to repeat, then the reference is
   * pulled in one conditional update, so a failure in between can simply be retried.
   */
  async removeImage(
    user: AuthenticatedUser,
    id: string,
    imageId: string,
  ): Promise<void> {
    const filter = {
      _id: id,
      ownerId: new Types.ObjectId(user.userId),
      'images.id': imageId,
    };
    if (!(await this.model.exists(filter))) {
      throw new NotFoundException('Activity or image not found');
    }
    await this.uploads.remove(imageId);
    const pulled = await this.model
      .findOneAndUpdate(filter, { $pull: { images: { id: imageId } } })
      .select('_id')
      .lean()
      .exec();
    if (!pulled) throw new NotFoundException('Activity or image not found');
  }

  /**
   * All activities of an itinerary, for showing them under their days. Ordered by time of day (activities
   * without a time last), then in the order they were added (`_id` grows with creation time). The caller has
   * already checked that the itinerary may be read, so this does not check ownership.
   */
  async listByItinerary(itineraryId: Types.ObjectId): Promise<ActivityDto[]> {
    const rows = await this.model
      .find({ itineraryId })
      .sort({ _id: 1 })
      .lean<ActivityLean[]>()
      .exec();
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const timeA = a.row.time ?? '';
        const timeB = b.row.time ?? '';
        if (timeA === timeB) return a.index - b.index;
        if (!timeA) return 1;
        if (!timeB) return -1;
        return timeA < timeB ? -1 : 1;
      })
      .map(({ row }) => toActivityDto(row));
  }

  /**
   * ITN-21: copies the activities of a public itinerary into its clone. `dayIds` maps each day of the original to the
   * matching day of the clone; a row of a day that is not in the map (a leftover of a deleted day) is skipped. The copy
   * belongs to `ownerId`. Images are NOT copied: a stored file is deleted with the activity it is attached to, so a
   * file shared by two activities would vanish from the clone when the original is edited or deleted.
   */
  async copyForClone(
    fromItineraryId: Types.ObjectId,
    toItineraryId: Types.ObjectId,
    ownerId: Types.ObjectId,
    dayIds: Map<string, Types.ObjectId>,
  ): Promise<void> {
    const rows = await this.model
      .find({ itineraryId: fromItineraryId })
      .sort({ _id: 1 })
      .lean<ActivityLean[]>()
      .exec();
    const copies = rows.flatMap((row) => {
      const dayId = dayIds.get(row.dayId.toString());
      if (!dayId) return [];
      return [
        {
          itineraryId: toItineraryId,
          dayId,
          ownerId,
          name: row.name,
          description: row.description,
          ...(row.time !== undefined && { time: row.time }),
          ...(row.costCents !== undefined && { costCents: row.costCents }),
        },
      ];
    });
    if (copies.length > 0) await this.model.insertMany(copies);
  }

  /** Called when an itinerary is deleted: its activities, and their stored images, go with it. */
  async removeForItinerary(itineraryId: Types.ObjectId): Promise<void> {
    await this.removeWhere({ itineraryId });
  }

  /** Called when one day is deleted (ITN-07): the activities of that day go with it, the other days keep theirs. */
  async removeForDay(
    itineraryId: Types.ObjectId,
    dayId: Types.ObjectId,
  ): Promise<void> {
    await this.removeWhere({ itineraryId, dayId });
  }

  /** Deletes the matching activities, then their images from the upload service (ITN-12). */
  private async removeWhere(filter: {
    itineraryId: Types.ObjectId;
    dayId?: Types.ObjectId;
  }): Promise<void> {
    const withImages = await this.model
      .find({ ...filter, 'images.0': { $exists: true } })
      .select('images')
      .lean<{ images: { id: string }[] }[]>()
      .exec();
    await this.model.deleteMany(filter).exec();
    await this.removeStoredImages(withImages.flatMap((row) => row.images));
  }

  /**
   * Removes stored files from the upload service. A failure is not reported to the caller: the row that referred
   * to the file is already gone, and the upload service retries what it could not finish (its deleting state).
   */
  private async removeStoredImages(images: { id: string }[]): Promise<void> {
    await Promise.allSettled(
      images.map((image) => this.uploads.remove(image.id)),
    );
  }
}
