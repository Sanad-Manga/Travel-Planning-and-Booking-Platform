import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  cp,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection } from 'mongoose';
import {
  createReferenceModels,
  ReferenceModels,
} from '../reference-data.models';
import { loadReferenceData, ReferenceData } from './reference-data.loader';

const exec = promisify(execFile);
jest.setTimeout(180000);

describe('npm run seed shortcut with disposable MongoDB only', () => {
  let directory: string;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let models: ReferenceModels;
  let data: ReferenceData;
  let npmCli: string;
  const backend = resolve(__dirname, '../../..');

  beforeAll(async () => {
    if (!process.env.npm_execpath)
      throw new Error('Run the seed-shortcut tests through npm test');
    npmCli = process.env.npm_execpath;
    directory = await mkdtemp(join(tmpdir(), 'gen12-seed-shortcut-'));
    // Copy only source, official data and build manifests. Never read/copy the developer's .env.
    await cp(join(backend, 'src'), join(directory, 'src'), { recursive: true });
    await cp(join(backend, 'data'), join(directory, 'data'), {
      recursive: true,
    });
    for (const file of [
      'package.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'nest-cli.json',
    ]) {
      await copyFile(join(backend, file), join(directory, file));
    }
    await symlink(
      join(backend, 'node_modules'),
      join(directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    mongo = await MongoMemoryServer.create({
      instance: { dbName: 'gen12_shortcut_disposable' },
    });
    connection = createConnection(mongo.getUri(), {
      autoIndex: false,
      autoCreate: false,
    });
    await connection.asPromise();
    models = createReferenceModels(connection);
    data = await loadReferenceData();
    // This is a new synthetic file inside our temporary directory, containing only our own URI.
    await writeFile(join(directory, '.env'), `MONGODB_URI=${mongo.getUri()}\n`);
  });

  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
    if (directory) {
      if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith('gen12-seed-shortcut-')
      ) {
        throw new Error(
          'Refusing to remove a directory outside the test sandbox',
        );
      }
      // Unlink the dependency junction before recursive cleanup, leaving the original dependencies intact.
      await unlink(join(directory, 'node_modules')).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        },
      );
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('builds missing output and loads the synthetic .env before seeding the default official directory', async () => {
    const cli = join(directory, 'dist/reference-data/seed/seed.js');
    await expect(access(cli)).rejects.toMatchObject({ code: 'ENOENT' });
    const env = { ...process.env };
    delete env.MONGODB_URI;
    const result = await exec(process.execPath, [npmCli, 'run', 'seed'], {
      cwd: directory,
      env,
      maxBuffer: 1024 * 1024,
    });
    await expect(access(cli)).resolves.toBeUndefined();
    for (const [name, model] of Object.entries(models)) {
      expect(await model.countDocuments()).toBe(
        data[name as keyof ReferenceData].length,
      );
    }
    expect(
      await models.airports
        .findOne({ iata_code: data.airports[0].iata_code })
        .lean(),
    ).toMatchObject(data.airports[0]);
    expect(result.stdout).not.toContain(mongo.getUri());
    expect(result.stderr).not.toContain(mongo.getUri());
  });

  it('forwards a custom data directory containing spaces and preserves explicit environment precedence', async () => {
    const custom = join(directory, 'custom official data');
    await mkdir(custom);
    await Promise.all([
      writeFile(
        join(custom, 'Countries.csv'),
        'code,name,currency\nYY,Shortcut fixture,USD\n',
      ),
      writeFile(
        join(custom, 'Cities.csv'),
        'city_id,name,country_code\nshortcut-city,Shortcut City,YY\n',
      ),
      writeFile(
        join(custom, 'Airports.csv'),
        'iata_code,name,city_id,country_code,time_zone\nTST,Shortcut Airport,shortcut-city,YY,Etc/UTC\n',
      ),
      writeFile(
        join(custom, 'Attractions.csv'),
        'attraction_id,name,city_id\nshortcut-att,Shortcut Attraction,shortcut-city\n',
      ),
    ]);
    // If the env-file could override the explicitly supplied URI, this test would fail locally.
    await writeFile(
      join(directory, '.env'),
      'MONGODB_URI=mongodb://127.0.0.1:1/not_used\n',
    );
    const result = await exec(
      process.execPath,
      [npmCli, 'run', 'seed', '--', custom],
      {
        cwd: directory,
        env: { ...process.env, MONGODB_URI: mongo.getUri() },
        maxBuffer: 1024 * 1024,
      },
    );
    expect(
      await models.airports.findOne({ iata_code: 'TST' }).lean(),
    ).toMatchObject({
      name: 'Shortcut Airport',
      city_id: 'shortcut-city',
      country_code: 'YY',
      time_zone: 'Etc/UTC',
    });
    expect(
      await models.cities.findOne({ city_id: 'shortcut-city' }).lean(),
    ).toMatchObject({ country_code: 'YY' });
    expect(
      await models.attractions
        .findOne({ attraction_id: 'shortcut-att' })
        .lean(),
    ).toMatchObject({ city_id: 'shortcut-city' });
    expect(result.stdout).not.toContain(mongo.getUri());
    expect(result.stderr).not.toContain(mongo.getUri());
  });
});
