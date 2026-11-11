import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  Role,
  Roles,
} from '../common';
import { CabinParamsDto, FlightIdParamDto } from './dto/cabin-params.dto';
import { CabinResponseDto } from './dto/cabin-response.dto';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { FlightCabinsService } from './flight-cabins.service';

@ApiTags('flights')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description:
    'Not an airline moderator, or the flight belongs to another airline',
})
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'Flight or cabin not found',
})
@Controller('flights/:id/cabins')
export class FlightCabinsController {
  constructor(private readonly cabins: FlightCabinsService) {}

  @Post()
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Add a cabin category to your own flight - FLT-04',
    description:
      'Class is one of ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST, used at most once per flight. Price is in integer cents.',
  })
  @ApiCreatedResponse({ type: CabinResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Class outside the allowed set, seats not a whole number > 0, price not > 0, bad baggage values, or unknown field',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'This flight already has this cabin class, or the flight is not SCHEDULED',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: FlightIdParamDto,
    @Body() dto: CreateCabinDto,
  ) {
    return this.cabins.create(user, params.id, dto);
  }

  @Patch(':cabinId')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Edit seats, price or baggage of a cabin - FLT-04',
    description:
      'The cabin class cannot be changed. totalSeats cannot go below the seats already booked or held.',
  })
  @ApiOkResponse({ type: CabinResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid value, empty body, or unknown field (including cabinClass)',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'totalSeats below booked + held seats, or the flight is not SCHEDULED',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: CabinParamsDto,
    @Body() dto: UpdateCabinDto,
  ) {
    return this.cabins.update(user, params.id, params.cabinId, dto);
  }
}
