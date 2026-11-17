import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../common';
import { ActivitiesService } from './activities.service';
import { BudgetsService } from './budgets.service';
import { ActivityDto } from './dto/activity.dto';
import { BudgetSummaryQueryDto } from './dto/budget-summary-query.dto';
import { BudgetSummaryDto } from './dto/budget-summary.dto';
import { BudgetDto } from './dto/budget.dto';
import { CreateActivityDto } from './dto/create-activity.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto';
import { ItineraryDayParamDto } from './dto/itinerary-day-param.dto';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import { TransportCostDto } from './dto/transport-cost.dto';
import {
  ApiBadRequest,
  ApiNotFound,
  ITINERARY_NOT_FOUND,
  ITINERARY_OR_DAY_NOT_FOUND,
  UserRoutes,
} from './itineraries.swagger';
import { TransportCostsService } from './transport-costs.service';

// What the owner adds to an itinerary: activities (ITN-10), daily budget entries (ITN-14) and intercity transport
// costs (ITN-16), plus the budget summary. Editing or deleting one of them is in ActivitiesController,
// BudgetsController and TransportCostsController. Ownership is checked in the services.
@UserRoutes('itineraries')
@Controller('itineraries')
export class ItineraryItemsController {
  constructor(
    private readonly activities: ActivitiesService,
    private readonly transportCosts: TransportCostsService,
    private readonly budgets: BudgetsService,
  ) {}

  @Post(':id/days/:dayId/activities')
  @ApiOperation({
    summary:
      'Add an activity to a day of my itinerary: name, optional description, time (HH:mm) and cost in cents - ITN-10',
  })
  @ApiCreatedResponse({ type: ActivityDto })
  @ApiBadRequest(
    'Invalid id or dayId, a missing or too long name, a time that is not HH:mm, a negative or fractional cost, or an unknown field',
  )
  @ApiNotFound(ITINERARY_OR_DAY_NOT_FOUND)
  addActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryDayParamDto,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activities.create(user, params.id, params.dayId, dto);
  }

  @Post(':id/days/:dayId/budgets')
  @ApiOperation({
    summary:
      'Add a daily budget entry to a day of my itinerary: category (food, accommodation, in-city transport, activities), amount in cents and currency - ITN-14',
  })
  @ApiCreatedResponse({ type: BudgetDto })
  @ApiBadRequest(
    'Invalid id or dayId, a missing or unknown category, a negative, fractional or missing amount, an unsupported currency, or an unknown field',
  )
  @ApiNotFound(ITINERARY_OR_DAY_NOT_FOUND)
  addBudget(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryDayParamDto,
    @Body() dto: CreateBudgetDto,
  ) {
    return this.budgets.create(user, params.id, params.dayId, dto);
  }

  @Get(':id/budget-summary')
  @ApiOperation({
    summary:
      'Total budget of my itinerary by category and by day, per currency: budget entries, activity costs and intercity transport - ITN-14/ITN-18',
    description:
      "Also returns convertedTotal, the grand total converted into ?currency= (or the caller's preferred currency) via daily cached exchange rates (ITN-18).",
  })
  @ApiOkResponse({ type: BudgetSummaryDto })
  @ApiBadRequest(
    'id is not a valid id, or currency is not a 3-letter code / is unsupported',
  )
  @ApiNotFound(ITINERARY_NOT_FOUND)
  budgetSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
    @Query() query: BudgetSummaryQueryDto,
  ) {
    return this.budgets.summary(user, params.id, query.currency);
  }

  @Post(':id/transport-costs')
  @ApiOperation({
    summary:
      'Add an intercity transport cost to my itinerary: mode, from and to city, amount in cents, currency and day - ITN-16',
  })
  @ApiCreatedResponse({ type: TransportCostDto })
  @ApiBadRequest(
    'Invalid id, a missing field, a mode that is not allowed, an unknown city, an unsupported currency, a negative or fractional amount, a day that is not a day of this itinerary, or an unknown field',
  )
  @ApiNotFound(ITINERARY_NOT_FOUND)
  addTransportCost(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
    @Body() dto: CreateTransportCostDto,
  ) {
    return this.transportCosts.create(user, params.id, dto);
  }
}
