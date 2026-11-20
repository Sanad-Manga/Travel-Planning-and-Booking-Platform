import { Connection } from 'mongoose';
import { Country, CountrySchema } from './schemas/country.schema';
import { City, CitySchema } from './schemas/city.schema';
import { Airport, AirportSchema } from './schemas/airport.schema';
import { Attraction, AttractionSchema } from './schemas/attraction.schema';
import { Currency, CurrencySchema } from './schemas/currency.schema';

export const referenceModelDefinitions = [
  { name: Country.name, schema: CountrySchema },
  { name: City.name, schema: CitySchema },
  { name: Airport.name, schema: AirportSchema },
  { name: Attraction.name, schema: AttractionSchema },
  { name: Currency.name, schema: CurrencySchema },
];

export function createReferenceModels(connection: Connection) {
  return {
    countries: connection.model(Country.name, CountrySchema),
    cities: connection.model(City.name, CitySchema),
    airports: connection.model(Airport.name, AirportSchema),
    attractions: connection.model(Attraction.name, AttractionSchema),
    currencies: connection.model(Currency.name, CurrencySchema),
  };
}

export type ReferenceModels = ReturnType<typeof createReferenceModels>;
