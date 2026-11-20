import 'reflect-metadata';
import { createConnection } from 'mongoose';
import { createReferenceModels } from '../reference-data.models';
import {
  defaultDataDirectory,
  loadReferenceData,
  ReferenceDataValidationError,
} from './reference-data.loader';
import { seedReferenceData } from './seed-reference-data';

/** Explicit CLI only: does not bootstrap AppModule or load the development .env. */
export async function runSeed(directory = defaultDataDirectory): Promise<void> {
  const data = await loadReferenceData(directory);
  const uri = process.env.MONGODB_URI;
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new ReferenceDataValidationError(
      'Set MONGODB_URI explicitly, or use node --env-file=.env',
    );
  }
  const connection = createConnection(uri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });
  try {
    await connection.asPromise();
    await seedReferenceData(
      createReferenceModels(connection),
      data,
      (result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      },
    );
  } finally {
    await connection.close();
  }
}

if (require.main === module) {
  const execute = async () => {
    if (process.argv.length > 3)
      throw new ReferenceDataValidationError(
        'Usage: node dist/reference-data/seed/seed.js [data-directory]',
      );
    await runSeed(process.argv[2]);
  };
  void execute().catch((error: unknown) => {
    // Database/driver messages can contain credentials; never print them or their stacks.
    const message =
      error instanceof ReferenceDataValidationError
        ? error.message
        : 'Database seeding failed; completed collections may remain. Check connection, indexes and database permissions, then rerun.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
