import { validateSync } from 'class-validator';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { RegisterDto } from '../dto/register.dto';
import { IsValidPassword } from './password.decorator';

class Sample {
  @IsValidPassword()
  secret: unknown;
}

const messagesFor = (value: unknown): string[] => {
  const sample = new Sample();
  sample.secret = value;
  return validateSync(sample).flatMap((e) => Object.values(e.constraints ?? {}));
};

describe('IsValidPassword (shared password rule)', () => {
  it.each(['Passw0rdOK', 'abcdefg1', 'عربيعربي1', 'a'.repeat(71) + '1'])('accepts %s', (value) => {
    expect(messagesFor(value)).toEqual([]);
  });

  it('rejects fewer than 8 characters', () => {
    expect(messagesFor('abc1')).toEqual(['secret must be at least 8 characters']);
  });

  it('rejects a password without a digit', () => {
    expect(messagesFor('abcdefgh')).toEqual(['secret must contain at least one digit']);
  });

  it('rejects a password without a letter', () => {
    expect(messagesFor('12345678')).toEqual(['secret must contain at least one letter']);
  });

  it('reports the length rule together with a letter/digit rule', () => {
    // class-validator keys messages by constraint name, so the two @Matches rules share one slot (same as before ACC-08).
    const messages = messagesFor('!!!');
    expect(messages).toContain('secret must be at least 8 characters');
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects more than 72 bytes (bcrypt would silently truncate)', () => {
    expect(messagesFor('a'.repeat(72) + '1')).toEqual([expect.stringContaining('too long')]);
  });

  it.each([undefined, null, 12345678, ['abcdefg1']])('rejects non-strings (%p)', (value) => {
    expect(messagesFor(value).length).toBeGreaterThan(0);
  });

  it('is the SAME rule on registration and change password (one validator, not two copies)', () => {
    const register = Object.assign(new RegisterDto(), { name: 'Ali', email: 'a@b.co', password: 'weak', acceptTerms: true });
    const change = Object.assign(new ChangePasswordDto(), { currentPassword: 'x', newPassword: 'weak' });
    const registerMessages = validateSync(register).flatMap((e) => Object.values(e.constraints ?? {}));
    const changeMessages = validateSync(change).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(registerMessages.map((m) => m.replace('password', 'X'))).toEqual(changeMessages.map((m) => m.replace('newPassword', 'X')));
  });
});
