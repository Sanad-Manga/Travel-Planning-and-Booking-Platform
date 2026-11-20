import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisterDto } from '../../auth/dto/register.dto';

export interface AdminSeedConfig {
  name: string;
  email: string;
  password: string;
}

const fields = {
  name: 'ADMIN_SEED_NAME',
  email: 'ADMIN_SEED_EMAIL',
  password: 'ADMIN_SEED_PASSWORD',
} as const;

export class AdminSeedConfigurationError extends Error {
  constructor(invalidFields: string[]) {
    // Only variable names are reported; never serialize class-validator targets/values.
    super(
      `Invalid administrator seed configuration: check ${invalidFields.join(', ')} against the registration credential rules.`,
    );
  }
}

export function validateAdminSeedConfig(input: {
  name: unknown;
  email: unknown;
  password: unknown;
}): AdminSeedConfig {
  const missing = (Object.keys(fields) as (keyof typeof fields)[])
    .filter(
      (key) => typeof input[key] !== 'string' || !(input[key] as string).trim(),
    )
    .map((key) => fields[key]);
  if (missing.length) throw new AdminSeedConfigurationError(missing);

  // Reuse name/email normalization and the exact auth password/UTF-8 byte policy.
  // All three credential fields are required above. Skip only absent registration
  // fields: no acceptTerms=true is fabricated for a system-provisioned account.
  const dto = plainToInstance(RegisterDto, input);
  const invalid = validateSync(dto, { skipMissingProperties: true }).map(
    (error) => fields[error.property as keyof typeof fields],
  );
  if (invalid.length) throw new AdminSeedConfigurationError(invalid);
  return { name: dto.name, email: dto.email, password: dto.password };
}

export function readAdminSeedConfig(
  env: Record<string, unknown>,
): AdminSeedConfig {
  return validateAdminSeedConfig({
    name: env.ADMIN_SEED_NAME,
    email: env.ADMIN_SEED_EMAIL,
    password: env.ADMIN_SEED_PASSWORD,
  });
}

export function readAdminSeedDatabaseUri(env: Record<string, unknown>): string {
  const uri = typeof env.MONGODB_URI === 'string' ? env.MONGODB_URI.trim() : '';
  if (!/^mongodb(\+srv)?:\/\//.test(uri))
    throw new AdminSeedConfigurationError(['MONGODB_URI']);
  return uri;
}
