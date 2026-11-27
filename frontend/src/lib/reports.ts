import { ApiError } from './api';
import { toFriendlyError } from './apiError';

/** Same limit as the backend (`REPORT_REASON_MAX_LENGTH`). */
export const REPORT_REASON_MAX_LENGTH = 500;

export type ReportTargetType = 'POST' | 'COMMENT' | 'REVIEW' | 'ITINERARY';

/** The word used in sentences: "Report this post". */
export const REPORT_TARGET_NOUN: Record<ReportTargetType, string> = {
  POST: 'post',
  COMMENT: 'comment',
  REVIEW: 'review',
  ITINERARY: 'itinerary',
};

/** The reason is trimmed before it is sent (the backend trims it too), so a blank or all-spaces reason is "missing". */
export function checkReason(reason: string): string | undefined {
  const text = reason.trim();
  if (text === '') return 'Tell us why you are reporting this.';
  if (text.length > REPORT_REASON_MAX_LENGTH) return `Use ${REPORT_REASON_MAX_LENGTH} characters or fewer. You used ${text.length}.`;
  return undefined;
}

export type ReportRefusal =
  | { kind: 'already-reported'; message: string }
  | { kind: 'gone'; message: string }
  | { kind: 'field'; message: string }
  | { kind: 'other'; message: string; hint: string; retryable: boolean };

/**
 * Sort a refused `POST /api/reports` into what the dialog should say.
 * 409 = this person already reported this item (the unique rule). 404 = the item does not exist or they cannot see it.
 * A 400 that names the `reason` field is shown under the field.
 */
export function classifyReportError(error: unknown, noun: string): ReportRefusal {
  if (error instanceof ApiError) {
    if (error.statusCode === 409) return { kind: 'already-reported', message: `You have already reported this ${noun}. Our team will look at it.` };
    if (error.statusCode === 404) return { kind: 'gone', message: `This ${noun} is no longer available, so it cannot be reported.` };
  }
  const friendly = toFriendlyError(error);
  const fieldError = friendly.fieldErrors.reason;
  if (fieldError) return { kind: 'field', message: fieldError };
  return { kind: 'other', message: friendly.message, hint: friendly.hint, retryable: friendly.retryable };
}
