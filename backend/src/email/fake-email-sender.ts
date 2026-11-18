import { EmailInput, EmailSender } from './email-sender';

/** In-memory stand-in for EmailSender, in the style of FakeStripeGateway/FakeExchangeRateProvider. */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailInput[] = [];
  /** Test helper: makes the NEXT send() call throw instead of succeeding. */
  failNextSendOnce = false;

  async send(input: EmailInput): Promise<void> {
    if (this.failNextSendOnce) {
      this.failNextSendOnce = false;
      throw new Error('fake SMTP failure');
    }
    this.sent.push(input);
  }
}
