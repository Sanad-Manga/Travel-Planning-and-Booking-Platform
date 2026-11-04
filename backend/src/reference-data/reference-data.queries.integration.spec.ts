import { Injectable, Module } from '@nestjs/common';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import {
  createReferenceModels,
  ReferenceModels,
} from './reference-data.models';
import { ReferenceDataModule } from './reference-data.module';
import { ReferenceDataService } from './reference-data.service';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

@Injectable()
class ReferenceConsumer {
  constructor(readonly referenceData: ReferenceDataService) {}
}

@Module({ imports: [ReferenceDataModule], providers: [ReferenceConsumer] })
class ConsumerModule {}

jest.setTimeout(120000);

describe('internal reference lists through an importing consumer module', () => {
  let mongo: MongoMemoryServer;
  let moduleRef: TestingModule;
  let models: ReferenceModels;
  let service: ReferenceDataService;
  const cities = [
    { city_id: 'city-b', name: 'Second city', country_code: 'AA' },
    { city_id: 'city-a', name: 'First city', country_code: 'AA' },
    { city_id: 'city-c', name: 'Other country', country_code: 'BB' },
    {
      city_id: 'city-empty',
      name: 'No airports or attractions',
      country_code: 'CC',
    },
  ];
  const airports = [
    {
      iata_code: 'ZZZ',
      name: 'First inserted',
      city_id: 'city-a',
      country_code: 'AA',
      time_zone: 'Etc/GMT+5',
    },
    {
      iata_code: 'AAA',
      name: 'Second inserted',
      city_id: 'city-a',
      country_code: 'AA',
      time_zone: 'America/New_York',
    },
    {
      iata_code: 'MID',
      name: 'Other city',
      city_id: 'city-b',
      country_code: 'AA',
      time_zone: 'Europe/Berlin',
    },
    {
      iata_code: 'BBB',
      name: 'Other country',
      city_id: 'city-c',
      country_code: 'BB',
      time_zone: 'Asia/Tokyo',
    },
  ];
  const attractions = [
    { attraction_id: 'att-z', name: 'First inserted', city_id: 'city-a' },
    {
      attraction_id: 'att-001',
      name: 'Museum, "North Wing"',
      city_id: 'city-a',
    },
    { attraction_id: 'att-b', name: 'Other city', city_id: 'city-b' },
    { attraction_id: 'att-c', name: 'Other country', city_id: 'city-c' },
  ];

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({
      instance: { dbName: 'gen12_queries_disposable' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri()), ConsumerModule],
    }).compile();
    await moduleRef.init();
    models = createReferenceModels(
      moduleRef.get<Connection>(getConnectionToken()),
    );
    await Promise.all(Object.values(models).map((model) => model.init()));
    service = moduleRef.get(ReferenceConsumer).referenceData;
  });

  beforeEach(async () => {
    // Only the suite's own generated MongoMemoryServer URI is ever used.
    await Promise.all([
      models.airports.deleteMany({}),
      models.cities.deleteMany({}),
      models.attractions.deleteMany({}),
      models.countries.deleteMany({}),
    ]);
    await models.countries.insertMany(
      ['AA', 'BB', 'CC', 'DD'].map((code) => ({
        code,
        name: `Fixture country ${code}`,
        currency: 'USD',
      })),
    );
    await models.cities.insertMany(cities);
    await models.airports.insertMany(airports);
    await models.attractions.insertMany(attractions);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await mongo?.stop();
  });

  it('injects the exported service into a feature module that imports ReferenceDataModule', () => {
    expect(service).toBe(moduleRef.get(ReferenceDataService));
  });

  it('returns multiple city airports in IATA order, preserving official fields and IANA zones only', async () => {
    const result = await service.listAirportsByCity('city-a');
    expect(result).toEqual([airports[1], airports[0]]);
    expect(await service.listAirportsByCity('city-a')).toEqual(result);
  });

  it('returns country airports from multiple cities while excluding other countries', async () => {
    const result = await service.listAirportsByCountry('AA');
    expect(result).toEqual([airports[1], airports[2], airports[0]]);
    expect(await service.listAirportsByCountry('AA')).toEqual(result);
  });

  it('returns cities in official city_id order while excluding other countries', async () => {
    const result = await service.listCitiesByCountry('AA');
    expect(result).toEqual([cities[1], cities[0]]);
    expect(await service.listCitiesByCountry('AA')).toEqual(result);
  });

  it('returns attractions in official attraction_id order with no MongoDB metadata', async () => {
    const result = await service.listAttractionsByCity('city-a');
    expect(result).toEqual([attractions[1], attractions[0]]);
    expect(await service.listAttractionsByCity('city-a')).toEqual(result);
  });

  it.each([
    ['listAirportsByCity', 'city-empty'],
    ['listAirportsByCountry', 'CC'],
    ['listCitiesByCountry', 'DD'],
    ['listAttractionsByCity', 'city-empty'],
  ] as const)(
    '%s returns [] for a known parent without matches and for an unknown ID',
    async (method, parent) => {
      expect(await service[method](parent)).toEqual([]);
      expect(await service[method]('unknown')).toEqual([]);
    },
  );

  it('uses exact official identifiers without case conversion or whitespace normalization', async () => {
    expect(await service.listAirportsByCity('CITY-A')).toEqual([]);
    expect(await service.listAirportsByCountry('aa')).toEqual([]);
    expect(await service.listCitiesByCountry(' AA ')).toEqual([]);
    expect(await service.listAttractionsByCity('CITY-A')).toEqual([]);
  });

  it('returns all matching references from larger groups without applying HTTP page limits', async () => {
    const moreAirports = Array.from({ length: 80 }, (_, i) => ({
      iata_code: `L${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
      name: `Large fixture airport ${i}`,
      city_id: 'city-a',
      country_code: 'AA',
      time_zone: 'Etc/UTC',
    }));
    const moreCities = Array.from({ length: 80 }, (_, i) => ({
      city_id: `large-city-${String(i).padStart(3, '0')}`,
      name: `Large fixture city ${i}`,
      country_code: 'AA',
    }));
    const moreAttractions = Array.from({ length: 80 }, (_, i) => ({
      attraction_id: `large-attraction-${String(i).padStart(3, '0')}`,
      name: `Large fixture attraction ${i}`,
      city_id: 'city-a',
    }));
    await Promise.all([
      models.airports.insertMany([...moreAirports].reverse()),
      models.cities.insertMany([...moreCities].reverse()),
      models.attractions.insertMany([...moreAttractions].reverse()),
    ]);
    expect(
      (await service.listAirportsByCity('city-a')).map((row) => row.iata_code),
    ).toEqual(
      [
        airports[0].iata_code,
        airports[1].iata_code,
        ...moreAirports.map((row) => row.iata_code),
      ].sort(),
    );
    expect(
      (await service.listAirportsByCountry('AA')).map((row) => row.iata_code),
    ).toEqual(
      [
        airports[0].iata_code,
        airports[1].iata_code,
        airports[2].iata_code,
        ...moreAirports.map((row) => row.iata_code),
      ].sort(),
    );
    expect(
      (await service.listCitiesByCountry('AA')).map((row) => row.city_id),
    ).toEqual(
      [
        cities[0].city_id,
        cities[1].city_id,
        ...moreCities.map((row) => row.city_id),
      ].sort(),
    );
    expect(
      (await service.listAttractionsByCity('city-a')).map(
        (row) => row.attraction_id,
      ),
    ).toEqual(
      [
        attractions[0].attraction_id,
        attractions[1].attraction_id,
        ...moreAttractions.map((row) => row.attraction_id),
      ].sort(),
    );
  });
});
