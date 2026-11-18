import { Controller, Get, Param } from '@nestjs/common';
import { ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { RefundResponseDto, toRefundResponse } from './dto/refund-response.dto';
import { RefundsService } from './refunds.service';

@ApiTags('refunds')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get(':id')
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiOperation({ summary: "Read a refund's current status (PAY-03)" })
  @ApiOkResponse({ type: RefundResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Refund not found or belongs to another traveler' })
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<RefundResponseDto> {
    return toRefundResponse(await this.refunds.getById(user, id));
  }
}
