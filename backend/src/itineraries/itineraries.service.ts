import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  paginate,
  PaginatedResponse,
  ITINERARY_MAX_DAYS,
  PaginationDto,
  Visibility,
} from '../common';
import { todayUtc } from '../hotels/hotel-availability.rules';
import { HotelSearchPageDto } from '../hotels/dto/hotel-search-response.dto';
import { HotelSearchService } from '../hotels/hotel-search.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ActivitiesService } from './activities.service';
import { BudgetsService } from './budgets.service';
import { TransportCostsService } from './transport-costs.service';
import { UsersService } from '../users/users.service';
import { ActivityDto } from './dto/activity.dto';
import { groupDaysByCity } from './dto/city-group.dto';
import { CreateItineraryDayDto } from './dto/create-itinerary-day.dto';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { GroupHotelsQueryDto } from './dto/group-hotels-query.dto';
import {
  addDays,
  ItineraryDayDto,
  toItineraryDay,
} from './dto/itinerary-day.dto';
import {
  ItineraryResponseDto,
  toItineraryResponse,
} from './dto/itinerary-response.dto';
import {
  ITINERARY_ROW_PROJECTION,
  ItineraryRowDto,
  toItineraryRow,
} from './dto/itinerary-row.dto';
import {
  PublicItineraryRowDto,
  toPublicItineraryRow,
} from './dto/public-itinerary-row.dto';
import { ReorderDaysDto } from './dto/reorder-days.dto';
import { UpdateItineraryDayDto } from './dto/update-itinerary-day.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { Itinerary, ItineraryLean } from './schemas/itinerary.schema';

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name) private readonly model: Model<Itinerary>,
    private readonly referenceData: ReferenceDataService,
    private readonly users: UsersService,
    private readonly activities: ActivitiesService,
    private readonly transportCosts: TransportCostsService,
    private readonly budgets: BudgetsService,
    // ITN-25: the HTL-11 hotel search, reused as it is (see ItinerariesModule for how it is provided).
    private readonly hotelSearch: HotelSearchService,
  ) {}

  /**
   * ITN-01: a registered user creates an itinerary. It is private by default (schema default) and always
   * owned by the caller: the owner comes from the login, never from the request body.
   * (Who may call this is decided by @Roles(Role.USER) on the controller.)
   */
  async create(
    user: AuthenticatedUser,
    dto: CreateItineraryDto,
  ): Promise<ItineraryResponseDto> {
    await this.assertCountriesExist(dto.countryCodes);

    const created = await this.model.create({
      authorId: new Types.ObjectId(user.userId),
      title: dto.title,
      countryCodes: dto.countryCodes,
      startDate: dto.startDate,
    });
    return toItineraryResponse(created.toObject<ItineraryLean>());
  }

  /**
   * ITN-03: the caller's own itineraries, most recently updated first, paginated (GEN-05).
   * The filter is always the caller's id, never a value from the request. Hidden ones are included:
   * their author still sees them. `_id` breaks ties so a row never shows on two pages.
   * The index { authorId: 1, updatedAt: -1 } on the schema serves this query.
   */
  listMine(
    user: AuthenticatedUser,
    query: PaginationDto,
  ): Promise<PaginatedResponse<ItineraryRowDto>> {
    return paginate(
      this.model,
      { authorId: new Types.ObjectId(user.userId) },
      query,
      {
        map: toItineraryRow,
        sort: { updatedAt: -1, _id: -1 },
        projection: ITINERARY_ROW_PROJECTION,
      },
    );
  }

  /**
   * ITN-03: the owner opens one itinerary. Someone else's (even a public one) answers 404 here,
   * like a missing one (ACC-11): this is a private itinerary endpoint. Others find public itineraries
   * through searchPublic (ITN-20) and open them through the public view (ITN-21).
   */
  async findMine(
    user: AuthenticatedUser,
    id: string,
  ): Promise<ItineraryResponseDto> {
    const itinerary = await this.model
      .findOne({ _id: id, authorId: new Types.ObjectId(user.userId) })
      .lean<ItineraryLean>()
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');
    return this.withActivities(itinerary);
  }

  /**
   * ITN-20: the shared search: PUBLIC itineraries that an admin has not hidden and whose author's account is
   * still ACTIVE (ACC-12 hides a suspended or deactivated author's public itineraries), most recently
   * updated first, paginated. Visibility is read on every request, so setting PRIVATE removes an itinerary
   * from the next search on. ITN-21 adds the keyword and duration filters.
   *
   * The author check goes through UsersService.isActive (the Users module's exported method), once per
   * distinct author with public itineraries, so the page and the total count only what is shown.
   */
  async searchPublic(
    query: PaginationDto,
  ): Promise<PaginatedResponse<PublicItineraryRowDto>> {
    const shared = { visibility: Visibility.PUBLIC, isHidden: false };
    const authorIds = (await this.model
      .distinct('authorId', shared)
      .exec()) as Types.ObjectId[];
    const active = await Promise.all(
      authorIds.map((authorId) => this.users.isActive(authorId.toString())),
    );
    const activeAuthorIds = authorIds.filter((_, index) => active[index]);

    return paginate(
      this.model,
      { ...shared, authorId: { $in: activeAuthorIds } },
      query,
      { map: toPublicItineraryRow, sort: { updatedAt: -1, _id: -1 } },
    );
  }

  /**
   * ITN-01: the owner edits title, countries and/or start date. ITN-20: the owner sets visibility.
   * Ownership is part of the filter of ONE atomic update (`_id` AND `authorId`), so there is no
   * read-then-write gap. Someone else's itinerary matches nothing and answers 404 (the same as a missing
   * one), so a private itinerary's existence is not revealed. A public one stays read-only to others.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateItineraryDto,
  ): Promise<ItineraryResponseDto> {
    const changes: Partial<
      Pick<Itinerary, 'title' | 'countryCodes' | 'startDate' | 'visibility'>
    > = {};
    if (dto.title !== undefined) changes.title = dto.title;
    if (dto.countryCodes !== undefined) changes.countryCodes = dto.countryCodes;
    if (dto.startDate !== undefined) changes.startDate = dto.startDate;
    if (dto.visibility !== undefined) changes.visibility = dto.visibility;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        message: 'Nothing to update',
        details: [
          {
            field: 'body',
            message:
              'send at least one of title, countryCodes, startDate, visibility',
          },
        ],
      });
    }
    if (changes.countryCodes) {
      await this.assertCountriesExist(changes.countryCodes);
    }

    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, authorId: new Types.ObjectId(user.userId) },
        { $set: changes },
        { new: true, runValidators: true },
      )
      .lean<ItineraryLean>()
      .exec();
    if (!updated) throw new NotFoundException('Itinerary not found');
    return this.withActivities(updated);
  }

  /**
   * ITN-01: the owner deletes an itinerary. The document is removed, so it can no longer appear in public
   * search. A clone (ITN-21) is a full independent copy with its own id and owner, so deleting the original
   * never touches it. The confirmation step ("are you sure?") is the client's job (GEN-03).
   *
   * Days are embedded, so they go with it. Activities (ITN-10), transport costs (ITN-16) and budget entries
   * (ITN-14) are deleted right after.
   */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const result = await this.model
      .deleteOne({ _id: id, authorId: new Types.ObjectId(user.userId) })
      .exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException('Itinerary not found');
    }
    await this.activities.removeForItinerary(new Types.ObjectId(id));
    await this.transportCosts.removeForItinerary(new Types.ObjectId(id));
    await this.budgets.removeForItinerary(new Types.ObjectId(id));
  }

  /**
   * ITN-05: the owner adds a day at the end of the itinerary. The 60-day limit is part of the filter of ONE
   * atomic update ("there is no element at index 59 yet"), so two requests at 59 days cannot both get in.
   * The new day's number and date are derived from its position and the start date, never stored.
   */
  async addDay(
    user: AuthenticatedUser,
    id: string,
    dto: CreateItineraryDayDto,
  ): Promise<ItineraryDayDto> {
    await this.assertCityExists(dto.cityId);

    const ownerFilter = { _id: id, authorId: new Types.ObjectId(user.userId) };
    const dayId = new Types.ObjectId();
    const updated = await this.model
      .findOneAndUpdate(
        {
          ...ownerFilter,
          [`days.${ITINERARY_MAX_DAYS - 1}`]: { $exists: false },
        },
        {
          $push: {
            days: { _id: dayId, cityId: dto.cityId, notes: dto.notes ?? '' },
          },
        },
        { new: true, runValidators: true },
      )
      .lean<ItineraryLean>()
      .exec();

    if (!updated) {
      // Nothing matched: either not the caller's itinerary (404) or it is full. This read only picks
      // the error; it decides nothing that is then written.
      if (!(await this.model.exists(ownerFilter))) {
        throw new NotFoundException('Itinerary not found');
      }
      throw new BadRequestException({
        message: 'Day limit reached',
        details: [
          {
            field: 'days',
            message: `an itinerary has at most ${ITINERARY_MAX_DAYS} days`,
          },
        ],
      });
    }
    return this.dayResponse(updated, dayId); // a new day has no activities yet
  }

  /**
   * ITN-05: the owner changes a day's city and/or notes. One atomic update whose filter holds the
   * itinerary id, the owner AND the day id; `days.$` is the matched day. Anything else is 404.
   */
  async updateDay(
    user: AuthenticatedUser,
    id: string,
    dayId: string,
    dto: UpdateItineraryDayDto,
  ): Promise<ItineraryDayDto> {
    const changes: Record<string, string> = {};
    if (dto.cityId !== undefined) changes['days.$.cityId'] = dto.cityId;
    if (dto.notes !== undefined) changes['days.$.notes'] = dto.notes;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        message: 'Nothing to update',
        details: [
          { field: 'body', message: 'send at least one of cityId, notes' },
        ],
      });
    }
    if (dto.cityId !== undefined) await this.assertCityExists(dto.cityId);

    const dayObjectId = new Types.ObjectId(dayId);
    const updated = await this.model
      .findOneAndUpdate(
        {
          _id: id,
          authorId: new Types.ObjectId(user.userId),
          'days._id': dayObjectId,
        },
        { $set: changes },
        { new: true, runValidators: true },
      )
      .lean<ItineraryLean>()
      .exec();
    if (!updated) throw new NotFoundException('Itinerary or day not found');
    return this.dayResponse(
      updated,
      dayObjectId,
      await this.activities.listByItinerary(updated._id),
    );
  }

  /**
   * The itinerary response with every day's activities (ITN-10), its transport costs (ITN-16) and its budget
   * entries (ITN-14) filled in.
   */
  private async withActivities(
    itinerary: ItineraryLean,
  ): Promise<ItineraryResponseDto> {
    const [activities, transportCosts, budgets] = await Promise.all([
      this.activities.listByItinerary(itinerary._id),
      this.transportCosts.listByItinerary(itinerary._id),
      this.budgets.listByItinerary(itinerary._id),
    ]);
    return toItineraryResponse(itinerary, activities, transportCosts, budgets);
  }

  /**
   * ITN-08: the owner moves one day to a new position. The move is ONE atomic update (an aggregation-pipeline
   * update), not "read the days, reorder in memory, write them back", so two moves at once can never lose or
   * duplicate a day: each one rebuilds the array from what is stored at that moment.
   *
   * Only the order of the stored days changes. Number, date and city grouping are derived from the position
   * (ITN-05), so they are recalculated by the next read with no extra work, and each day keeps its own
   * id, city and notes. The filter holds the itinerary id, the owner, the day id AND "the position is not
   * after the last day": a stranger or an unknown day is 404, a position past the end is 400.
   */
  async reorderDay(
    user: AuthenticatedUser,
    id: string,
    dto: ReorderDaysDto,
  ): Promise<ItineraryResponseDto> {
    const dayObjectId = new Types.ObjectId(dto.dayId);
    const ownerFilter = {
      _id: id,
      authorId: new Types.ObjectId(user.userId),
      'days._id': dayObjectId,
    };
    const target = dto.position - 1; // 0-based index of the new place
    const dayCount = { $size: { $ifNull: ['$days', []] } };

    const updated = await this.model
      .findOneAndUpdate(
        { ...ownerFilter, $expr: { $lte: [dto.position, dayCount] } },
        [
          {
            $set: {
              days: {
                $let: {
                  vars: {
                    moved: {
                      $filter: {
                        input: '$days',
                        as: 'day',
                        cond: { $eq: ['$$day._id', dayObjectId] },
                      },
                    },
                    rest: {
                      $filter: {
                        input: '$days',
                        as: 'day',
                        cond: { $ne: ['$$day._id', dayObjectId] },
                      },
                    },
                  },
                  // New array, place by place: the moved day goes to `target`; the others keep their order
                  // around it (the ones before `target` stay at their index, the later ones shift by one).
                  in: {
                    $map: {
                      input: { $range: [0, dayCount] },
                      as: 'place',
                      in: {
                        $cond: [
                          { $eq: ['$$place', target] },
                          { $arrayElemAt: ['$$moved', 0] },
                          {
                            $arrayElemAt: [
                              '$$rest',
                              {
                                $cond: [
                                  { $lt: ['$$place', target] },
                                  '$$place',
                                  { $subtract: ['$$place', 1] },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              },
              updatedAt: '$$NOW',
            },
          },
        ],
        { new: true },
      )
      .lean<ItineraryLean>()
      .exec();

    if (!updated) {
      // Nothing matched: not the caller's itinerary or day (404), or the position is past the last day.
      // This read only picks the error; it decides nothing that is then written.
      if (!(await this.model.exists(ownerFilter))) {
        throw new NotFoundException('Itinerary or day not found');
      }
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          {
            field: 'position',
            message: 'position must not be after the last day of the itinerary',
          },
        ],
      });
    }
    return this.withActivities(updated);
  }

  /**
   * ITN-07: the owner deletes one day. ONE atomic update pulls the day out of the array; its filter holds the
   * itinerary id, the owner AND the day id, so a stranger, an unknown day or a day that is already gone all
   * match nothing and answer 404 (two simultaneous deletes of the same day: one wins, the other gets 404).
   *
   * Nothing is renumbered or re-dated in the database: a day's number is its position and its date is the
   * start date + position (ITN-05), so the days after the deleted one move up by themselves, with no gap.
   * The "are you sure?" step is the client's job (GEN-03).
   *
   * Activities (ITN-10), transport costs (ITN-16) and budget entries (ITN-14) that belong to the day live in
   * their own collections, so their rows are deleted here, so budget totals stop counting them. They are
   * deleted right after the day is pulled out.
   */
  async removeDay(
    user: AuthenticatedUser,
    id: string,
    dayId: string,
  ): Promise<void> {
    const dayObjectId = new Types.ObjectId(dayId);
    const updated = await this.model
      .findOneAndUpdate(
        {
          _id: id,
          authorId: new Types.ObjectId(user.userId),
          'days._id': dayObjectId,
        },
        { $pull: { days: { _id: dayObjectId } } },
      )
      .select('_id')
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('Itinerary or day not found');
    await this.activities.removeForDay(updated._id, dayObjectId);
    await this.transportCosts.removeForDay(updated._id, dayObjectId);
    await this.budgets.removeForDay(updated._id, dayObjectId);
  }

  /**
   * ITN-25: the owner picks one city group of their itinerary and sees the hotels that are free for it. The group is
   * the run of consecutive days in one city that starts on `fromDayNumber` (derived on every read, as in ITN-09), so
   * the stay is: check-in = the date of the group's first day, check-out = the day AFTER its last day (the last
   * night is the one of the last day). The search itself is the HTL-11 `HotelSearchService`, called as it is: this
   * method only turns the group into a city and two dates, so the search rules (guests and rooms fit, free for every
   * night, ACTIVE hotels, order, paging) are not written a second time here.
   *
   * Someone else's or an unknown itinerary answers 404. A `fromDayNumber` where no group starts (or an itinerary
   * without days) is a 400 on that field that lists the days where a group does start. A group that is already over
   * is a 400 on the same field too: the hotel search refuses a check-in in the past, and that message would name a
   * parameter the user never sent.
   */
  async hotelsForGroup(
    user: AuthenticatedUser,
    id: string,
    query: GroupHotelsQueryDto,
  ): Promise<HotelSearchPageDto> {
    const itinerary = await this.model
      .findOne({ _id: id, authorId: new Types.ObjectId(user.userId) })
      .lean<ItineraryLean>()
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');

    const groups = groupDaysByCity(
      (itinerary.days ?? []).map((day, index) =>
        toItineraryDay(day, index, itinerary.startDate),
      ),
    );
    const group = groups.find(
      (candidate) => candidate.fromDayNumber === query.fromDayNumber,
    );
    if (!group) {
      throw this.badGroup(
        groups.length === 0
          ? 'the itinerary has no days yet'
          : `no city group starts on day ${query.fromDayNumber}; groups start on days ${groups
              .map((candidate) => candidate.fromDayNumber)
              .join(', ')}`,
      );
    }
    if (group.startDate < todayUtc()) {
      throw this.badGroup(
        `the city group that starts on day ${group.fromDayNumber} began on ${group.startDate}, so its dates are in the past`,
      );
    }

    return this.hotelSearch.search({
      cityId: group.cityId,
      checkIn: group.startDate,
      checkOut: addDays(group.endDate, 1),
      guests: query.guests,
      rooms: query.rooms ?? 1,
      page: query.page,
      limit: query.limit,
    });
  }

  private badGroup(message: string): BadRequestException {
    return new BadRequestException({
      message: 'Validation failed',
      details: [{ field: 'fromDayNumber', message }],
    });
  }

  /** The DTO of one day, numbered by its current position in the saved itinerary. */
  private dayResponse(
    itinerary: ItineraryLean,
    dayId: Types.ObjectId,
    activities: ActivityDto[] = [],
  ): ItineraryDayDto {
    const days = itinerary.days ?? [];
    const index = days.findIndex((day) => day._id.equals(dayId));
    return toItineraryDay(days[index], index, itinerary.startDate, activities);
  }

  /** The city must be in the seeded list shared with hotels and airports (GEN-12). */
  private async assertCityExists(cityId: string): Promise<void> {
    if (!(await this.referenceData.findCityById(cityId))) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'cityId', message: `unknown city: ${cityId}` }],
      });
    }
  }

  /** Every code must be a seeded country (GEN-12). Reports all unknown codes at once as a field-level error. */
  private async assertCountriesExist(codes: string[]): Promise<void> {
    const found = await Promise.all(
      codes.map((code) => this.referenceData.findCountryById(code)),
    );
    const unknown = codes.filter((_, index) => !found[index]);
    if (unknown.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          {
            field: 'countryCodes',
            message: `unknown country code(s): ${unknown.join(', ')}`,
          },
        ],
      });
    }
  }
}
