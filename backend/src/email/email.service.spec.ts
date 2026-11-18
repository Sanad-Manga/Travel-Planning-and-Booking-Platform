import { EmailService } from './email.service';
import { FakeEmailSender } from './fake-email-sender';

describe('EmailService', () => {
  it('delegates to the underlying sender', async () => {
    const sender = new FakeEmailSender();
    const service = new EmailService(sender);

    await service.send({ to: 'user@example.com', subject: 'Hi', text: 'Hello there' });

    expect(sender.sent).toEqual([{ to: 'user@example.com', subject: 'Hi', text: 'Hello there' }]);
  });

  it('propagates a send failure rather than swallowing it — the caller decides how to handle it', async () => {
    const sender = new FakeEmailSender();
    sender.failNextSendOnce = true;
    const service = new EmailService(sender);

    await expect(service.send({ to: 'user@example.com', subject: 'Hi', text: 'Hello there' })).rejects.toThrow(
      'fake SMTP failure',
    );
  });
});
