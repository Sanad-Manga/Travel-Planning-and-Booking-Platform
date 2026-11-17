import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../common';
import { HotelSearchPageDto } from '../hotels/dto/hotel-search-response.dto';
import { todayUtc } from '../hotels/hotel-availability.rules';
import { HotelSearchService } from '../hotels/hotel-search.service';
import { groupDaysByCity } from './dto/city-group.dto';
import { GroupHotelsQueryDto } from './dto/group-hotels-query.dto';
import { addDays, toItineraryDay } from './dto/itinerary-day.dto';
import { Itinerary, ItineraryLean } from './schemas/itinerary.schema';

/** ITN-25: the hotels that are free for one city group of an itinerary, through the HTL-11 hotel search. */
@Injectable()
export class ItineraryHotelsService {
  constructor(
    @InjectModel(Itinerary.name) private readonly model: Model<Itinerary>,
    // The HTL-11 hotel search, reused as it is (see ItinerariesModule for how it is provided).
    private readonly hotelSearch: HotelSearchService,
  ) {}

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
}
