import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Req, RawBodyRequest } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Public, Role, Roles } from '../common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { PaymentsService } from './payments.service';
import { STRIPE_GATEWAY, StripeGateway } from './stripe-gateway';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  @Post()
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiOperation({
    summary: 'Start paying a PENDING_PAYMENT booking via Stripe (PAY-01)',
    description:
      'Creates a Stripe PaymentIntent for the booking and returns its clientSecret — confirm it with Stripe.js ' +
      'or the Stripe test dashboard; card data never reaches this API. The booking is confirmed only once the ' +
      'Stripe webhook reports success, never from this response.',
  })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'bookingType/bookingId missing or malformed' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'The booking is unknown or belongs to another traveler' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Not awaiting payment, hold expired, policies not accepted, a payment is already in flight, or that booking type is not supported yet',
  })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'The payment provider is temporarily unavailable' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePaymentDto): Promise<PaymentResponseDto> {
    return this.payments.create(user, dto);
  }

  @Post(':id/retry')
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiOperation({
    summary: 'Retry a failed or cancelled payment, until the booking hold expires (PAY-01)',
    description: 'Creates a new PaymentIntent for the same booking. Only allowed while the hold is still unexpired.',
  })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Payment not found or belongs to another traveler' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Not retryable, or the booking hold has expired' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'The payment provider is temporarily unavailable' })
  retry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<PaymentResponseDto> {
    return this.payments.retry(user, id);
  }

  @Get(':id')
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiOperation({ summary: "Read a payment's current status (PAY-01)" })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Payment not found or belongs to another traveler' })
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<PaymentResponseDto> {
    return this.payments.getById(user, id);
  }

  @Post('webhook')
  @Public()
  @ApiExcludeEndpoint()
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string): Promise<{ received: true }> {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing Stripe signature or raw body');
    }
    let event;
    try {
      event = this.stripe.constructWebhookEvent(req.rawBody, signature);
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }
    await this.payments.handleWebhookEvent(event);
    return { received: true };
  }
}
