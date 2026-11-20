import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, paginate, PaginatedResponse, PaginationDto } from '../common';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { ItinerariesPublicService } from '../itineraries/itineraries-public.service';
import { AddFavouriteDto } from './dto/add-favourite.dto';
import { FavouriteDto } from './dto/favourite-response.dto';
import { Favourite, FavouriteType } from './schemas/favourite.schema';

type LeanFavourite = Favourite & { _id: Types.ObjectId };

const OBJECT_ID = /^[0-9a-f]{24}$/i;

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

/**
 * BON-02: a registered user's favourites (hotels and public itineraries). Every query is filtered on the caller's
 * id, never on a value from the request, so a user only ever sees and changes their own list.
 * Read only towards other modules: hotels through the Hotel model that HotelsModule exports, itineraries through
 * ItinerariesPublicService (the same "is it public?" rule as GET /api/itineraries/public/:id).
 */
@Injectable()
export class FavouritesService {
  constructor(
    @InjectModel(Favourite.name) private readonly favourites: Model<Favourite>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly publicItineraries: ItinerariesPublicService,
  ) {}

  /**
   * Save an item. 404 when the hotel does not exist or is deactivated, or the itinerary is not public (private,
   * hidden, unknown, author not active). Saving the same item again does not add a second row: the unique index
   * rejects it (also for two requests at the same time) and the existing favourite is returned with created=false.
   */
  async add(dto: AddFavouriteDto, actor: AuthenticatedUser): Promise<{ favourite: FavouriteDto; created: boolean }> {
    const name = await this.availableName(dto.type, dto.itemId);
    const key = { userId: new Types.ObjectId(actor.userId), type: dto.type, itemId: new Types.ObjectId(dto.itemId) };
    try {
      const doc = await this.favourites.create(key);
      return { favourite: this.toDto(doc.toObject(), name), created: true };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await this.favourites.findOne(key).lean<LeanFavourite>().exec();
      if (!existing) throw error;
      return { favourite: this.toDto(existing, name), created: false };
    }
  }

  /**
   * The caller's list, newest first, paginated. Names are looked up per page: hotels in one query, itineraries
   * through the public service. An item that is no longer available stays in the list with available=false and
   * no name, so nothing private (e.g. the title of an itinerary made private) is shown.
   */
  async list(query: PaginationDto, actor: AuthenticatedUser): Promise<PaginatedResponse<FavouriteDto>> {
    const page = await paginate(this.favourites, { userId: new Types.ObjectId(actor.userId) }, query, {
      map: (doc: LeanFavourite) => doc,
      sort: { createdAt: -1, _id: -1 },
    });
    const names = await this.namesFor(page.items);
    return { ...page, items: page.items.map((doc) => this.toDto(doc, names.get(doc.itemId.toString()) ?? null)) };
  }

  /** Remove one of the caller's favourites. Someone else's, unknown or malformed id: 404. */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    if (!OBJECT_ID.test(id)) throw new NotFoundException('Favourite not found');
    const result = await this.favourites.deleteOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(actor.userId) }).exec();
    if (result.deletedCount === 0) throw new NotFoundException('Favourite not found');
  }

  /** The item's display name when it may be saved, else 404. */
  private async availableName(type: FavouriteType, itemId: string): Promise<string> {
    if (type === FavouriteType.HOTEL) {
      const hotel = await this.hotels.findOne({ _id: itemId, isActive: true }).select('name').lean().exec();
      if (!hotel) throw new NotFoundException('Hotel not found');
      return hotel.name;
    }
    // Throws 404 "Itinerary not found" for anything public search would not list.
    const { itinerary } = await this.publicItineraries.loadPublic(itemId);
    return itinerary.title;
  }

  /** item id -> name, only for the items that are still available. */
  private async namesFor(items: LeanFavourite[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const hotelIds = items.filter((f) => f.type === FavouriteType.HOTEL).map((f) => f.itemId);
    if (hotelIds.length > 0) {
      const hotels = await this.hotels.find({ _id: { $in: hotelIds }, isActive: true }).select('name').lean().exec();
      hotels.forEach((hotel) => names.set(hotel._id.toString(), hotel.name));
    }
    const itineraryIds = items.filter((f) => f.type === FavouriteType.ITINERARY).map((f) => f.itemId.toString());
    await Promise.all(
      itineraryIds.map(async (id) => {
        try {
          names.set(id, (await this.publicItineraries.loadPublic(id)).itinerary.title);
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
        }
      }),
    );
    return names;
  }

  private toDto(doc: LeanFavourite, name: string | null): FavouriteDto {
    return {
      id: doc._id.toString(),
      type: doc.type,
      itemId: doc.itemId.toString(),
      name,
      available: name !== null,
      addedAt: (doc.createdAt ?? new Date(0)).toISOString(),
    };
  }
}
