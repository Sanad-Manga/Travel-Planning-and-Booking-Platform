import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { paginate, PaginatedResponse, PaginationDto } from '../common';
import { AirportResponseDto } from './dto/airport-response.dto';
import { Country } from './schemas/country.schema';
import { City } from './schemas/city.schema';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { Currency } from './schemas/currency.schema';

/** Official-ID lookups and paginated airport response mapping. */
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

  /** Internal lists return every match, using official fields without MongoDB metadata. */
  listAirportsByCity(cityId: string): Promise<Airport[]> {
    return this.airports
      .find({ city_id: cityId })
      .sort({ iata_code: 1 })
      .select('iata_code name city_id country_code time_zone -_id')
      .lean<Airport[]>()
      .exec();
  }

  listAirportsByCountry(countryCode: string): Promise<Airport[]> {
    return this.airports
      .find({ country_code: countryCode })
      .sort({ iata_code: 1 })
      .select('iata_code name city_id country_code time_zone -_id')
      .lean<Airport[]>()
      .exec();
  }

  listCitiesByCountry(countryCode: string): Promise<City[]> {
    return this.cities
      .find({ country_code: countryCode })
      .sort({ city_id: 1 })
      .select('city_id name country_code -_id')
      .lean<City[]>()
      .exec();
  }

  listAttractionsByCity(cityId: string): Promise<Attraction[]> {
    return this.attractions
      .find({ city_id: cityId })
      .sort({ attraction_id: 1 })
      .select('attraction_id name city_id -_id')
      .lean<Attraction[]>()
      .exec();
  }

  async listAirports(
    pagination: PaginationDto,
  ): Promise<PaginatedResponse<AirportResponseDto>> {
    const page = await paginate(this.airports, {}, pagination, {
      sort: { iata_code: 1, _id: 1 },
      projection: 'iata_code name city_id country_code time_zone',
      map: (airport: Airport & { _id: Types.ObjectId }) => ({
        id: airport._id.toString(),
        iataCode: airport.iata_code,
        name: airport.name,
        cityId: airport.city_id,
        countryCode: airport.country_code,
        timeZone: airport.time_zone,
      }),
    });
    if (!page.items.length) return { ...page, items: [] };

    // Resolve only this page's official references, avoiding ObjectId population and N+1 queries.
    const [cities, countries] = await Promise.all([
      this.cities
        .find({
          city_id: {
            $in: [...new Set(page.items.map((airport) => airport.cityId))],
          },
        })
        .select('city_id name country_code -_id')
        .lean<City[]>()
        .exec(),
      this.countries
        .find({
          code: {
            $in: [...new Set(page.items.map((airport) => airport.countryCode))],
          },
        })
        .select('code name -_id')
        .lean<Pick<Country, 'code' | 'name'>[]>()
        .exec(),
    ]);
    const citiesById = new Map(cities.map((city) => [city.city_id, city]));
    const countriesByCode = new Map(
      countries.map((country) => [country.code, country]),
    );
    const items: AirportResponseDto[] = page.items.map((airport) => {
      const city = citiesById.get(airport.cityId);
      const country = countriesByCode.get(airport.countryCode);
      if (!city || !country || city.country_code !== country.code) {
        throw new InternalServerErrorException(
          'Airport reference data is incomplete or inconsistent',
        );
      }
      return {
        id: airport.id,
        iataCode: airport.iataCode,
        name: airport.name,
        city: { cityId: city.city_id, name: city.name },
        country: { code: country.code, name: country.name },
        timeZone: airport.timeZone,
      };
    });
    return { ...page, items };
  }
}
