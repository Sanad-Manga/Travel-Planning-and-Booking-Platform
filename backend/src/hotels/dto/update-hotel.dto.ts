import { PartialType } from '@nestjs/swagger';
import { CreateHotelDto } from './create-hotel.dto';

/** PATCH body: any subset of the profile fields. `isActive` is intentionally absent (Admin only, ACC-15). */
export class UpdateHotelDto extends PartialType(CreateHotelDto) {}
