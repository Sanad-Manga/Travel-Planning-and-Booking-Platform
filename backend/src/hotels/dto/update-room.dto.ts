import { PartialType, PickType } from '@nestjs/swagger';
import { CreateRoomDto } from './create-room.dto';

/**
 * PATCH body: any subset of beds, maxOccupancy and pricePerNightCents, validated exactly like HTL-03.
 * The room number/name and type are intentionally not editable here (not in HTL-05); sending them is a 400.
 */
export class UpdateRoomDto extends PartialType(PickType(CreateRoomDto, ['beds', 'maxOccupancy', 'pricePerNightCents'] as const)) {}
