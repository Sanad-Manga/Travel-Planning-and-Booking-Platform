import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountStatus, Role } from '../common';
import { UpcomingBookingsRegistry } from './upcoming-bookings';
import { UsersService } from './users.service';

/** ACC-12: a user deactivates their own account. Business rules live here, not in the controller. */
@Injectable()
export class AccountDeactivationService {
  constructor(
    private readonly usersService: UsersService,
    private readonly upcomingBookings: UpcomingBookingsRegistry,
  ) {}

  /**
   * Order: load the account, check upcoming bookings, flip the status.
   *  - Only a plain USER may do this. The route is also guarded with @Roles(USER); the role of the stored
   *    account is checked here too, because a token can carry an outdated role until the next login.
   *  - An upcoming CONFIRMED flight or hotel booking blocks it with 409 (the user stays ACTIVE).
   *  - The status change is ONE conditional update (ACTIVE -> DEACTIVATED). If two calls race, only one
   *    changes the row; the other gets 401 like any request from an account that is no longer active.
   * Nothing is deleted: the user, bookings, posts and itineraries stay in the database.
   * Known limit: a booking confirmed in the instant between the check and the update is not caught
   * (the two checks live in different collections, so they cannot share one atomic statement).
   */
  async deactivate(userId: string, now = new Date()): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('Authentication required');
    }
    if (user.role !== Role.USER) {
      throw new ForbiddenException('Only a regular user account can be deactivated here. Ask an administrator.');
    }

    if (await this.upcomingBookings.hasUpcomingConfirmedBookings(userId, now)) {
      throw new ConflictException('You have upcoming confirmed bookings. Cancel them or wait until they are over, then deactivate your account.');
    }

    if (!(await this.usersService.deactivate(userId))) {
      throw new UnauthorizedException('Authentication required'); // deactivated by a parallel request
    }
  }
}
