import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto';
import { toTransportCostDto, TransportCostDto } from './dto/transport-cost.dto';
import { UpdateTransportCostDto } from './dto/update-transport-cost.dto';
import { Itinerary } from './schemas/itinerary.schema';
import {
  TransportCost,
  TransportCostLean,
} from './schemas/transport-cost.schema';

type FieldError = { field: string; message: string };

/**
 * ITN-16: the intercity transport costs of an itinerary. Writes check the owner in the filter of the query (404
 * for someone else's, the same as a missing one); the body is checked against the reference data: both cities
 * must be in the seeded list, the currency must be a supported code and the day must belong to the itinerary.
 */
@Injectable()
export class TransportCostsService {
  constructor(
    @InjectModel(TransportCost.name)
    private readonly model: Model<TransportCost>,
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /** The owner adds an entry to their itinerary. Unknown or someone else's itinerary: 404, then body checks: 400. */
  async create(
    user: AuthenticatedUser,
    itineraryId: string,
    dto: CreateTransportCostDto,
  ): Promise<TransportCostDto> {
    const ownerId = new Types.ObjectId(user.userId);
    const itinerary = await this.itineraries
      .findOne({ _id: itineraryId, authorId: ownerId })
      .select('days._id')
      .lean<{ days?: { _id: Types.ObjectId }[] }>()
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');

    await this.assertValid(dto, itinerary.days ?? []);

    const created = await this.model.create({
      itineraryId: new Types.ObjectId(itineraryId),
      dayId: new Types.ObjectId(dto.dayId),
      ownerId,
      mode: dto.mode,
      fromCityId: dto.fromCityId,
      toCityId: dto.toCityId,
      amountCents: dto.amountCents,
      currency: dto.currency,
    });
    return toTransportCostDto(created.toObject<TransportCostLean>());
  }

  /**
   * The owner edits an entry (any of mode, cities, amount, currency, day). The entry is found by id AND owner (404
   * otherwise); the fields that changed are checked like on add; then ONE update with the same filter writes them.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateTransportCostDto,
  ): Promise<TransportCostDto> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<UpdateTransportCostDto>;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        message: 'Nothing to update',
        details: [
          {
            field: 'body',
            message:
              'send at least one of mode, fromCityId, toCityId, amountCents, currency, dayId',
          },
        ],
      });
    }

    const ownerFilter = { _id: id, ownerId: new Types.ObjectId(user.userId) };
    const current = await this.model
      .findOne(ownerFilter)
      .select('itineraryId')
      .lean<{ itineraryId: Types.ObjectId }>()
      .exec();
    if (!current) throw new NotFoundException('Transport cost not found');

    const itinerary = await this.itineraries
      .findById(current.itineraryId)
      .select('days._id')
      .lean<{ days?: { _id: Types.ObjectId }[] }>()
      .exec();
    await this.assertValid(changes, itinerary?.days ?? []);

    const updated = await this.model
      .findOneAndUpdate(
        ownerFilter,
        {
          $set: {
            ...changes,
            ...(changes.dayId !== undefined && {
              dayId: new Types.ObjectId(changes.dayId),
            }),
          },
        },
        { new: true, runValidators: true },
      )
      .lean<TransportCostLean>()
      .exec();
    if (!updated) throw new NotFoundException('Transport cost not found');
    return toTransportCostDto(updated);
  }

  /** The owner deletes an entry. Someone else's, an unknown one and one already deleted all answer 404. */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const result = await this.model
      .deleteOne({ _id: id, ownerId: new Types.ObjectId(user.userId) })
      .exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException('Transport cost not found');
    }
  }

  /**
   * All entries of an itinerary, oldest first, for showing them on the itinerary. The caller has already checked
   * that the itinerary may be read, so this does not check ownership.
   */
  async listByItinerary(
    itineraryId: Types.ObjectId,
  ): Promise<TransportCostDto[]> {
    const rows = await this.model
      .find({ itineraryId })
      .sort({ _id: 1 })
      .lean<TransportCostLean[]>()
      .exec();
    return rows.map(toTransportCostDto);
  }

  /** Called when an itinerary is deleted: its entries go with it. */
  async removeForItinerary(itineraryId: Types.ObjectId): Promise<void> {
    await this.model.deleteMany({ itineraryId }).exec();
  }

  /**
   * Checks the fields that are present: a day must be one of the itinerary's days, both cities must be in the
   * seeded list and the currency must be a supported code. Reports every problem at once as field-level errors.
   */
  private async assertValid(
    fields: Partial<
      Pick<
        CreateTransportCostDto,
        'dayId' | 'fromCityId' | 'toCityId' | 'currency'
      >
    >,
    days: { _id: Types.ObjectId }[],
  ): Promise<void> {
    const errors: FieldError[] = [];

    if (
      fields.dayId !== undefined &&
      !days.some((day) => day._id.equals(fields.dayId as string))
    ) {
      errors.push({
        field: 'dayId',
        message: 'dayId must be a day of this itinerary',
      });
    }
    for (const field of ['fromCityId', 'toCityId'] as const) {
      const cityId = fields[field];
      if (
        cityId !== undefined &&
        !(await this.referenceData.findCityById(cityId))
      ) {
        errors.push({ field, message: `unknown city: ${cityId}` });
      }
    }
    if (
      fields.currency !== undefined &&
      !(await this.referenceData.findCurrencyById(fields.currency))
    ) {
      errors.push({
        field: 'currency',
        message: `unsupported currency: ${fields.currency}`,
      });
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: errors,
      });
    }
  }
}
