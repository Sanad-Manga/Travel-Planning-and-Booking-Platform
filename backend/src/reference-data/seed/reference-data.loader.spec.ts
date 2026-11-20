import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultDataDirectory,
  loadReferenceData,
  parseReferenceCsv,
  ReferenceData,
  validateReferenceData,
} from './reference-data.loader';

describe('official reference CSV loading and validation', () => {
  let official: ReferenceData;
  beforeAll(async () => {
    official = await loadReferenceData();
  });

  it('validates the real files, preserving all IDs, relationships, accents and IANA zones', () => {
    expect(
      Object.fromEntries(
        Object.entries(official).map(([key, rows]) => [key, rows.length]),
      ),
    ).toEqual({
      countries: 8,
      cities: 8,
      airports: 8,
      attractions: 8,
      currencies: 7,
    });
    expect(official.countries[0]).toEqual({
      code: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });
    expect(official.cities[0]).toEqual({
      city_id: 'cairo',
      name: 'Cairo',
      country_code: 'EG',
    });
    expect(official.airports[0]).toEqual({
      iata_code: 'CAI',
      name: 'Cairo International Airport',
      city_id: 'cairo',
      country_code: 'EG',
      time_zone: 'Africa/Cairo',
    });
    expect(official.attractions[0]).toEqual({
      attraction_id: 'att-1',
      name: 'Giza Pyramids and Sphinx',
      city_id: 'cairo',
    });
    expect(official.attractions[7].name).toBe('Römerberg');
    expect(
      official.currencies.filter(({ code }) => code === 'EUR'),
    ).toHaveLength(1);
  });

  it('handles BOM, CRLF, quoted commas, escaped quotes, multiline values, and no final newline', () => {
    const rows = parseReferenceCsv(
      '\uFEFFcode,name,currency\r\nEG,"Museum, ""Cairo""\r\nWing",EGP',
      ['code', 'name', 'currency'],
      'fixture.csv',
    );
    expect(rows).toEqual([
      { code: 'EG', name: 'Museum, "Cairo"\r\nWing', currency: 'EGP' },
    ]);
    expect(
      parseReferenceCsv(
        'city_id,name,country_code\n001,Cairo,EG',
        ['city_id', 'name', 'country_code'],
        'fixture.csv',
      ),
    ).toEqual([{ city_id: '001', name: 'Cairo', country_code: 'EG' }]);
  });

  it.each([
    ['', /expected columns/],
    ['code,name\nEG,Egypt', /expected columns/],
    ['code,code,currency\nEG,Egypt,EGP', /expected columns/],
    ['code,name,currency\n', /empty/],
    ['code,name,currency\nEG,,EGP', /missing required/],
    ['code,name,currency\nEG,   ,EGP', /missing required/],
    ['code,name,currency\nEG,Egypt', /malformed/],
    ['code,name,currency\nEG,Egypt,EGP,extra', /malformed/],
    ['code,name,currency\nEG,"Egypt,EGP', /malformed/],
  ])('rejects invalid CSV %j', (text, error) => {
    expect(() =>
      parseReferenceCsv(text, ['code', 'name', 'currency'], 'fixture.csv'),
    ).toThrow(error);
  });

  const invalid: [string, (data: ReferenceData) => void, RegExp][] = [
    [
      'country ID',
      (d) => {
        d.countries[0].code = '';
      },
      /requires code/,
    ],
    [
      'city ID',
      (d) => {
        d.cities[0].city_id = '';
      },
      /requires city_id/,
    ],
    [
      'airport ID',
      (d) => {
        d.airports[0].iata_code = '';
      },
      /requires iata_code/,
    ],
    [
      'attraction ID',
      (d) => {
        d.attractions[0].attraction_id = '';
      },
      /requires attraction_id/,
    ],
    [
      'duplicate country',
      (d) => {
        d.countries.push(d.countries[0]);
      },
      /duplicate code/,
    ],
    [
      'duplicate city',
      (d) => {
        d.cities.push(d.cities[0]);
      },
      /duplicate city_id/,
    ],
    [
      'duplicate airport',
      (d) => {
        d.airports.push(d.airports[0]);
      },
      /duplicate iata_code/,
    ],
    [
      'duplicate attraction',
      (d) => {
        d.attractions.push(d.attractions[0]);
      },
      /duplicate attraction_id/,
    ],
    [
      'unknown country',
      (d) => {
        d.cities[0].country_code = 'XX';
      },
      /unknown country/,
    ],
    [
      'unknown airport country',
      (d) => {
        d.airports[0].country_code = 'XX';
      },
      /unknown country or city/,
    ],
    [
      'unknown airport city',
      (d) => {
        d.airports[0].city_id = 'unknown';
      },
      /unknown country or city/,
    ],
    [
      'airport mismatch',
      (d) => {
        d.airports[0].country_code = 'AE';
      },
      /city\/country mismatch/,
    ],
    [
      'unknown attraction city',
      (d) => {
        d.attractions[0].city_id = 'unknown';
      },
      /unknown city/,
    ],
    [
      'missing zone',
      (d) => {
        d.airports[0].time_zone = '';
      },
      /requires time_zone/,
    ],
    [
      'invalid zone',
      (d) => {
        d.airports[0].time_zone = 'Mars/Cairo';
      },
      /invalid IANA/,
    ],
    [
      'fixed offset',
      (d) => {
        d.airports[0].time_zone = '+02:00';
      },
      /invalid IANA/,
    ],
    [
      'empty currency',
      (d) => {
        d.countries[0].currency = '';
      },
      /requires currency/,
    ],
    [
      'invalid currency',
      (d) => {
        d.countries[0].currency = 'egp';
      },
      /three-letter/,
    ],
    [
      'missing derived currency',
      (d) => {
        d.currencies.pop();
      },
      /must match/,
    ],
  ];
  it.each(invalid)('rejects %s', (_name, mutate, error) => {
    const data = structuredClone(official);
    mutate(data);
    expect(() => validateReferenceData(data)).toThrow(error);
  });

  it('gives a clear filename for a missing file and validates malformed input from disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gen12-csv-'));
    try {
      await expect(loadReferenceData(directory)).rejects.toThrow(
        'Countries.csv: cannot read required CSV',
      );
      for (const name of ['Countries', 'Cities', 'Airports', 'Attractions']) {
        await writeFile(
          join(directory, `${name}.csv`),
          await readFile(join(defaultDataDirectory, `${name}.csv`)),
        );
      }
      await writeFile(
        join(directory, 'Attractions.csv'),
        'attraction_id,name,city_id\natt-1,Test,missing',
      );
      await expect(loadReferenceData(directory)).rejects.toThrow(
        'Attractions.csv: unknown city',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
