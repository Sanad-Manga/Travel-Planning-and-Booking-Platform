import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Body of POST /api/airlines. `isActive`, ids and the logo are not accepted: the server sets them, and the logo is uploaded through POST /api/airlines/:id/logo (GEN-08). */
export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name should not be empty' })
  @MinLength(2, { message: 'name must be at least 2 characters' })
  @MaxLength(100, { message: 'name must be at most 100 characters' })
  name: string;

  @ApiProperty({
    example: 'MS',
    description: '2 or 3 letters/digits. Stored upper-case and unique.',
  })
  @Transform(trimUpper)
  @IsString({ message: 'code must be a string' })
  @Matches(/^[A-Z0-9]{2,3}$/, {
    message: 'code must be 2 or 3 letters or digits (A-Z, 0-9)',
  })
  code: string;
}
