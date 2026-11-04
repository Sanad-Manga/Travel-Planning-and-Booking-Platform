import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common/constants';

/**
 * PAY-04: the platform supports exactly one currency. Every money-bearing
 * field must carry that currency verbatim — there is no per-request
 * conversion, so a mismatched value here means a caller tried to price
 * something in a currency we don't support rather than a value we should
 * silently convert.
 */
@ValidatorConstraint({ name: 'isPlatformCurrency', async: false })
export class IsPlatformCurrencyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return value === PLATFORM_CURRENCY;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must equal the platform currency (${PLATFORM_CURRENCY})`;
  }
}

/** Validates that a `currency` field equals the platform's single supported currency. */
export function IsPlatformCurrency(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsPlatformCurrencyConstraint,
    });
  };
}
