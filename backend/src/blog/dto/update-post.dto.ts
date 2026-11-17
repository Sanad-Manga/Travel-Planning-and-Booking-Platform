import { PartialType } from '@nestjs/swagger';
import { CreatePostDto } from './create-post.dto';

/**
 * BLG-04: partial update of title, body, tags and status. BLG-10 rejects the legacy images input.
 * Same validation and normalisation as CreatePostDto. authorId, isHidden and the counters are not
 * part of the DTO, so the global whitelist rejects them. An empty body is rejected in the service.
 */
export class UpdatePostDto extends PartialType(CreatePostDto) {}
