import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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
}
