import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  AccountStatus,
  paginate,
  PaginatedResponse,
  Visibility,
} from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { UsersService } from '../users/users.service';
import { ActivitiesService } from './activities.service';
import { BudgetsService } from './budgets.service';
import {
  PublicItineraryRowDto,
  toPublicItineraryRow,
} from './dto/public-itinerary-row.dto';
import {
  PublicItineraryDto,
  toPublicItinerary,
} from './dto/public-itinerary.dto';
import { PublicSearchQueryDto } from './dto/public-search-query.dto';
import { Itinerary, ItineraryLean } from './schemas/itinerary.schema';
import { TransportCostsService } from './transport-costs.service';

/**
 * The shared, read-only side of itineraries (ITN-20, ITN-21): search and the public view, open to guests. What a
 * guest may see is decided here, never in the controller. The private side (create, edit, days) is in
 * ItinerariesService; copying a public itinerary is in ItineraryCloneService.
 */
@Injectable()
export class ItinerariesPublicService {
  constructor(
    @InjectModel(Itinerary.name) private readonly model: Model<Itinerary>,
    private readonly referenceData: ReferenceDataService,
    private readonly users: UsersService,
    private readonly activities: ActivitiesService,
    private readonly transportCosts: TransportCostsService,
    private readonly budgets: BudgetsService,
  ) {}

  /**
   * ITN-20, ITN-21: the shared search: PUBLIC itineraries that an admin has not hidden and whose author's account
   * is still ACTIVE (ACC-12 hides a suspended or deactivated author's public itineraries), most recently
   * updated first, paginated. Visibility is read on every request, so setting PRIVATE removes an itinerary
   * from the next search on.
   *
   * ITN-21 filters (all that are sent must match): `q`, a plain-text keyword (never a pattern) found in the title,
   * in the name of one of its countries or in the name of a city it visits; `minDays` and `maxDays`, the number of
   * days; `countryCode`; `cityId`. The base conditions are always part of the filter, so no combination of
   * filters can show a private, hidden or inactive-author itinerary.
   *
   * The author check goes through UsersService.isActive (the Users module's exported method), once per
   * distinct author with public itineraries, so the page and the total count only what is shown.
   */
  async searchPublic(
    query: PublicSearchQueryDto,
  ): Promise<PaginatedResponse<PublicItineraryRowDto>> {
    const { q, minDays, maxDays, countryCode, cityId } = query;
    if (minDays !== undefined && maxDays !== undefined && minDays > maxDays) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          {
            field: 'minDays',
            message: 'minDays must not be greater than maxDays',
          },
        ],
      });
    }

    const shared = { visibility: Visibility.PUBLIC, isHidden: false };
    const authorIds = (await this.model
      .distinct('authorId', shared)
      .exec()) as Types.ObjectId[];
    const active = await Promise.all(
      authorIds.map((authorId) => this.users.isActive(authorId.toString())),
    );
    const activeAuthorIds = authorIds.filter((_, index) => active[index]);

    const clauses: FilterQuery<Itinerary>[] = [
      { ...shared, authorId: { $in: activeAuthorIds } },
    ];
    if (q) clauses.push(await this.keywordClause(q, shared));
    if (countryCode) clauses.push({ countryCodes: countryCode });
    if (cityId) clauses.push({ 'days.cityId': cityId });
    if (minDays !== undefined || maxDays !== undefined) {
      const dayCount = { $size: { $ifNull: ['$days', []] } };
      clauses.push({
        $expr: {
          $and: [
            ...(minDays !== undefined ? [{ $gte: [dayCount, minDays] }] : []),
            ...(maxDays !== undefined ? [{ $lte: [dayCount, maxDays] }] : []),
          ],
        },
      });
    }

    return paginate(this.model, { $and: clauses }, query, {
      map: toPublicItineraryRow,
      sort: { updatedAt: -1, _id: -1 },
    });
  }

  /**
   * ITN-21: the read-only view of one public itinerary, open to guests: author name, days with their activities, the
   * budget totals and, on a clone, the credit to the original author. It
   * answers 404 for anything that search would not list (private, hidden by an admin, author not ACTIVE, unknown
   * id), so nothing reveals that a private itinerary exists. The author's account is read here too, because the
   * view shows the name.
   */
  async findPublic(id: string): Promise<PublicItineraryDto> {
    const { itinerary, author } = await this.loadPublic(id);
    const [activities, transportCosts, budgets] = await Promise.all([
      this.activities.listByItinerary(itinerary._id),
      this.transportCosts.listByItinerary(itinerary._id),
      this.budgets.listByItinerary(itinerary._id),
    ]);
    return toPublicItinerary(
      itinerary,
      { id: itinerary.authorId.toString(), name: author.name },
      activities,
      transportCosts,
      budgets,
    );
  }

  /**
   * The public itinerary that the read-only view and the clone work from, with its author's account: 404 for
   * anything search would not list (private, hidden by an admin, author not ACTIVE, unknown id).
   */
  async loadPublic(
    id: string,
  ): Promise<{ itinerary: ItineraryLean; author: { name: string } }> {
    const itinerary = await this.model
      .findOne({ _id: id, visibility: Visibility.PUBLIC, isHidden: false })
      .lean<ItineraryLean>()
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');

    const author = await this.users.findById(itinerary.authorId.toString());
    if (!author || author.status !== AccountStatus.ACTIVE) {
      throw new NotFoundException('Itinerary not found');
    }
    return { itinerary, author };
  }

  /**
   * The filter for the keyword: it matches when the title contains it, one of the itinerary's countries has a name
   * containing it, or it visits a city whose name contains it. Country and city names come from the reference
   * data (never read from its collections here); only the cities that public itineraries actually use are
   * looked up. The keyword is escaped, so it is always plain text.
   */
  private async keywordClause(
    keyword: string,
    shared: { visibility: Visibility; isHidden: boolean },
  ): Promise<FilterQuery<Itinerary>> {
    const pattern = new RegExp(
      keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i',
    );
    const [countries, usedCityIds] = await Promise.all([
      this.referenceData.listCountries(),
      this.model.distinct('days.cityId', shared).exec() as Promise<string[]>,
    ]);
    const cities = await Promise.all(
      usedCityIds.map((cityId) => this.referenceData.findCityById(cityId)),
    );
    return {
      $or: [
        { title: pattern },
        {
          countryCodes: {
            $in: countries
              .filter((country) => pattern.test(country.name))
              .map((country) => country.code),
          },
        },
        {
          'days.cityId': {
            $in: cities.flatMap((city) =>
              city && pattern.test(city.name) ? [city.city_id] : [],
            ),
          },
        },
      ],
    };
  }
}
