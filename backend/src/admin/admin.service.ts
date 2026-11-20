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
import { FilterQuery, Model } from 'mongoose';
import {
  AuthenticatedUser,
  flattenValidationErrors,
  paginate,
  PaginatedResponse,
  Role,
} from '../common';
import { User } from '../users/schemas/user.schema';
import {
  AccountResponseDto,
  toAccountResponse,
} from './dto/account-response.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';

@Injectable()
export class AdminService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async listAccounts(
    actor: AuthenticatedUser,
    input: ListAccountsQueryDto,
  ): Promise<PaginatedResponse<AccountResponseDto>> {
    if (!actor?.userId)
      throw new UnauthorizedException('Authentication required');
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException('Administrator role required');
    // Reuse DTO rules for internal callers too; never pass arbitrary query objects to MongoDB.
    const query = plainToInstance(ListAccountsQueryDto, input ?? {});
    const errors = validateSync(query, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length)
      throw new BadRequestException({
        message: 'Validation failed',
        details: flattenValidationErrors(errors),
      });
    const filter: FilterQuery<User> = {};
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;
    if (query.search) {
      const literal = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: literal, $options: 'i' } },
        { email: { $regex: literal, $options: 'i' } },
      ];
    }
    try {
      return await paginate(this.users, filter, query, {
        sort: { _id: 1 },
        projection: {
          _id: 1,
          name: 1,
          email: 1,
          role: 1,
          status: 1,
          createdAt: 1,
        },
        map: toAccountResponse,
      });
    } catch {
      // The shared exception filter logs 500 stacks: omit raw driver errors and causes.
      throw new InternalServerErrorException('Accounts could not be retrieved');
    }
  }
}
