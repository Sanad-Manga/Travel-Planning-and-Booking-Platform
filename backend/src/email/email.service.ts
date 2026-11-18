import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_SENDER, EmailInput, EmailSender } from './email-sender';

/**
 * GEN-01-B: the published, cross-module entry point for sending a one-off email that does NOT
 * belong in the in-app notification feed — a moderator invitation carrying a temporary password,
 * an email-verification link, a password-reset link. Those must never be persisted into the
 * `notifications` collection (readable via GET /api/notifications), which is why this is a
 * separate capability from `NotificationsService.notify()` rather than a parameter on it.
 *
 * Call this directly for a one-off transactional email. `NotificationsService.notify()` already
 * calls it internally (and swallows failures) for the ordinary GEN-01 in-app-notification case —
 * callers of this method decide their own failure handling instead.
 */
@Injectable()
export class EmailService {
  constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

  send(input: EmailInput): Promise<void> {
    return this.sender.send(input);
  }
}
