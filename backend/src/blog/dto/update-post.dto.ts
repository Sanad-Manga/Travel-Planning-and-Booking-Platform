import { PartialType } from '@nestjs/swagger';
import { CreatePostDto } from './create-post.dto';

/**
 * BLG-04: partial update of the BLG-01 fields (title, body, tags, images, status).
 * Same validation and normalisation as CreatePostDto. authorId, isHidden and the counters are not
 * part of the DTO, so the global whitelist rejects them. An empty body is rejected in the service.
 */
export class UpdatePostDto extends PartialType(CreatePostDto) {}
