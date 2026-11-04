import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ali@example.com' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be valid' })
  email: string;

  // Only "not empty" here: the strength rules apply when choosing a password, not when checking it.
  @ApiProperty({ example: 'Passw0rdOK' })
  @IsString()
  @IsNotEmpty({ message: 'password should not be empty' })
  password: string;
}
