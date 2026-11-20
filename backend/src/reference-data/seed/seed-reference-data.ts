import { Model, RootFilterQuery } from 'mongoose';
import { ReferenceModels } from '../reference-data.models';
import { ReferenceData, validateReferenceData } from './reference-data.loader';

export interface SeedResult {
  collection: string;
  input: number;
  inserted: number;
  matched: number;
  modified: number;
}

async function upsert<T extends object>(
  model: Model<T>,
  rows: T[],
  identifier: keyof T,
): Promise<SeedResult> {
  const result = await model.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { [identifier]: row[identifier] } as RootFilterQuery<T>,
        update: { $set: row },
        upsert: true,
      },
    })),
    { ordered: true },
  );
  return {
    collection: model.collection.name,
    input: rows.length,
    inserted: result.upsertedCount,
    matched: result.matchedCount,
    modified: result.modifiedCount,
  };
}

export async function seedReferenceData(
  models: ReferenceModels,
  data: ReferenceData,
  report: (result: SeedResult) => void = () => {},
): Promise<SeedResult[]> {
  // No collection/index or document writes until all datasets are valid.
  validateReferenceData(data);
  // Add declared indexes without dropping any existing indexes (never syncIndexes).
  for (const model of Object.values(models)) await model.createIndexes();
  const results: SeedResult[] = [];
  const save = async <T extends object>(
    model: Model<T>,
    rows: T[],
    identifier: keyof T,
  ) => {
    const result = await upsert(model, rows, identifier);
    results.push(result);
    report(result);
  };
  // Dependencies first; completed collections remain safe to replay after any failure.
  await save(
    models.currencies,
    data.currencies.map(({ code }) => ({ code })),
    'code',
  );
  await save(
    models.countries,
    data.countries.map(({ code, name, currency }) => ({
      code,
      name,
      currency,
    })),
    'code',
  );
  await save(
    models.cities,
    data.cities.map(({ city_id, name, country_code }) => ({
      city_id,
      name,
      country_code,
    })),
    'city_id',
  );
  await save(
    models.airports,
    data.airports.map(
      ({ iata_code, name, city_id, country_code, time_zone }) => ({
        iata_code,
        name,
        city_id,
        country_code,
        time_zone,
      }),
    ),
    'iata_code',
  );
  await save(
    models.attractions,
    data.attractions.map(({ attraction_id, name, city_id }) => ({
      attraction_id,
      name,
      city_id,
    })),
    'attraction_id',
  );
  return results;
}
