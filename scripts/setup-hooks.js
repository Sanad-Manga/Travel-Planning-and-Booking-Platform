// Runs from `npm ci` / `npm install` in backend (the "prepare" script): points git at the shared .githooks
// folder so the pre-push check is active for everyone without any extra step. Never fails the install.
const { execSync } = require('node:child_process');
const path = require('node:path');

if (process.env.CI) process.exit(0);
try {
  execSync('git config core.hooksPath .githooks', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore',
  });
  console.log('git hooks enabled (.githooks/pre-push: build + lint before every push)');
} catch {
  // not a git checkout (e.g. a Docker build): nothing to do
}
