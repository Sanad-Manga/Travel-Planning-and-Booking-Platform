import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../common';
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

  /** The owner deletes an activity. Someone else's, an unknown one and one already deleted all answer 404. */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const result = await this.model
      .deleteOne({ _id: id, ownerId: new Types.ObjectId(user.userId) })
      .exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException('Activity not found');
    }
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

  /** Called when an itinerary is deleted: its activities go with it. */
  async removeForItinerary(itineraryId: Types.ObjectId): Promise<void> {
    await this.model.deleteMany({ itineraryId }).exec();
  }

  /** Called when one day is deleted (ITN-07): the activities of that day go with it, the other days keep theirs. */
  async removeForDay(
    itineraryId: Types.ObjectId,
    dayId: Types.ObjectId,
  ): Promise<void> {
    await this.model.deleteMany({ itineraryId, dayId }).exec();
  }
}
