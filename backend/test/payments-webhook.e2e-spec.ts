import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import Stripe from 'stripe';
import configuration from '../src/config/configuration';
import { PaymentsModule } from '../src/payments';
import { setupApp, setupSwagger } from '../src/setup-app';

const WEBHOOK_SECRET = 'whsec_test_secret_for_e2e_only';

/**
 * PAY-01's one genuinely new piece of infra: a route that needs the exact raw request bytes to
 * verify Stripe's signature (every other route in this app keeps using the normal parsed body).
 * `PaymentsService.handleWebhookEvent`'s actual confirm/fail/idempotent business logic is unit
 * tested with a fake gateway (payments.service.spec.ts); this test exercises only the real HTTP
 * + raw-body + signature-verification plumbing, with a real HMAC signature via the Stripe SDK.
 */
describe('POST /api/payments/webhook (PAY-01) over HTTP', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;

  const http = () => request(app.getHttpServer());

  async function sign(payload: string): Promise<string> {
    return Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET });
  }

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_for_e2e_only';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        PaymentsModule,
      ],
    }).compile();

    // rawBody: true is what main.ts also sets — without it req.rawBody is undefined and the
    // controller rejects every request with "Missing Stripe signature or raw body".
    app = moduleRef.createNestApplication({ rawBody: true });
    setupApp(app);
    setupSwagger(app);
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('rejects a request with no stripe-signature header', async () => {
    await http().post('/api/payments/webhook').send({ type: 'payment_intent.succeeded' }).expect(400);
  });

  it('rejects a request whose signature does not match the raw body', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
    const signatureForOriginalPayload = await sign(payload);
    const tampered = payload.replace('pi_1', 'pi_attacker_substituted');

    await http()
      .post('/api/payments/webhook')
      .set('stripe-signature', signatureForOriginalPayload) // signs the ORIGINAL payload
      .set('Content-Type', 'application/json')
      .send(tampered) // but the body sent is different — signature must no longer verify
      .expect(400);
  });

  it('accepts a correctly signed event and acknowledges it', async () => {
    const payload = JSON.stringify({
      id: 'evt_2',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_unknown_to_this_test' } },
    });
    const signature = await sign(payload);

    const response = await http()
      .post('/api/payments/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201); // Nest's default success status for @Post() (no @HttpCode override on this route)

    // No Payment row matches 'pi_unknown_to_this_test' — PaymentsService.handleWebhookEvent
    // silently ignores an unrecognized intent (unit-tested in payments.service.spec.ts); here
    // we only need to see the signature-verified request reach the handler and get acknowledged.
    expect(response.body).toEqual({ received: true });
  });

  it('documents the create/retry/get endpoints in Swagger (the webhook route is intentionally excluded)', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    expect(response.body.paths['/api/payments'].post).toBeDefined();
    expect(response.body.paths['/api/payments/{id}/retry'].post).toBeDefined();
    expect(response.body.paths['/api/payments/{id}'].get).toBeDefined();
    // Stripe calls the webhook directly, not a logged-in user — @ApiExcludeEndpoint() keeps it
    // out of the public Swagger doc rather than documenting it as a user-facing operation.
    expect(response.body.paths['/api/payments/webhook']).toBeUndefined();
  });
});
