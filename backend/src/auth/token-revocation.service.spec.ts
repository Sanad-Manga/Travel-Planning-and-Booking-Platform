import { TokenRevocationService } from './token-revocation.service';

const USER_ID = '64b7f0f2a1b2c3d4e5f60718';
const EXPIRES = new Date('2030-01-01T00:00:00.000Z');

describe('TokenRevocationService.consume (issue #115)', () => {
  const exec = jest.fn();
  const model = { updateOne: jest.fn(() => ({ exec })), exists: jest.fn() };
  const service = new TokenRevocationService(model as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns true when this call inserted the row, using an upsert that never overwrites', async () => {
    exec.mockResolvedValue({ upsertedCount: 1 });
    await expect(service.consume('jti-1', USER_ID, EXPIRES)).resolves.toBe(true);
    expect(model.updateOne).toHaveBeenCalledWith(
      { jti: 'jti-1' },
      { $setOnInsert: expect.objectContaining({ jti: 'jti-1', expiresAt: EXPIRES }) },
      { upsert: true },
    );
  });

  it('returns false when the jti was already consumed or revoked', async () => {
    exec.mockResolvedValue({ upsertedCount: 0 });
    await expect(service.consume('jti-1', USER_ID, EXPIRES)).resolves.toBe(false);
  });

  it('returns false on a duplicate key error (lost the race)', async () => {
    exec.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    await expect(service.consume('jti-1', USER_ID, EXPIRES)).resolves.toBe(false);
  });

  it('propagates any other database error', async () => {
    exec.mockRejectedValue(Object.assign(new Error('network'), { code: 6 }));
    await expect(service.consume('jti-1', USER_ID, EXPIRES)).rejects.toThrow('network');
  });
});
