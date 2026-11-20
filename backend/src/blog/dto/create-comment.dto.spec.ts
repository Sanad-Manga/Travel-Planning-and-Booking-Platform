import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COMMENT_MAX_LENGTH } from '../../common';
import { CreateCommentDto } from './create-comment.dto';
import { describe, expect, it } from '@jest/globals';

describe('CreateCommentDto', () => {
  it('accepts a valid comment and trims surrounding whitespace', async () => {
    const dto = plainToInstance(CreateCommentDto, {
      body: '  This helped me plan my trip!  ',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.body).toBe('This helped me plan my trip!');
  });

  it.each(['', '   ', '\n\t'])(
    'rejects an empty or whitespace-only comment: %j',
    async (body) => {
      const dto = plainToInstance(CreateCommentDto, { body });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'body')).toBe(true);
    },
  );

  it('accepts exactly 500 characters', async () => {
    const dto = plainToInstance(CreateCommentDto, {
      body: 'a'.repeat(COMMENT_MAX_LENGTH),
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects more than 500 characters', async () => {
    const dto = plainToInstance(CreateCommentDto, {
      body: 'a'.repeat(COMMENT_MAX_LENGTH + 1),
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'body')).toBe(true);
  });

  it('rejects a missing body', async () => {
    const dto = plainToInstance(CreateCommentDto, {});

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'body')).toBe(true);
  });

  it.each([null, 42, true, {}, []])(
    'rejects a non-string body: %j',
    async (body) => {
      const dto = plainToInstance(CreateCommentDto, { body });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'body')).toBe(true);
    },
  );

  it('rejects a client-supplied authorId', async () => {
    const dto = plainToInstance(CreateCommentDto, {
      body: 'A valid comment',
      authorId: '6730a1f2c3d4e5f607182900',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.some((error) => error.property === 'authorId')).toBe(true);
  });
});