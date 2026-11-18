import { Module } from '@nestjs/common';
import { EMAIL_SENDER, SmtpEmailSender } from './email-sender';
import { EmailService } from './email.service';

@Module({
  providers: [EmailService, { provide: EMAIL_SENDER, useClass: SmtpEmailSender }],
  exports: [EmailService],
})
export class EmailModule {}
