import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, Visibility } from '../common';
import { ActivitiesService } from './activities.service';
import { BudgetsService } from './budgets.service';
import { ItineraryResponseDto } from './dto/itinerary-response.dto';
import { ItinerariesPublicService } from './itineraries-public.service';
import { ItinerariesService } from './itineraries.service';
import { Itinerary, ItineraryLean } from './schemas/itinerary.schema';
import { TransportCostsService } from './transport-costs.service';

/** ITN-21: a registered user copies a public itinerary into a private one of their own. */
@Injectable()
export class ItineraryCloneService {
  constructor(
    @InjectModel(Itinerary.name) private readonly model: Model<Itinerary>,
    private readonly publicItineraries: ItinerariesPublicService,
    private readonly itineraries: ItinerariesService,
    private readonly activities: ActivitiesService,
    private readonly transportCosts: TransportCostsService,
    private readonly budgets: BudgetsService,
  ) {}

  /**
   * ITN-21: a registered user copies a public itinerary into a new one of their own. The copy is PRIVATE, belongs to
   * the caller and has its own id, its own days (new ids) and its own activities, transport costs and daily budget
   * entries, so editing or deleting either one never touches the other. It carries the credit (`clonedFrom`): the
   * original itinerary and its author's name, as they were at that moment. Images of activities are not copied (see
   * ActivitiesService.copyForClone).
   *
   * Only what the public view shows can be cloned: anything else (private, hidden by an admin, author not active,
   * unknown id) answers 404, like the view. The author may copy their own public itinerary too.
   *
   * The copy is made in steps, not in one transaction: the new itinerary first, then its rows. If copying the rows
   * fails, the new itinerary and whatever was copied are removed again, so a failed clone leaves nothing behind.
   */
  async clone(
    user: AuthenticatedUser,
    id: string,
  ): Promise<ItineraryResponseDto> {
    const { itinerary: source, author } =
      await this.publicItineraries.loadPublic(id);
    const ownerId = new Types.ObjectId(user.userId);

    // Each embedded day gets a new id; the rows that hang on a day are moved onto the matching new day.
    const dayIds = new Map(
      (source.days ?? []).map((day) => [
        day._id.toString(),
        new Types.ObjectId(),
      ]),
    );
    const created = await this.model.create({
      authorId: ownerId,
      title: source.title,
      countryCodes: source.countryCodes,
      startDate: source.startDate,
      visibility: Visibility.PRIVATE,
      days: (source.days ?? []).map((day) => ({
        _id: dayIds.get(day._id.toString()),
        cityId: day.cityId,
        notes: day.notes,
      })),
      clonedFrom: {
        itineraryId: source._id,
        authorId: source.authorId,
        authorName: author.name,
      },
    });

    // Wait for ALL three copies to finish, even when one fails: with Promise.all the clean-up below could run while
    // another copy is still inserting, and those rows would be left behind with no itinerary.
    const copies = await Promise.allSettled([
      this.activities.copyForClone(source._id, created._id, ownerId, dayIds),
      this.transportCosts.copyForClone(
        source._id,
        created._id,
        ownerId,
        dayIds,
      ),
      this.budgets.copyForClone(source._id, created._id, ownerId, dayIds),
    ]);
    const failed = copies.find((copy) => copy.status === 'rejected');
    if (failed) {
      await Promise.allSettled([
        this.activities.removeForItinerary(created._id),
        this.transportCosts.removeForItinerary(created._id),
        this.budgets.removeForItinerary(created._id),
        this.model.deleteOne({ _id: created._id }).exec(),
      ]);
      throw failed.reason;
    }
    return this.itineraries.withActivities(created.toObject<ItineraryLean>());
  }
}
