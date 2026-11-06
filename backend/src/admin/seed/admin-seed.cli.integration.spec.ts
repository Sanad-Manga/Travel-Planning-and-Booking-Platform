import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  cp,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection, Model } from 'mongoose';
import { compare } from 'bcryptjs';
import { Role } from '../../common';
import { User, UserSchema } from '../../users/schemas/user.schema';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

const exec = promisify(execFile);
jest.setTimeout(180000);

describe('explicit administrator seed CLI, disposable database only', () => {
  let directory: string;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let users: Model<User>;
  let npmCli: string;
  const backend = resolve(__dirname, '../../..');
  const credentials = {
    ADMIN_SEED_NAME: 'CLI Fixture Administrator',
    ADMIN_SEED_EMAIL: 'cli-admin@example.test',
    ADMIN_SEED_PASSWORD: 'CliFixture9Password!',
  };
  const baseEnvironment = { ...process.env };
  for (const name of [
    'ADMIN_SEED_NAME',
    'ADMIN_SEED_EMAIL',
    'ADMIN_SEED_PASSWORD',
    'MONGODB_URI',
  ])
    delete baseEnvironment[name];

  beforeAll(async () => {
    if (!process.env.npm_execpath)
      throw new Error('Run CLI integration through npm test');
    npmCli = process.env.npm_execpath;
    directory = await mkdtemp(join(tmpdir(), 'acc18-admin-cli-'));
    // Copy sources/config only; no real environment file, existing dist or user data is copied.
    await cp(join(backend, 'src'), join(directory, 'src'), { recursive: true });
    for (const file of [
      'package.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'nest-cli.json',
    ])
      await copyFile(join(backend, file), join(directory, file));
    await symlink(
      join(backend, 'node_modules'),
      join(directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    mongo = await MongoMemoryServer.create({
      instance: { dbName: 'acc18_cli_disposable' },
    });
    connection = createConnection(mongo.getUri(), {
      autoIndex: false,
      autoCreate: false,
    });
    await connection.asPromise();
    users = connection.model(User.name, UserSchema);
    await writeFile(
      join(directory, '.env'),
      [
        `MONGODB_URI=${mongo.getUri()}`,
        ...Object.entries(credentials).map(
          ([name, value]) => `${name}=${value}`,
        ),
        '',
      ].join('\n'),
    );
  });

  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
    if (directory) {
      if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith('acc18-admin-cli-')
      )
        throw new Error('Refusing cleanup outside the test sandbox');
      await unlink(join(directory, 'node_modules')).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        },
      );
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('builds missing output, loads only synthetic environment credentials and supports safe npm reruns', async () => {
    const cli = join(directory, 'dist/admin/seed/seed-admin.js');
    await expect(access(cli)).rejects.toMatchObject({ code: 'ENOENT' });
    const options = {
      cwd: directory,
      env: baseEnvironment,
      maxBuffer: 1024 * 1024,
    };
    const first = await exec(
      process.execPath,
      [npmCli, 'run', 'seed:admin'],
      options,
    );
    expect(first.stdout).toContain('Administrator created successfully.');
    await expect(access(cli)).resolves.toBeUndefined();
    const before = await users.collection.findOne({
      email: credentials.ADMIN_SEED_EMAIL,
    });
    expect(before).toMatchObject({
      name: credentials.ADMIN_SEED_NAME,
      role: Role.ADMIN,
    });
    expect(
      await compare(credentials.ADMIN_SEED_PASSWORD, before!.passwordHash),
    ).toBe(true);
    const second = await exec(
      process.execPath,
      [npmCli, 'run', 'seed:admin'],
      options,
    );
    expect(second.stdout).toContain(
      'Administrator already exists; no account fields changed.',
    );
    expect(
      await users.collection.findOne({ email: credentials.ADMIN_SEED_EMAIL }),
    ).toEqual(before);
    expect(await users.countDocuments()).toBe(1);
    for (const result of [first, second]) {
      const output = result.stdout + result.stderr;
      expect(output).not.toContain(credentials.ADMIN_SEED_PASSWORD);
      expect(output).not.toContain(credentials.ADMIN_SEED_EMAIL);
      expect(output).not.toContain(mongo.getUri());
      expect(output).not.toContain(before!.passwordHash);
    }
  });

  it('fails configuration without connecting or writing, even when a development .env would otherwise exist', async () => {
    const cli = join(directory, 'dist/admin/seed/seed-admin.js');
    const before = await users.collection.find({}).toArray();
    // No --env-file: the only file available here is synthetic; real credentials never enter the test.
    // Shared User imports call dotenv, so explicitly blank values take precedence over any env-file values.
    await expect(
      exec(process.execPath, [cli], {
        cwd: directory,
        env: {
          ...baseEnvironment,
          ...credentials,
          ADMIN_SEED_PASSWORD: '',
          MONGODB_URI: mongo.getUri(),
        },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        'Invalid administrator seed configuration',
      ),
    });
    expect(await users.collection.find({}).toArray()).toEqual(before);
  });

  it('sanitizes malformed connection failures and non-admin collisions with nonzero exits', async () => {
    const cli = join(directory, 'dist/admin/seed/seed-admin.js');
    try {
      await exec(process.execPath, [cli], {
        cwd: directory,
        env: {
          ...baseEnvironment,
          ...credentials,
          MONGODB_URI: 'mongodb://private-user:private-password@[',
        },
      });
      throw new Error('Expected connection failure');
    } catch (error) {
      const failure = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      expect(failure.code).toBe(1);
      expect(failure.stderr).toContain('database operation failed');
      expect(`${failure.stdout}${failure.stderr}`).not.toMatch(
        /private-user|private-password|mongodb:\/\//,
      );
      expect(`${failure.stdout}${failure.stderr}`).not.toContain(
        credentials.ADMIN_SEED_PASSWORD,
      );
    }
    const email = 'cli-ordinary@example.test';
    await users.create({
      name: 'Ordinary Fixture',
      email,
      passwordHash: 'synthetic-non-login-hash',
      consentAcceptedAt: new Date(),
    });
    const before = await users.collection.findOne({ email });
    await expect(
      exec(process.execPath, [cli], {
        cwd: directory,
        env: {
          ...baseEnvironment,
          ...credentials,
          ADMIN_SEED_EMAIL: email,
          MONGODB_URI: mongo.getUri(),
        },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('belongs to a non-administrator'),
    });
    expect(await users.collection.findOne({ email })).toEqual(before);
  });
});
