import { CreateCommentDto } from './create-comment.dto';

/**
 * PATCH /api/comments/:id (BLG-07). A comment is a single text field, so an edit takes exactly the same body as
 * creating one (BLG-05): the 1 to COMMENT_MAX_LENGTH rule, trimming and whitelisting are inherited, never copied.
 */
export class UpdateCommentDto extends CreateCommentDto {}
