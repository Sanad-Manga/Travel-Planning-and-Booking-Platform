import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common/constants';
import { IsPlatformCurrency } from './is-platform-currency.constraint';

/**
 * PAY-04: the shared shape for any amount of money in this system.
 * - `amountCents` is always an integer in the platform's minor unit
 *   (never a float — see contracts.md section on money).
 * - `currency` always equals `PLATFORM_CURRENCY`; it is carried alongside
 *   the amount (rather than assumed) so every response is self-describing,
 *   but it is never allowed to differ.
 *
 * This DTO is meant to be embedded by other DTOs in my module (and, once
 * confirmed with Ahmed, by whichever module needs to accept or return a
 * money value) rather than re-declaring `amountCents`/`currency` by hand
 * in every place.
 */
export class MoneyDto {
  @ApiProperty({
    description: 'Amount in integer minor units (e.g. cents). Never a float.',
    example: 1999,
  })
  @IsInt()
  @Min(0)
  amountCents!: number;

  @ApiProperty({
    description: 'The platform currency. Must equal PLATFORM_CURRENCY.',
    example: PLATFORM_CURRENCY,
  })
  @IsPlatformCurrency()
  currency!: string;
}
