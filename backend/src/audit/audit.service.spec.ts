import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Role } from '../common';
import {
  AuditLogInput,
  prepareAuditInput,
  safeAuditDetails,
} from './audit-input';
import { AuditService } from './audit.service';
import { AuditLog } from './schemas/audit-log.schema';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

describe('AuditService contract, validation and failure handling', () => {
  let service: AuditService;
  const model = {
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
  };
  const input: AuditLogInput = {
    actorId: 'actor-1',
    action: 'USER_SUSPENDED',
    targetType: 'User',
    targetId: 'user-1',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    model.create.mockResolvedValue({});
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getModelToken(AuditLog.name), useValue: model },
      ],
    }).compile();
    service = moduleRef.get(AuditService);
  });

  it('accepts the exact one-object contract, resolves void and maps only trusted fields', async () => {
    const incoming = {
      ...input,
      createdAt: '1900-01-01',
      updatedAt: '1900-01-01',
      _id: 'untrusted',
    };
    const result: void = await service.log(incoming);
    expect(result).toBeUndefined();
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(model.create).toHaveBeenCalledWith(input);
  });

  it('does not resolve until the insert completes', async () => {
    let finish!: () => void;
    model.create.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let completed = false;
    const pending = service.log(input).then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    finish();
    await pending;
    expect(completed).toBe(true);
  });

  it('copies safe nested details and preserves arbitrary administrative context', async () => {
    const details = {
      reason: 'User requested password reset',
      before: { status: 'ACTIVE' },
      after: { status: 'SUSPENDED' },
      targets: ['CAI', 'att-1'],
      approved: true,
      count: 2,
      note: null,
    };
    await service.log({ ...input, details });
    details.before.status = 'CHANGED';
    expect(model.create.mock.calls[0][0].details.before.status).toBe('ACTIVE');
    expect(model.create.mock.calls[0][0].details.targets).toEqual([
      'CAI',
      'att-1',
    ]);
  });

  it('rejects write failures without retrying or retaining raw driver details', async () => {
    model.create.mockRejectedValueOnce(
      new Error(
        'mongodb://fake-user:fake-password@invalid private internal values',
      ),
    );
    await expect(service.log(input)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(model.create).toHaveBeenCalledTimes(1);
    model.create.mockRejectedValueOnce(
      new Error('credential-shaped synthetic diagnostic'),
    );
    await expect(service.log(input)).rejects.toThrow(
      'Audit record could not be persisted',
    );
  });

  it.each(['actorId', 'action', 'targetType', 'targetId'] as const)(
    'rejects invalid %s before writing without printing its value',
    async (key) => {
      for (const value of ['', '  ', undefined, 42, 'a'.repeat(1025)]) {
        await expect(
          service.log({ ...input, [key]: value } as unknown as AuditLogInput),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(model.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['password field', { password: 'synthetic-not-a-real-password' }],
    ['nested password hash', { before: { Password_Hash: 'synthetic-value' } }],
    ['access token', { session: { access_token: 'synthetic-value' } }],
    ['authorization header', { authorization: 'synthetic-value' }],
    ['cookies', { request: { cookies: 'synthetic-value' } }],
    ['stripe secret', { stripeSecretKey: 'synthetic-value' }],
    ['card details', { cardNumber: 'synthetic-value' }],
    ['raw request body', { rawBody: { email: 'fixture@example.test' } }],
    ['obfuscated password abbreviation', { p_w_d: 'synthetic-value' }],
    [
      'JWT value',
      { reason: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.signature' },
    ],
    ['bcrypt-shaped hash', { reason: `$2b$10$${'a'.repeat(53)}` }],
    ['Bearer value', { reason: 'Bearer synthetic-token' }],
    ['Stripe-shaped key', { reason: 'sk_test_syntheticvalue' }],
    ['Mongo URI', { reason: 'mongodb://fixture:fixture@localhost/test' }],
    ['card-like value', { note: '4242 4242 4242 4242' }],
    ['secret assignment', { note: 'password=synthetic-value' }],
  ])(
    'rejects %s without storing or echoing its contents',
    async (_label, details) => {
      await expect(service.log({ ...input, details })).rejects.toThrow(
        'Audit details contain sensitive, oversized or unsupported data',
      );
      expect(model.create).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed, cyclic, oversized or excessively nested JSON without invoking getters', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    let nested: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) nested = { child: nested };
    const getter = jest.fn(() => {
      throw new Error('synthetic-private-diagnostic');
    });
    const accessor = Object.defineProperty({}, 'reason', { get: getter });
    for (const details of [
      null,
      [],
      new Date(),
      cycle,
      nested,
      accessor,
      { reason: 'x'.repeat(16385) },
      { value: NaN },
      { value: BigInt(1) },
      { value: undefined },
      { value: () => true },
      { many: Array.from({ length: 1001 }, () => true) },
      JSON.parse('{"__proto__":{"value":true}}'),
    ]) {
      expect(() => safeAuditDetails(details)).toThrow(BadRequestException);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('allows arbitrary non-ObjectId reference targets and rejects credential-shaped top-level values', () => {
    expect(prepareAuditInput({ ...input, targetId: 'CAI' }).targetId).toBe(
      'CAI',
    );
    expect(prepareAuditInput({ ...input, targetId: 'att-001' }).targetId).toBe(
      'att-001',
    );
    expect(() =>
      prepareAuditInput({ ...input, targetId: 'Bearer synthetic-token' }),
    ).toThrow('Invalid audit targetId');
  });

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'also denies %s when listing is called directly',
    async (role) => {
      await expect(
        service.list({ userId: 'actor-1', role }, { page: 1, limit: 10 }),
      ).rejects.toThrow('Administrator role required');
      expect(model.find).not.toHaveBeenCalled();
    },
  );
});
