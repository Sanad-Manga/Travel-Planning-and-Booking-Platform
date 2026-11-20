import 'reflect-metadata';
import { createConnection } from 'mongoose';
import { User, UserSchema } from '../../users/schemas/user.schema';
import {
  AdminSeedConfigurationError,
  readAdminSeedConfig,
  readAdminSeedDatabaseUri,
} from './admin-seed.config';
import {
  AdminSeedCollisionError,
  AdminSeedResult,
  seedAdministrator,
} from './seed-administrator';

export function adminSeedFailureMessage(error: unknown): string {
  if (
    error instanceof AdminSeedConfigurationError ||
    error instanceof AdminSeedCollisionError
  )
    return error.message;
  return 'Administrator seed failed: database operation failed. Check configuration, indexes and database permissions.';
}

/** Explicit CLI: no AppModule bootstrap, admin routes or startup/install seeding. */
export async function runAdminSeed(
  env: Record<string, unknown> = process.env,
): Promise<AdminSeedResult> {
  // Both credential and URI checks finish before creating a connection or any indexes/documents.
  const config = readAdminSeedConfig(env);
  const uri = readAdminSeedDatabaseUri(env);
  const connection = createConnection(uri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });
  try {
    await connection.asPromise();
    return await seedAdministrator(
      connection.model(User.name, UserSchema),
      config,
    );
  } finally {
    await connection.close();
  }
}

if (require.main === module) {
  const execute = async () => {
    if (process.argv.length !== 2)
      throw new AdminSeedConfigurationError([
        'seed:admin does not accept command-line credentials',
      ]);
    const result = await runAdminSeed();
    process.stdout.write(
      result === 'created'
        ? 'Administrator created successfully.\n'
        : 'Administrator already exists; no account fields changed.\n',
    );
  };
  void execute().catch((error: unknown) => {
    // Never print driver errors, their stack/cause, configuration objects or hashes.
    process.stderr.write(`${adminSeedFailureMessage(error)}\n`);
    process.exitCode = 1;
  });
}
