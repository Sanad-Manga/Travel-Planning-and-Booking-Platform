import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCabinDto } from './create-cabin.dto';

/**
 * Body of PATCH /api/flights/:id/cabins/:cabinId: any of the same rules, all optional.
 * `cabinClass` cannot change (delete is not offered; a wrong class means a different cabin), so sending it is a 400.
 */
export class UpdateCabinDto extends PartialType(
  OmitType(CreateCabinDto, ['cabinClass'] as const),
) {}
