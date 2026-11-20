import { ApiProperty } from '@nestjs/swagger';

export class PostLikeResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  postId: string;

  @ApiProperty({ example: true })
  liked: boolean;

  @ApiProperty({ example: 12, minimum: 0 })
  likeCount: number;
}
