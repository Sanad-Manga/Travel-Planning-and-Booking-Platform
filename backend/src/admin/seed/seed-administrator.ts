import { hash } from 'bcryptjs';
import { Model } from 'mongoose';
import { BCRYPT_SALT_ROUNDS } from '../../auth/auth.service';
import { AccountStatus, Role } from '../../common';
import { User } from '../../users/schemas/user.schema';
import { AdminSeedConfig, validateAdminSeedConfig } from './admin-seed.config';

export type AdminSeedResult = 'created' | 'already-exists';

export class AdminSeedCollisionError extends Error {
  constructor() {
    super(
      'Administrator seed refused: the configured email belongs to a non-administrator. No account was promoted or overwritten.',
    );
  }
}

export async function seedAdministrator(
  users: Model<User>,
  input: AdminSeedConfig,
): Promise<AdminSeedResult> {
  const config = validateAdminSeedConfig(input);
  await users.createIndexes(); // Ensure the schema's unique email index; never drop existing indexes.
  const readRole = () =>
    users
      .findOne({ email: config.email })
      .select('role -_id')
      .lean<Pick<User, 'role'>>()
      .exec();
  const existing = await readRole();
  if (existing) {
    if (existing.role !== Role.ADMIN) throw new AdminSeedCollisionError();
    return 'already-exists';
  }

  const passwordHash = await hash(config.password, BCRYPT_SALT_ROUNDS);
  const provisionedAt = new Date();
  try {
    const result = await users.updateOne(
      { email: config.email },
      {
        $setOnInsert: {
          name: config.name,
          email: config.email,
          passwordHash,
          role: Role.ADMIN,
          status: AccountStatus.ACTIVE,
          // Required schema compatibility marker: provisioning time, not interactive terms acceptance.
          consentAcceptedAt: provisionedAt,
          createdAt: provisionedAt,
          updatedAt: provisionedAt,
        },
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
        timestamps: false,
      },
    );
    if (result.upsertedCount === 1) return 'created';
  } catch (error: unknown) {
    // Another seed or registration can win the unique-email race. Never promote it.
    if ((error as { code?: number })?.code !== 11000) throw error;
  }

  const winner = await readRole();
  if (!winner)
    throw new Error(
      'Administrator seed could not confirm the existing account',
    );
  if (winner.role !== Role.ADMIN) throw new AdminSeedCollisionError();
  return 'already-exists';
}
