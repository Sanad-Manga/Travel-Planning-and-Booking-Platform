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
  PaginationDto,
} from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import {
  ItineraryResponseDto,
  toItineraryResponse,
} from './dto/itinerary-response.dto';
import { ItineraryRowDto, toItineraryRow } from './dto/itinerary-row.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { Itinerary, ItineraryLean } from './schemas/itinerary.schema';

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name) private readonly model: Model<Itinerary>,
    private readonly referenceData: ReferenceDataService,
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
      { map: toItineraryRow, sort: { updatedAt: -1, _id: -1 } },
    );
  }

  /**
   * ITN-03: the owner opens one itinerary. Someone else's (even a public one) answers 404 here,
   * like a missing one (ACC-11); public viewing is a separate read-only route (ITN-21).
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
    return toItineraryResponse(itinerary);
  }

  /**
   * ITN-01: the owner edits title, countries and/or start date.
   * Ownership is part of the filter of ONE atomic update (`_id` AND `authorId`), so there is no
   * read-then-write gap. Someone else's itinerary matches nothing and answers 404 (the same as a missing
   * one), so a private itinerary's existence is not revealed.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateItineraryDto,
  ): Promise<ItineraryResponseDto> {
    const changes: Partial<
      Pick<Itinerary, 'title' | 'countryCodes' | 'startDate'>
    > = {};
    if (dto.title !== undefined) changes.title = dto.title;
    if (dto.countryCodes !== undefined) changes.countryCodes = dto.countryCodes;
    if (dto.startDate !== undefined) changes.startDate = dto.startDate;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        message: 'Nothing to update',
        details: [
          {
            field: 'body',
            message: 'send at least one of title, countryCodes, startDate',
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
    return toItineraryResponse(updated);
  }

  /**
   * ITN-01: the owner deletes an itinerary. The document is removed, so it can no longer appear in public
   * search. A clone (ITN-21) is a full independent copy with its own id and owner, so deleting the original
   * never touches it. The confirmation step ("are you sure?") is the client's job (GEN-03).
   *
   * Later tickets store days, activities, budgets and transport costs in their own collections; their
   * owner (this module) must delete those rows here too when they are added.
   */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const result = await this.model
      .deleteOne({ _id: id, authorId: new Types.ObjectId(user.userId) })
      .exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException('Itinerary not found');
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
