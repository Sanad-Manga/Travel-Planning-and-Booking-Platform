import { Body, ConflictException, Controller, Get, INestApplication, NotFoundException, Post, Query } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsEmail, IsInt, IsNotEmpty, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import request from 'supertest';
import { PaginationDto } from '../src/common';
import { setupApp } from '../src/setup-app';

class ChildDto {
  @IsNotEmpty()
  name: string;
}

class SignupDto {
  @IsEmail()
  email: string;

  @IsInt()
  @Min(1)
  seats: number;

  @ValidateNested({ each: true })
  @Type(() => ChildDto)
  passengers: ChildDto[];
}

// Test-only controller: the skeleton ships no real endpoints, so this exercises the global pipe and filter.
@Controller('probe')
class ProbeController {
  @Post()
  create(@Body() dto: SignupDto) {
    return dto;
  }

  @Get('list')
  list(@Query() q: PaginationDto) {
    return q;
  }

  @Get('missing')
  missing() {
    throw new NotFoundException('Thing not found');
  }

  @Get('conflict')
  conflict() {
    throw new ConflictException('Sold out');
  }

  @Get('boom')
  boom() {
    throw new Error('secret internal detail');
  }
}

describe('global pipe, filter and prefix (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  const shape = expect.objectContaining({
    statusCode: expect.any(Number),
    error: expect.any(String),
    message: expect.any(String),
    path: expect.any(String),
    timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
  });

  it('serves under the /api prefix only', async () => {
    await request(app.getHttpServer()).get('/probe/list').expect(404);
    await request(app.getHttpServer()).get('/api/probe/list').expect(200);
  });

  it('returns validation errors in the contract shape with field details', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe')
      .send({ email: 'nope', seats: 0, passengers: [{ name: '' }], extra: 'x' })
      .expect(400);
    expect(res.body).toEqual(shape);
    expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', message: 'Validation failed', path: '/api/probe' });
    const fields = res.body.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'seats', 'passengers.0.name', 'extra']));
  });

  it('applies pagination defaults and rejects limit > 50', async () => {
    const ok = await request(app.getHttpServer()).get('/api/probe/list').expect(200);
    expect(ok.body).toEqual({ page: 1, limit: 10 });
    const bad = await request(app.getHttpServer()).get('/api/probe/list?limit=51').expect(400);
    expect(bad.body.details[0].field).toBe('limit');
  });

  it('maps 404 and 409', async () => {
    const nf = await request(app.getHttpServer()).get('/api/probe/missing').expect(404);
    expect(nf.body).toMatchObject({ statusCode: 404, error: 'Not Found', message: 'Thing not found' });
    const cf = await request(app.getHttpServer()).get('/api/probe/conflict').expect(409);
    expect(cf.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
  });

  it('hides internals on unexpected errors', async () => {
    const res = await request(app.getHttpServer()).get('/api/probe/boom').expect(500);
    expect(res.body).toMatchObject({ statusCode: 500, error: 'Internal Server Error', message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });

  it('reports malformed JSON as 400 in the same shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe')
      .set('Content-Type', 'application/json')
      .send('{bad json')
      .expect(400);
    expect(res.body).toEqual(shape);
  });
});
