import { ApiProperty } from '@nestjs/swagger';

/** An image attached to a post (BLG-10). Response only: images are added through POST /posts/:id/images. */
export class PostImageDto {
  @ApiProperty({ description: 'Upload id returned by the shared UploadService', example: '6730a1f2c3d4e5f607182931' })
  id: string;

  @ApiProperty({ description: 'Public url of the stored image', example: '/uploads/6730a1f2c3d4e5f607182931.jpg' })
  url: string;
}
