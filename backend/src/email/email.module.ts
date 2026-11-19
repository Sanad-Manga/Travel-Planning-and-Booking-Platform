import { Module } from '@nestjs/common';
import { EMAIL_SENDER, NoopEmailSender, SmtpEmailSender } from './email-sender';
import { EmailService } from './email.service';

@Module({
  providers: [
    EmailService,
    {
      provide: EMAIL_SENDER,
      // Jest sets NODE_ENV=test by default. Every e2e spec boots the full module graph, including
      // this one, through NotificationsModule — without this, each would reach Ethereal over the
      // real network on every notify() call. No e2e spec asserts on sent email content, so a
      // genuine SMTP round trip there buys nothing but slowness and noise.
      useClass: process.env.NODE_ENV === 'test' ? NoopEmailSender : SmtpEmailSender,
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
