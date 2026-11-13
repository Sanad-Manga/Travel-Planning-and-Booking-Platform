import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { BudgetsService } from './budgets.service';
import { BudgetIdParamDto } from './dto/budget-id-param.dto';
import { BudgetDto } from './dto/budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

// Budget entries belong to the owner of the itinerary (ITN-14), so every route needs the USER role. Adding one is
// POST /api/itineraries/:id/days/:dayId/budgets and the summary is GET /api/itineraries/:id/budget-summary, both in
// ItinerariesController. Ownership is checked in the service.
@ApiTags('budgets')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'Caller is not a registered user (admin or moderator)',
})
@Roles(Role.USER)
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit one of my daily budget entries: category, amount and/or currency - ITN-14',
  })
  @ApiOkResponse({ type: BudgetDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id, a category that is not allowed, a negative or fractional amount, an unsupported currency, an unknown field, or an empty body',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such entry (or it belongs to someone else)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: BudgetIdParamDto,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgets.update(user, params.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of my daily budget entries - ITN-14' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'id is not a valid id',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such entry (or it belongs to someone else)',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: BudgetIdParamDto,
  ) {
    return this.budgets.remove(user, params.id);
  }
}
