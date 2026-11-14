import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { validateSync } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { BCRYPT_SALT_ROUNDS } from '../auth/auth.service';
import { IsValidPassword } from '../auth/validators/password.decorator';

class TemporaryPasswordCandidate {
  @IsValidPassword()
  password: string;
}

/** Internal generation only. The reset service persists just the hash/expiration and
 * atomically establishes forced-change state before returning the secret to ADMIN.
 * Plaintext is ephemeral and must never enter logs or persistence.
 */
@Injectable()
export class TemporaryPasswordService {
  async generate(): Promise<{
    temporaryPassword: string;
    passwordHash: string;
    expiresAt: Date;
  }> {
    try {
      const generatedAt = Date.now();
      // 24 random bytes = 192 random bits. The fixed prefix contributes no entropy;
      // it guarantees compatibility with the shared letter/digit rules.
      const temporaryPassword = `A7${randomBytes(24).toString('base64url')}`;
      const candidate = new TemporaryPasswordCandidate();
      candidate.password = temporaryPassword;
      const errors = validateSync(candidate, {
        validationError: { target: false, value: false },
      });
      if (errors.length) throw new Error();
      const passwordHash = await hash(temporaryPassword, BCRYPT_SALT_ROUNDS);
      return {
        temporaryPassword,
        passwordHash,
        expiresAt: new Date(generatedAt + 24 * 60 * 60 * 1000),
      };
    } catch {
      // Never forward crypto/hash/validation targets, plaintext, or a raw cause.
      throw new InternalServerErrorException(
        'Temporary credential generation failed',
      );
    }
  }
}
