import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
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
import { AirlinesService } from './airlines.service';
import { AirlineIdParamDto } from './dto/airline-id-param.dto';
import { AirlineResponseDto } from './dto/airline-response.dto';
import {
  BaggagePolicyResponseDto,
  SetBaggagePolicyDto,
} from './dto/baggage-policy.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

@ApiTags('airlines')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create an airline profile (admin only) - FLT-01' })
  @ApiCreatedResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid name, code or logoUrl, or an unknown field',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Caller is not an admin',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'An airline with this code already exists',
  })
  create(@Body() dto: CreateAirlineDto) {
    return this.airlines.create(dto);
  }

  // Any logged-in role may read a profile (flights and bookings show the airline). The profile holds nothing private.
  @Get(':id')
  @ApiOperation({ summary: 'Get an airline profile - FLT-01' })
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'id is not a valid id',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such airline',
  })
  getById(@Param() params: AirlineIdParamDto) {
    return this.airlines.getById(params.id);
  }

  @Patch(':id')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary:
      "Edit my airline's name, code or logo (airline moderator of that airline only) - FLT-01",
  })
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id, name, code or logoUrl, an unknown field, or an empty body',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Caller is not a moderator of this airline',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such airline',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Another airline already uses this code',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AirlineIdParamDto,
    @Body() dto: UpdateAirlineDto,
  ) {
    return this.airlines.update(user, params.id, dto);
  }

  @Put(':id/baggage-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary:
      'Set the extra-baggage price and the max extra bags per passenger (moderator of that airline only) - FLT-08',
    description:
      'Replaces the whole policy. A max of 0 is allowed (no extra bags offered). Each extra bag has the same maximum weight as the free-baggage allowance of the passenger cabin.',
  })
  @ApiOkResponse({ type: BaggagePolicyResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id, price not a whole number of cents > 0, max extra bags negative or not whole, missing or unknown field',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Caller is not a moderator of this airline',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such airline',
  })
  setBaggagePolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AirlineIdParamDto,
    @Body() dto: SetBaggagePolicyDto,
  ) {
    return this.airlines.setBaggagePolicy(user, params.id, dto);
  }
}
