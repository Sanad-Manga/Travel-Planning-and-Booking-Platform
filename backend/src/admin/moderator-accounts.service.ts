import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { hash } from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import { AuditService } from '../audit/audit.service';
import { BCRYPT_SALT_ROUNDS } from '../auth/auth.service';
import { AccountStatus, AuthenticatedUser, Role } from '../common';
import { EmailService } from '../email';
import { HotelsService } from '../hotels/hotels.service';
import { User } from '../users/schemas/user.schema';
import { toAccountResponse } from './dto/account-response.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ModeratorResponseDto } from './dto/moderator-response.dto';

const MONGO_DUPLICATE_KEY = 11000;
// Same lifetime as the temporary password of the admin reset (ACC-07a): one login within 24 hours.
const TEMPORARY_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

type Detail = { field: string; message: string };
type ProviderLink = { kind: 'airline' | 'hotel'; id: string };

/**
 * ACC-13: an administrator creates an airline or hotel moderator linked to exactly one provider.
 * The temporary state reuses the ACC-07a fields (mustChangePassword, temporaryPasswordExpiresAt,
 * temporaryPasswordConsumed), so login, the forced-change guard and the forced replacement behave identically.
 * The plaintext password only lives in this call: it is hashed immediately and never stored, logged or audited.
 */
@Injectable()
export class ModeratorAccountsService {
  private readonly logger = new Logger(ModeratorAccountsService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly airlines: AirlinesService,
    private readonly hotels: HotelsService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateModeratorDto): Promise<ModeratorResponseDto> {
    if (!actor?.userId) throw new UnauthorizedException('Authentication required');
    if (actor.role !== Role.ADMIN) throw new ForbiddenException('Administrator role required');

    const link = this.resolveLink(dto);
    await this.assertProviderExists(link);

    const passwordHash = await hash(dto.temporaryPassword, BCRYPT_SALT_ROUNDS);
    const linkField = link.kind === 'airline' ? 'airlineId' : 'hotelId';
    let created;
    try {
      // One insert. The unique email index is the only duplicate guard, so two concurrent requests cannot both win.
      created = await this.users.create({
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role,
        status: AccountStatus.ACTIVE,
        [linkField]: new Types.ObjectId(link.id),
        mustChangePassword: true,
        temporaryPasswordExpiresAt: new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS),
        temporaryPasswordConsumed: false,
        // Schema marker required by the User schema, set at creation like the admin seeder. It is NOT user consent.
        consentAcceptedAt: new Date(),
      });
    } catch (error) {
      if ((error as { code?: unknown })?.code === MONGO_DUPLICATE_KEY) {
        throw new ConflictException({
          message: 'Email already registered',
          details: [{ field: 'email', message: 'email already exists' }],
        });
      }
      // Never forward a driver error: its message can contain the document being inserted.
      throw new InternalServerErrorException('Moderator account could not be created');
    }

    try {
      await this.audit.log({
        actorId: actor.userId,
        action: 'MODERATOR_CREATED',
        targetType: 'User',
        targetId: created.id,
        details: { role: dto.role, [linkField]: link.id },
      });
    } catch {
      throw new InternalServerErrorException(
        'Moderator account was created but the audit record failed. Do not create it again; tell the lead.',
      );
    }

    await this.sendInvite(dto, link);

    return {
      ...toAccountResponse({
        _id: created._id,
        name: created.name,
        email: created.email,
        role: created.role,
        status: created.status,
        createdAt: created.createdAt as Date,
      }),
      [linkField]: link.id,
    };
  }

  /**
   * GEN-01-B: the invitation itself — it carries the plaintext temporary password, so it goes
   * through EmailService directly (a one-off transactional email) rather than
   * NotificationsService.notify(), which would persist it into the readable notifications
   * collection. A failed send is logged and swallowed: the account already exists and the admin
   * who set the password can relay it another way, so this must never undo or fail the creation.
   */
  private async sendInvite(dto: CreateModeratorDto, link: ProviderLink): Promise<void> {
    try {
      await this.email.send({
        to: dto.email,
        subject: 'Your moderator account was created',
        text:
          `Hi ${dto.name},\n\n` +
          `An administrator created a ${link.kind === 'airline' ? 'airline' : 'hotel'} moderator account for you.\n\n` +
          `Email: ${dto.email}\n` +
          `Temporary password: ${dto.temporaryPassword}\n\n` +
          'Log in and set a new password within 24 hours; the temporary one expires after that.',
      });
    } catch (error) {
      this.logger.error(
        `Could not send the moderator invitation email to ${dto.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Exactly one provider id, of the kind that matches the role; otherwise a 400 naming each wrong field. */
  private resolveLink(dto: CreateModeratorDto): ProviderLink {
    const airlineId = dto.airlineId ?? undefined;
    const hotelId = dto.hotelId ?? undefined;
    const isAirline = dto.role === Role.AIRLINE_MODERATOR;
    const wanted = isAirline ? 'airlineId' : 'hotelId';
    const other = isAirline ? 'hotelId' : 'airlineId';
    const wantedValue = isAirline ? airlineId : hotelId;
    const otherValue = isAirline ? hotelId : airlineId;
    const details: Detail[] = [];
    if (wantedValue === undefined) details.push({ field: wanted, message: `${wanted} is required for ${dto.role}` });
    if (otherValue !== undefined) details.push({ field: other, message: `${other} must not be set for ${dto.role}` });
    if (details.length > 0 || wantedValue === undefined) {
      throw new BadRequestException({ message: 'Validation failed', details });
    }
    return { kind: isAirline ? 'airline' : 'hotel', id: wantedValue };
  }

  /** The provider must exist (it may be deactivated: it only has to exist). Checked through the owners' exported services. */
  private async assertProviderExists(link: ProviderLink): Promise<void> {
    const field = link.kind === 'airline' ? 'airlineId' : 'hotelId';
    let found: boolean;
    if (link.kind === 'airline') {
      found = await this.airlines.exists(link.id);
    } else {
      // HotelsService has no exists(): getPolicies is its exported lookup and answers 404 for an unknown id.
      found = await this.hotels.getPolicies(link.id).then(
        () => true,
        (error: unknown) => {
          if (error instanceof NotFoundException) return false;
          throw error;
        },
      );
    }
    if (!found) {
      throw new NotFoundException({
        message: `${link.kind === 'airline' ? 'Airline' : 'Hotel'} not found`,
        details: [{ field, message: `${field} does not match an existing ${link.kind}` }],
      });
    }
  }
}
