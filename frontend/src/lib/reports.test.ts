import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { REPORT_REASON_MAX_LENGTH, checkReason, classifyReportError } from './reports';

describe('checkReason (GEN-09)', () => {
  it('requires a reason; spaces only is missing', () => {
    expect(checkReason('')).toBe('Tell us why you are reporting this.');
    expect(checkReason('   \n  ')).toBe('Tell us why you are reporting this.');
  });

  it('accepts a normal reason and exactly the maximum length', () => {
    expect(checkReason('Spam links')).toBeUndefined();
    expect(checkReason('a'.repeat(REPORT_REASON_MAX_LENGTH))).toBeUndefined();
  });

  it('counts the trimmed text, like the backend, and says how long it was', () => {
    expect(checkReason(`  ${'a'.repeat(REPORT_REASON_MAX_LENGTH)}  `)).toBeUndefined();
    expect(checkReason('a'.repeat(REPORT_REASON_MAX_LENGTH + 1))).toBe('Use 500 characters or fewer. You used 501.');
  });
});

describe('classifyReportError', () => {
  it('reads a 409 as "already reported", not as a failure', () => {
    const duplicate = new ApiError(409, 'You have already reported this item', [{ field: 'targetId', message: 'you have already reported this item' }]);
    expect(classifyReportError(duplicate, 'post')).toEqual({ kind: 'already-reported', message: 'You have already reported this post. Our team will look at it.' });
  });

  it('reads a 404 as gone', () => {
    expect(classifyReportError(new ApiError(404, 'POST not found'), 'itinerary').kind).toBe('gone');
  });

  it('puts a server complaint about the reason on the field', () => {
    const body = { message: 'Validation failed', details: [{ field: 'reason', message: 'reason must be at most 500 characters' }] };
    expect(classifyReportError(new ApiError(400, 'Validation failed', body.details, null, body), 'post')).toEqual({
      kind: 'field',
      message: 'reason must be at most 500 characters',
    });
  });

  it('treats a server error as retryable and a 400 about something else as general', () => {
    const server = classifyReportError(new ApiError(503, 'Service unavailable'), 'post');
    expect(server.kind).toBe('other');
    expect(server.kind === 'other' && server.retryable).toBe(true);
    const other = classifyReportError(new ApiError(400, 'Validation failed', [{ field: 'targetType', message: 'COMMENT cannot be reported yet' }]), 'comment');
    expect(other.kind).toBe('other');
  });
});
