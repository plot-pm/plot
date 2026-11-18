/**
 * What the two listing recorders share to record a Jenkins arm.
 *
 * `record-github-pr-listing.mjs` and `record-bitbucket-pr-listing.mjs` run
 * `plot-host.sh pr-list` with `CI: jenkins`, the real `jen` (through a
 * recording shim on `PATH`) and a stub Jenkins on 127.0.0.1. The Jenkins
 * answers are a multibranch listing of branch colours and, per branch, the
 * builds the listing's sha lookups read. Nothing here makes a network call
 * or reads a credential: `jen` runs with fixture credentials in a scratch
 * store.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The instance `JENKINS_INSTANCE` names: host, then the job path below it. */
export const INSTANCE = 'jenkins.example.org/team/portal';

/** The `jen` version the fixtures are recorded with. */
export const JEN_VERSION = '0.4.0';

const MULTIBRANCH = 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject';
const JOB = 'org.jenkinsci.plugins.workflow.job.WorkflowJob';
const T0 = 1_700_000_000_000;

/** The real `jen`, refused unless it reports the version the fixtures name. */
export const realJen = () => {
  const jen = execFileSync('bash', ['-c', 'command -v jen'], { encoding: 'utf8' }).trim();
  const version = execFileSync(jen, ['--version'], { encoding: 'utf8' }).trim();
  if (!version.endsWith(` ${JEN_VERSION}`)) throw new Error(`jen reports '${version}'; this recorder is for ${JEN_VERSION}`);
  return { jen, version };
};

/**
 * The routes of one Jenkins scenario.
 *
 * @param spec - `colours`: each branch's job colour in the multibranch listing;
 *   `builds`: each branch's builds as `{ number, result, sha }`, newest first. A
 *   branch with no entry has no builds route, so a read by commit reads an empty history;
 *   `failing`: branches whose builds read answers HTTP 500, and so does the job's own
 *   builds read, so a read by commit cannot ask at all.
 * @returns the routes, keyed by the request path the stub serves.
 */
export const jenkinsRoutes = (spec) => {
  const encode = (branch) => encodeURIComponent(branch);
  const routes = {
    '/me/api/json': { body: { fullName: 'Fixture User', id: 'fixture' } },
    '/job/team/job/portal/api/json': {
      body: {
        _class: MULTIBRANCH,
        jobs: Object.entries(spec.colours).map(([branch, color]) => ({ _class: JOB, name: encode(branch), color })),
      },
    },
  };
  for (const [branch, builds] of Object.entries(spec.builds ?? {})) {
    routes[`/job/team/job/portal/job/${encode(branch)}/api/json`] = {
      body: {
        _class: 'x',
        builds: builds.map((one) => ({
          _class: 'org.jenkinsci.plugins.workflow.job.WorkflowRun',
          number: one.number,
          result: one.result,
          building: one.result === null,
          timestamp: T0 + one.number * 60_000 + 999,
          url: `http://stub/job/team/job/portal/job/${encode(branch)}/${one.number}/`,
          actions: [{}, { _class: 'hudson.plugins.git.util.BuildData', lastBuiltRevision: { SHA1: one.sha, branch: [{ SHA1: one.sha, name: `origin/${branch}` }] } }],
        })),
      },
    };
  }
  const failing = spec.failing ?? [];
  for (const branch of failing) routes[`/job/team/job/portal/job/${encode(branch)}/api/json`] = { body: {}, failIf: 'builds' };
  if (failing.length > 0) routes['/job/team/job/portal/api/json'].failIf = 'builds%5B';
  return routes;
};

/** A stub Jenkins on 127.0.0.1 under `/jenkins`; it keeps every request path it served. */
export const startJenkins = async (routes) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    req.resume();
    const url = req.url ?? '';
    seen.push(url);
    const route = routes[url.split('?')[0].replace(/^\/jenkins/, '')];
    if (route === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html>not found</html>');
      return;
    }
    if (route.failIf !== undefined && url.includes(route.failIf)) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<html>boom</html>');
      return;
    }
    let text = JSON.stringify(route.body ?? {});
    const window = /%7B0,(\d+)%7D/.exec(url) ?? /\{0,(\d+)\}/.exec(url);
    if (Array.isArray(route.body?.builds) && window !== null) text = JSON.stringify({ ...route.body, builds: route.body.builds.slice(0, Number(window[1])) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(text);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    seen,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
};

/**
 * A `jen` on `PATH` that runs the real one and keeps what it was asked and answered.
 *
 * @param bin - the directory the shim goes in.
 * @param calls - the directory the call records go in.
 * @param jen - the real `jen`.
 */
export const jenShim = (bin, calls, jen) => {
  writeFileSync(
    join(bin, 'jen'),
    [
      '#!/usr/bin/env bash',
      `dir=${JSON.stringify(calls)}`,
      'n=$(ls "$dir" | grep -c "\\.argv$")',
      'printf \'%s\\n\' "$@" > "$dir/call-$n.argv"',
      `${JSON.stringify(jen)} "$@" > "$dir/call-$n.out" 2> "$dir/call-$n.err"`,
      'code=$?',
      'echo "$code" > "$dir/call-$n.code"',
      'cat "$dir/call-$n.out"; cat "$dir/call-$n.err" >&2',
      'exit "$code"',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'jen'), 0o755);
};

/** The `jen` calls recorded in a directory, in order, with the stub's port as `{{PORT}}`. */
export const jenCallsIn = (dir, port) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.argv'))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((f) => {
      const base = join(dir, f.replace(/\.argv$/, ''));
      const portless = (text) => text.replaceAll(`127.0.0.1:${port}`, '127.0.0.1:{{PORT}}');
      return {
        argv: readFileSync(`${base}.argv`, 'utf8').split('\n').slice(0, -1),
        stdout: portless(readFileSync(`${base}.out`, 'utf8')),
        stderr: portless(readFileSync(`${base}.err`, 'utf8')),
        code: Number(readFileSync(`${base}.code`, 'utf8')),
      };
    });

/**
 * The environment `plot-host.sh pr-list` runs in for the Jenkins arm.
 *
 * @param port - the stub Jenkins' port.
 * @param store - a scratch directory for `jen`'s config and `HOME`.
 */
export const jenkinsEnv = (port, store) => ({
  PLOT_CI: 'jenkins',
  JENKINS_INSTANCE: INSTANCE,
  HOME: store,
  JEN_URL: `http://127.0.0.1:${port}/jenkins`,
  JEN_CONFIG_DIR: store,
  JEN_TOKEN: 'fixture-bearer',
  JENKINS_USER: 'fixture',
  JENKINS_API_TOKEN: 'fixture-api-token',
  JEN_REALM_URL: 'https://id.example.org/realms/r',
  PLOT_JEN_BOUND_S: '10',
});

/** Makes the scratch directories one Jenkins recording needs: the shim's `bin`, the call records and the `jen` store. */
export const jenkinsScratch = (parent) => {
  const root = mkdtempSync(join(parent.length > 60 ? '/tmp' : tmpdir(), 'jlr-'));
  const dirs = { root, bin: join(root, 'jbin'), calls: join(root, 'jcalls'), store: join(root, 'jstore') };
  for (const dir of [dirs.bin, dirs.calls, dirs.store]) mkdirSync(dir);
  return dirs;
};
