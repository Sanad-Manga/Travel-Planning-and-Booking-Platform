import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto, Role, Roles } from '../common';

/**
 * Class decorator of the controllers whose routes are for a logged-in traveler (ITN-01): the Swagger tag, the
 * cookie login, the 401 and 403 answers, and the USER role. Who owns a given row is checked in the service.
 */
export const UserRoutes = (tag: string) =>
  applyDecorators(
    ApiTags(tag),
    ApiCookieAuth(),
    ApiUnauthorizedResponse({
      type: ErrorResponseDto,
      description: 'Not logged in',
    }),
    ApiForbiddenResponse({
      type: ErrorResponseDto,
      description: 'Caller is not a registered user (admin or moderator)',
    }),
    Roles(Role.USER),
  );

/** The field-level 400 of a route (docs/contracts.md section 3), with what makes it happen. */
export const ApiBadRequest = (description: string) =>
  ApiBadRequestResponse({ type: ErrorResponseDto, description });

/** The 404 of a route, with what makes it happen. */
export const ApiNotFound = (description: string) =>
  ApiNotFoundResponse({ type: ErrorResponseDto, description });

/** The 404 text of every route that opens an itinerary of the caller. */
export const ITINERARY_NOT_FOUND =
  'No such itinerary (or it belongs to someone else)';

/** The 404 text of every route that opens a day of an itinerary of the caller. */
export const ITINERARY_OR_DAY_NOT_FOUND =
  'No such itinerary or day (or the itinerary belongs to someone else)';
