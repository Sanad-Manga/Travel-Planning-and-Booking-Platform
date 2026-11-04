import { PartialType } from '@nestjs/swagger';
import { CreateAirlineDto } from './create-airline.dto';

/** Body of PATCH /api/airlines/:id: any of name, code, logoUrl. At least one must be sent (checked in the service). */
export class UpdateAirlineDto extends PartialType(CreateAirlineDto) {}
