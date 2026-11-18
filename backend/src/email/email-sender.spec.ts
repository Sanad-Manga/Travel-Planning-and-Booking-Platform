import { Logger } from '@nestjs/common';

const createTransport = jest.fn();
const createTestAccount = jest.fn();
const getTestMessageUrl = jest.fn();
const sendMail = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: (...args: unknown[]) => createTransport(...args),
    createTestAccount: (...args: unknown[]) => createTestAccount(...args),
    getTestMessageUrl: (...args: unknown[]) => getTestMessageUrl(...args),
  },
}));

// Imported after the mock so SmtpEmailSender picks up the mocked module.
import { SmtpEmailSender } from './email-sender';

describe('SmtpEmailSender', () => {
  const originalEnv = { ...process.env };
  let logLog: jest.SpyInstance;
  let logWarn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;
    createTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({ messageId: 'abc' });
    logLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    logLog.mockRestore();
    logWarn.mockRestore();
  });

  it('uses real SMTP from env vars when SMTP_HOST is configured, and never touches the test-account API', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '2525';
    process.env.SMTP_USER = 'team@example.com';
    process.env.SMTP_PASSWORD = 'secret';
    process.env.SMTP_FROM = 'noreply@example.com';
    const sender = new SmtpEmailSender();

    await sender.send({ to: 'user@example.com', subject: 'Hi', text: 'Hello' });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 2525,
      auth: { user: 'team@example.com', pass: 'secret' },
    });
    expect(createTestAccount).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith({ from: 'noreply@example.com', to: 'user@example.com', subject: 'Hi', text: 'Hello' });
  });

  it('falls back to a cached Ethereal test account when SMTP_HOST is not configured', async () => {
    createTestAccount.mockResolvedValue({
      user: 'ethereal-user',
      pass: 'ethereal-pass',
      smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
    });
    const sender = new SmtpEmailSender();

    await sender.send({ to: 'user@example.com', subject: 'Hi', text: 'Hello' });
    await sender.send({ to: 'user2@example.com', subject: 'Hi again', text: 'Hello again' });

    expect(createTestAccount).toHaveBeenCalledTimes(1); // the transporter is built once and reused
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it('logs a preview URL for a sent test-inbox email, never credentials', async () => {
    createTestAccount.mockResolvedValue({
      user: 'ethereal-user',
      pass: 'ethereal-pass',
      smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
    });
    getTestMessageUrl.mockReturnValue('https://ethereal.email/message/abc');
    const sender = new SmtpEmailSender();

    await sender.send({ to: 'user@example.com', subject: 'Hi', text: 'Hello' });

    expect(logLog).toHaveBeenCalledWith(expect.stringContaining('https://ethereal.email/message/abc'));
    const loggedText = logLog.mock.calls.flat().join(' ');
    expect(loggedText).not.toContain('ethereal-pass');
  });
});
