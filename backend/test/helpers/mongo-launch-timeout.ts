/**
 * Shared Jest setup for the unit and e2e runs (issue #119).
 *
 * Almost every suite starts its own in-memory MongoDB. mongodb-memory-server gives a start only 10 seconds,
 * and starts queue up behind each other (about 2.4 s each on a development machine, longer while other test
 * runs are going), so with a worker per CPU thread the later workers hit the limit and fail their
 * `beforeAll`. The library has no global setting for that limit, only a per-call option, so it is raised
 * here once for every suite instead of in each of the 60 test files. A suite that passes its own
 * `launchTimeout` keeps it.
 */
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';

const LAUNCH_TIMEOUT_MS = 60_000;

type ServerOptions = NonNullable<
  Parameters<typeof MongoMemoryServer.create>[0]
>;
type ReplSetOptions = NonNullable<
  Parameters<typeof MongoMemoryReplSet.create>[0]
>;

const createServer = MongoMemoryServer.create.bind(MongoMemoryServer);
MongoMemoryServer.create = (opts: ServerOptions = {}) =>
  createServer({
    ...opts,
    instance: { launchTimeout: LAUNCH_TIMEOUT_MS, ...opts.instance },
  });

const createReplSet = MongoMemoryReplSet.create.bind(MongoMemoryReplSet);
MongoMemoryReplSet.create = (opts: ReplSetOptions = {}) => {
  const members = Math.max(
    opts.replSet?.count ?? 1,
    opts.instanceOpts?.length ?? 0,
  );
  return createReplSet({
    ...opts,
    instanceOpts: Array.from({ length: members }, (_, index) => ({
      launchTimeout: LAUNCH_TIMEOUT_MS,
      ...opts.instanceOpts?.[index],
    })),
  });
};
