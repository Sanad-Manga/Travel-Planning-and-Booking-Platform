import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * The one outbound call to an SMTP server. Owned by Payments (GEN-01-B). Never decides what to
 * send or to whom — that's EmailService's callers' job; this only talks to SMTP and throws on
 * failure (bad credentials, network error, missing config).
 */
export interface EmailSender {
  send(input: EmailInput): Promise<void>;
}

/** DI token for EmailSender (an interface has no runtime value to inject by). */
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

/**
 * Real implementation, using `nodemailer` (already a dependency, unused until now — same situation
 * `stripe` was in for PAY-01). Builds its transporter **lazily** (first `send()` call, never the
 * constructor): several e2e specs boot modules that transitively pull in `EmailModule` without ever
 * configuring SMTP, and must keep working as long as they never actually send an email.
 *
 * If `SMTP_HOST` is configured, mail goes through that real server. If not — the expected case in
 * local development, per the ticket's "in development a test inbox is used" — a free Ethereal test
 * account is created on first use and cached for the life of the process; nothing needs to be
 * registered or configured by hand. Only the preview URL for each sent message is logged, never
 * credentials (the ticket's own checklist: "SMTP credentials only in env, never logged").
 */
@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly logger = new Logger(SmtpEmailSender.name);
  private transporter?: Transporter;
  private from?: string;

  private async getTransporter(): Promise<Transporter> {
    if (this.transporter) return this.transporter;

    const host = process.env.SMTP_HOST;
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT) || 587,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      });
      this.from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
      return this.transporter;
    }

    const testAccount = await nodemailer.createTestAccount();
    this.transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    this.from = testAccount.user;
    this.logger.warn('SMTP_HOST is not configured — using a throwaway Ethereal test inbox for this process.');
    return this.transporter;
  }

  async send(input: EmailInput): Promise<void> {
    const transporter = await this.getTransporter();
    const info = await transporter.sendMail({ from: this.from, ...input });
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) this.logger.log(`Email preview (test inbox): ${previewUrl}`);
  }
}
