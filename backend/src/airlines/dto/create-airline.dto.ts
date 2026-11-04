import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Body of POST /api/airlines. `isActive` and ids are not accepted: the server sets them. */
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

  @ApiPropertyOptional({
    example: 'https://example.com/logos/ms.png',
    description:
      'Temporary: an http(s) URL. Replaced by a file upload once the upload service (GEN-08) is merged.',
  })
  @IsOptional()
  @Transform(trim)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'logoUrl must be a valid http(s) URL' },
  )
  @MaxLength(2048, { message: 'logoUrl must be at most 2048 characters' })
  logoUrl?: string;
}
