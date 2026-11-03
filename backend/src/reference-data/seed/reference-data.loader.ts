import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { Country } from '../schemas/country.schema';
import { City } from '../schemas/city.schema';
import { Airport } from '../schemas/airport.schema';
import { Attraction } from '../schemas/attraction.schema';
import { Currency } from '../schemas/currency.schema';

export interface ReferenceData {
  countries: Country[];
  cities: City[];
  airports: Airport[];
  attractions: Attraction[];
  currencies: Currency[];
}

export class ReferenceDataValidationError extends Error {}

// Relative to this file in both src/reference-data/seed and dist/reference-data/seed.
export const defaultDataDirectory = resolve(__dirname, '../../../data');

export function parseReferenceCsv<T>(
  text: string,
  columns: readonly string[],
  file: string,
): T[] {
  let rows: string[][];
  try {
    rows = parse(text, {
      bom: true,
      skip_empty_lines: true,
      cast: false,
    }) as string[][];
  } catch {
    throw new ReferenceDataValidationError(
      `${file}: malformed CSV (check quoting and column counts)`,
    );
  }
  const [header, ...records] = rows;
  if (
    !header ||
    header.length !== columns.length ||
    columns.some((column, i) => header[i] !== column)
  ) {
    throw new ReferenceDataValidationError(
      `${file}: expected columns ${columns.join(',')}`,
    );
  }
  if (!records.length)
    throw new ReferenceDataValidationError(`${file}: dataset is empty`);
  return records.map((values, i) => {
    if (
      values.length !== columns.length ||
      values.some((value) => !value.trim())
    ) {
      throw new ReferenceDataValidationError(
        `${file}: record ${i + 2} has missing required values`,
      );
    }
    return Object.fromEntries(
      columns.map((column, index) => [column, values[index]]),
    ) as T;
  });
}

function assertRecords<T extends object>(
  records: T[],
  fields: (keyof T)[],
  identifier: keyof T,
  file: string,
) {
  if (!records.length)
    throw new ReferenceDataValidationError(`${file}: dataset is empty`);
  const identifiers = new Set<unknown>();
  for (const [i, record] of records.entries()) {
    for (const field of fields) {
      const value = record[field];
      if (typeof value !== 'string' || !value.trim()) {
        throw new ReferenceDataValidationError(
          `${file}: record ${i + 2} requires ${String(field)}`,
        );
      }
    }
    if (identifiers.has(record[identifier])) {
      throw new ReferenceDataValidationError(
        `${file}: duplicate ${String(identifier)} at record ${i + 2}`,
      );
    }
    identifiers.add(record[identifier]);
  }
}

function validTimeZone(timeZone: string): boolean {
  // Intl also accepts fixed offsets on newer Node versions; those are not IANA names.
  if (!/^(?:UTC|GMT|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(timeZone))
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateReferenceData(data: ReferenceData): void {
  assertRecords(
    data.countries,
    ['code', 'name', 'currency'],
    'code',
    'Countries.csv',
  );
  assertRecords(
    data.cities,
    ['city_id', 'name', 'country_code'],
    'city_id',
    'Cities.csv',
  );
  assertRecords(
    data.airports,
    ['iata_code', 'name', 'city_id', 'country_code', 'time_zone'],
    'iata_code',
    'Airports.csv',
  );
  assertRecords(
    data.attractions,
    ['attraction_id', 'name', 'city_id'],
    'attraction_id',
    'Attractions.csv',
  );
  assertRecords(data.currencies, ['code'], 'code', 'Derived currencies');
  const countries = new Set(data.countries.map((country) => country.code));
  const currencies = new Set(data.countries.map((country) => country.currency));
  const cities = new Map(data.cities.map((city) => [city.city_id, city]));
  if ([...currencies].some((code) => !/^[A-Z]{3}$/.test(code))) {
    throw new ReferenceDataValidationError(
      'Countries.csv: currency must be a three-letter uppercase code',
    );
  }
  if (
    data.currencies.length !== currencies.size ||
    data.currencies.some(({ code }) => !currencies.has(code))
  ) {
    throw new ReferenceDataValidationError(
      'Derived currencies must match distinct Countries.csv currencies',
    );
  }
  for (const city of data.cities) {
    if (!countries.has(city.country_code))
      throw new ReferenceDataValidationError(
        `Cities.csv: unknown country for ${city.city_id}`,
      );
  }
  for (const airport of data.airports) {
    const city = cities.get(airport.city_id);
    if (!countries.has(airport.country_code) || !city) {
      throw new ReferenceDataValidationError(
        `Airports.csv: unknown country or city for ${airport.iata_code}`,
      );
    }
    if (city.country_code !== airport.country_code) {
      throw new ReferenceDataValidationError(
        `Airports.csv: city/country mismatch for ${airport.iata_code}`,
      );
    }
    if (!validTimeZone(airport.time_zone))
      throw new ReferenceDataValidationError(
        `Airports.csv: invalid IANA time_zone for ${airport.iata_code}`,
      );
  }
  for (const attraction of data.attractions) {
    if (!cities.has(attraction.city_id))
      throw new ReferenceDataValidationError(
        `Attractions.csv: unknown city for ${attraction.attraction_id}`,
      );
  }
}

async function loadCsv<T>(
  directory: string,
  file: string,
  columns: string[],
): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(resolve(directory, file), 'utf8');
  } catch {
    throw new ReferenceDataValidationError(
      `${file}: cannot read required CSV in ${directory}`,
    );
  }
  return parseReferenceCsv<T>(text, columns, file);
}

export async function loadReferenceData(
  directory = defaultDataDirectory,
): Promise<ReferenceData> {
  const countries = await loadCsv<Country>(directory, 'Countries.csv', [
    'code',
    'name',
    'currency',
  ]);
  const cities = await loadCsv<City>(directory, 'Cities.csv', [
    'city_id',
    'name',
    'country_code',
  ]);
  const airports = await loadCsv<Airport>(directory, 'Airports.csv', [
    'iata_code',
    'name',
    'city_id',
    'country_code',
    'time_zone',
  ]);
  const attractions = await loadCsv<Attraction>(directory, 'Attractions.csv', [
    'attraction_id',
    'name',
    'city_id',
  ]);
  const currencies = [
    ...new Set(countries.map((country) => country.currency)),
  ].map((code) => ({ code }));
  const data = { countries, cities, airports, attractions, currencies };
  validateReferenceData(data);
  return data;
}
