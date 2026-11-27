import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Model, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import {
  AuthenticatedUser,
  flattenValidationErrors,
  paginate,
  PaginatedResponse,
  Role,
} from '../common';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { ListProvidersQueryDto } from './dto/list-providers-query.dto';
import { ProviderListItemDto } from './dto/provider-list-item.dto';

type ProviderFields = Pick<ProviderListItemDto, 'name' | 'isActive'>;

@Injectable()
export class ProviderListService {
  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
  ) {}

  async list(
    actor: AuthenticatedUser,
    input: ListProvidersQueryDto,
  ): Promise<PaginatedResponse<ProviderListItemDto>> {
    if (!actor?.userId)
      throw new UnauthorizedException('Authentication required');
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException('Administrator role required');

    const query = plainToInstance(ListProvidersQueryDto, input ?? {});
    const errors = validateSync(query, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length)
      throw new BadRequestException({
        message: 'Validation failed',
        details: flattenValidationErrors(errors),
      });

    try {
      return await (query.type === 'airline'
        ? this.readPage(this.airlines, query)
        : this.readPage(this.hotels, query));
    } catch {
      // Do not attach the driver failure to the shared exception filter's 500 log.
      throw new InternalServerErrorException(
        'Providers could not be retrieved',
      );
    }
  }

  private readPage<T extends ProviderFields>(
    model: Model<T>,
    query: ListProvidersQueryDto,
  ) {
    return paginate(model, {}, query, {
      projection: { _id: 1, name: 1, isActive: 1 },
      map: (
        doc: ProviderFields & { _id: Types.ObjectId },
      ): ProviderListItemDto => ({
        id: doc._id.toHexString(),
        name: doc.name,
        isActive: doc.isActive === true,
      }),
    });
  }
}
