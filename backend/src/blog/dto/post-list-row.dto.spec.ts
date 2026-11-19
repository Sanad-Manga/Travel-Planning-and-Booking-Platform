import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { POST_EXCERPT_MAX_LENGTH, POST_SEARCH_MAX_LENGTH } from '../blog.constants';
import { BrowsePostsQueryDto } from './browse-posts-query.dto';
import { makeExcerpt } from './post-list-row.dto';

describe('makeExcerpt (BLG-09)', () => {
  it('keeps a short body as it is', () => {
    expect(makeExcerpt('Just a line.')).toBe('Just a line.');
  });

  it('collapses whitespace and line breaks', () => {
    expect(makeExcerpt('  One\n\n two\t three  ')).toBe('One two three');
  });

  it('does not add an ellipsis at exactly the maximum length', () => {
    const body = 'x'.repeat(POST_EXCERPT_MAX_LENGTH);
    expect(makeExcerpt(body)).toBe(body);
  });

  it('cuts a longer body and ends with an ellipsis', () => {
    const excerpt = makeExcerpt('word '.repeat(100));
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(POST_EXCERPT_MAX_LENGTH + 1);
  });

  it('is empty for an empty body', () => {
    expect(makeExcerpt('')).toBe('');
  });
});

describe('BrowsePostsQueryDto q (BLG-09)', () => {
  it('trims the keyword', async () => {
    const dto = plainToInstance(BrowsePostsQueryDto, { q: '  cairo food ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.q).toBe('cairo food');
  });

  it('treats a blank keyword as no search', async () => {
    const dto = plainToInstance(BrowsePostsQueryDto, { q: '   ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.q).toBeUndefined();
  });

  it('accepts the maximum length and rejects one more', async () => {
    const ok = plainToInstance(BrowsePostsQueryDto, { q: 'a'.repeat(POST_SEARCH_MAX_LENGTH) });
    expect(await validate(ok)).toHaveLength(0);
    const tooLong = plainToInstance(BrowsePostsQueryDto, { q: 'a'.repeat(POST_SEARCH_MAX_LENGTH + 1) });
    expect((await validate(tooLong)).some((e) => e.property === 'q')).toBe(true);
  });

  it('rejects a keyword that is not text', async () => {
    const dto = plainToInstance(BrowsePostsQueryDto, { q: ['a', 'b'] });
    expect((await validate(dto)).some((e) => e.property === 'q')).toBe(true);
  });
});
