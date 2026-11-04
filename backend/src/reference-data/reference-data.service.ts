import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Country } from './schemas/country.schema';
import { City } from './schemas/city.schema';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { Currency } from './schemas/currency.schema';

/** Internal lookups by official ID. These records are not HTTP response DTOs. */
@Injectable()
export class ReferenceDataService {
  constructor(
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(Attraction.name)
    private readonly attractions: Model<Attraction>,
    @InjectModel(Currency.name) private readonly currencies: Model<Currency>,
  ) {}

  findCountryById(code: string): Promise<Country | null> {
    return this.countries
      .findOne({ code })
      .select('code name currency -_id')
      .lean<Country>()
      .exec();
  }

  findCityById(city_id: string): Promise<City | null> {
    return this.cities
      .findOne({ city_id })
      .select('city_id name country_code -_id')
      .lean<City>()
      .exec();
  }

  findAirportById(iata_code: string): Promise<Airport | null> {
    return this.airports
      .findOne({ iata_code })
      .select('iata_code name city_id country_code time_zone -_id')
      .lean<Airport>()
      .exec();
  }

  findAttractionById(attraction_id: string): Promise<Attraction | null> {
    return this.attractions
      .findOne({ attraction_id })
      .select('attraction_id name city_id -_id')
      .lean<Attraction>()
      .exec();
  }

  findCurrencyById(code: string): Promise<Currency | null> {
    return this.currencies
      .findOne({ code })
      .select('code -_id')
      .lean<Currency>()
      .exec();
  }
}
