#!/usr/bin/env node
/**
 * Records the fixtures `jen-url.corpus.test.ts` reads.
 *
 * A person runs it once per `jen` version. It refuses any `jen` that does not
 * report `0.4.0`. It makes no network call: the shell functions run on fixed
 * inputs in bash, and the real `jen` runs against a stub Jenkins on
 * 127.0.0.1 with fixture credentials in a scratch store.
 *
 * It writes `fixtures/jenkins-reads/`:
 *
 * - `url-functions.json`: for each case, what the functions lifted from `jen`
 *   with `awk` answered (`jen_url_for`, `jen_url_host`, `jen_key_for`,
 *   `jen_instance_url`, `jen_secret_file`, `jen_save_token`, `jen_job_path`,
 *   `jen_check_http`).
 * - `jen-outputs.json`: what `jen auth status`, `jen job view --json`,
 *   `jen job list --json` and `jen api` printed against the stub, with the
 *   answers the stub gave. The census stub `jen` is held to these.
 *
 * - `reads.json`: for each scenario in `SCENARIOS`, the answers the stub
 *   Jenkins gave, and every `jen` call the shell read made against it (argv,
 *   stdout, stderr, exit code), recorded through a shim on `PATH`.
 *   `jenkins-reads.corpus.test.ts` replays the calls to the shell side and
 *   serves the same answers to the in-process client.
 *
 * Usage: node packages/domain/corpus/record-jenkins-reads.mjs
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = join(ROOT, 'packages/domain/corpus/fixtures/jenkins-reads');
const JEN = execFileSync('bash', ['-c', 'command -v jen'], { encoding: 'utf8' }).trim();
const VERSION = '0.4.0';
const NOW = 1_000_000;

const version = execFileSync(JEN, ['--version'], { encoding: 'utf8' }).trim();
if (!version.endsWith(` ${VERSION}`)) throw new Error(`jen reports '${version}'; this recorder is for ${VERSION}`);

const FUNCTIONS = [
  'jen_instance_slug', 'jen_url_for', 'jen_url_host', 'jen_key_for', 'jen_instance_url', 'jen_instance_key',
  'jen_secret_backend', 'jen_secret_file', 'jen_secret_set', 'jen_save_token', 'jen_jenkins_user', 'jen_jenkins_token',
  'jen_instance_secret', 'jen_migrate_instance_keys', 'jen_secret_get', 'jen_secret_del', 'jen_check_http',
  'jen_urlencode', 'jen_job_path',
];

/** The text of the named functions, lifted from `jen` with awk. */
const lift = () =>
  FUNCTIONS.map((name) => {
    const run = spawnSync('awk', [`/^${name}\\(\\) *\\{/{on=1; one=($0 ~ /\\}$/)} on{print} on&&(one||/^\\}/){on=0; one=0}`, JEN], { encoding: 'utf8' });
    if (run.status !== 0 || run.stdout === '') throw new Error(`could not lift ${name}`);
    return run.stdout;
  }).join('\n');

const PRELUDE = `date() { echo ${NOW}; }\nJEN_KEYCHAIN_SERVICE=jen\n`;

/** Runs `body` in bash with the lifted functions and the given environment. */
const shell = (body, env) => {
  const run = spawnSync('bash', ['-c', `${PRELUDE}${lift()}\n${body}`], {
    env: { PATH: process.env.PATH, HOME: '/nonexistent', ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
  return { stdout: run.stdout, stderr: run.stderr, status: run.status };
};

const URL_CASES = [
  'https://jenkins.example.org',
  'https://jenkins.example.org/',
  'http://127.0.0.1:8080/jenkins',
  'http://127.0.0.1:8080/jenkins/',
  'HTTP://UPPER.example.org',
  'jenkins.example.org',
  'Jenkins.Example.ORG:8443',
  'jenkins.example.org/',
  'host.example.org/team/portal',
  'apps',
  '',
];

const HOST_CASES = [
  'https://Jenkins.Example.org/job/a',
  'http://127.0.0.1:8080/jenkins/x?y=1',
  'https://jenkins.example.org?x=1',
  'https://jenkins.example.org#frag',
  '/oauth2/start',
  '',
  'ftp://example.org/x',
  'https://id.example.org:8443/realms/r',
];

const PATH_CASES = [
  ['', ''],
  ['/', ''],
  ['team', ''],
  ['team/portal', ''],
  ['/team/portal/', ''],
  ['team//portal', ''],
  ['team/portal', 'main'],
  ['team/portal', 'docs/foo'],
  ['team/portal', 'feature/a b&c=d'],
  ['team/portal', 'bug/ümlaut~ok_-.'],
  ['', 'feature/x'],
  ['team', "it's (odd)*!"],
];

const TOKEN_CASES = [
  { access_token: 'a', refresh_token: 'r', expires_in: 300 },
  { access_token: 'a', refresh_token: 'r', expires_in: 60 },
  { access_token: 'a', refresh_token: 'r' },
  { access_token: 'a', expires_in: 1800, scope: 'openid profile', token_type: 'Bearer' },
  { expires_in: 90, expires_at: 5, access_token: 'a' },
];

const REALM = 'https://id.example.org/realms/r';
const INSTANCE = 'https://jenkins.example.org/jenkins';
const CHECK_CASES = [
  [302, 'https://jenkins.example.org/oauth2/start?rd=x'],
  [302, 'https://id.example.org/realms/r/protocol/openid-connect/auth'],
  [301, 'https://jenkins.example.org/jenkins/job/x/'],
  [302, 'https://jenkins.example.org/job/x/'],
  [303, 'https://elsewhere.example.net/landing'],
  [302, ''],
  [302, '/relative/path'],
  [307, 'https://JENKINS.example.org/x'],
  [401, ''],
  [403, ''],
  [404, ''],
  [500, ''],
  [200, ''],
  [201, ''],
  [399, 'https://elsewhere.example.net/'],
];

const recordUrlFunctions = () => {
  const store = mkdtempSync(join(tmpdir(), 'plot-record-jen-'));
  try {
    const urlEnv = { JEN_URL_PATTERN: 'https://{slug}.pattern.invalid', JEN_CONFIG_DIR: store };
    const out = {
      jen: version,
      urlFor: URL_CASES.map((input) => ({ input, output: shell(`jen_url_for ${JSON.stringify(input)}`, urlEnv).stdout.replace(/\n$/, '') })),
      keyFor: URL_CASES.map((input) => ({ input, output: shell(`jen_key_for ${JSON.stringify(input)}`, urlEnv).stdout.replace(/\n$/, '') })),
      instanceUrl: [
        { jenUrl: 'http://127.0.0.1:8080/jenkins/', slug: 'apps' },
        { jenUrl: 'http://127.0.0.1:8080/jenkins', slug: '' },
        { jenUrl: '', slug: 'jenkins.example.org' },
        { jenUrl: '', slug: 'https://jenkins.example.org/' },
        { jenUrl: '', slug: 'apps' },
      ].map((one) => ({
        ...one,
        output: shell('jen_instance_url', { ...urlEnv, JEN_URL: one.jenUrl, _JEN_INSTANCE: one.slug }).stdout.replace(/\n$/, ''),
      })),
      urlHost: HOST_CASES.map((input) => ({ input, output: shell(`jen_url_host ${JSON.stringify(input)}`, urlEnv).stdout })),
      secretFile: ['keycloak-token', 'jenkins-token:jenkins.example.org', 'jenkins-user:127.0.0.1:8080', 'a/b:c'].map((key) => ({
        key,
        dir: '/cfg/jen',
        output: shell(`jen_secret_file ${JSON.stringify(key)}`, { JEN_CONFIG_DIR: '/cfg/jen' }).stdout.replace(/\n$/, ''),
      })),
      saveToken: TOKEN_CASES.map((response) => {
        const dir = mkdtempSync(join(store, 'save-'));
        shell(`jen_save_token ${JSON.stringify(JSON.stringify(response))}`, { JEN_CONFIG_DIR: dir, JEN_SECRET_BACKEND: 'file' });
        const file = readdirSync(dir)[0];
        return { response, now: NOW, stored: file === 'keycloak-token.secret' ? readFileSync(join(dir, file), 'utf8') : null };
      }),
      jobPath: PATH_CASES.map(([input, branch]) => ({
        input,
        branch,
        output: shell(`jen_job_path ${JSON.stringify(input)} ${JSON.stringify(branch)}`, {}).stdout.replace(/\n$/, ''),
      })),
      urlencode: ['plain', 'a b', 'a/b', 'ümlaut', "it's", 'a~b_c-d.e', '%41'].map((input) => ({
        input,
        output: shell(`jen_urlencode ${JSON.stringify(input)}`, {}).stdout,
      })),
      checkHttp: CHECK_CASES.map(([status, location]) => {
        const run = shell(`jen_check_http ${status} '' ${JSON.stringify(location)}`, {
          JEN_URL: INSTANCE,
          JEN_REALM_URL: REALM,
          JENKINS_USER: 'u',
          JENKINS_API_TOKEN: 't',
          JEN_CONFIG_DIR: store,
        });
        const text = run.stderr;
        const klass = run.status === 0 ? 'ok' : /identity provider|rejected the request/.test(text) ? 'auth' : /unexpected redirect/.test(text) ? 'foreign' : 'failed';
        return { status, location, realm: REALM, instanceKey: 'jenkins.example.org', class: klass };
      }),
    };
    return out;
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
};

/** A stub Jenkins on 127.0.0.1 answering fixed bodies by path. */
const stubJenkins = async (answers) => {
  const server = http.createServer((req, res) => {
    req.resume();
    const body = answers[(req.url ?? '').split('?')[0]];
    if (body === undefined) {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
};

const MULTI = {
  _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject',
  name: 'portal',
  fullName: 'team/portal',
  url: 'http://stub/job/team/job/portal/',
  color: null,
  description: '',
};
const PLAIN = {
  _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob',
  name: 'deploy',
  fullName: 'team/deploy',
  url: 'http://stub/job/team/job/deploy/',
  color: 'blue',
  description: '',
  lastBuild: { number: 7, result: 'SUCCESS', timestamp: 1, duration: 2, displayName: '#7' },
};
const LIST = {
  _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject',
  jobs: [
    { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'main', color: 'blue' },
    { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'feature%2Fa', color: 'red_anime' },
    { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'old', color: 'disabled' },
  ],
};
const BUILDS = { _class: 'x', builds: [{ number: 2, result: 'SUCCESS', building: false, timestamp: 5, url: 'http://stub/b/2/', actions: [{}, { lastBuiltRevision: { SHA1: 'a'.repeat(40), branch: [{ name: 'origin/main' }] } }] }] };
const ANSWERS = {
  '/jenkins/me/api/json': { fullName: 'Fixture User', id: 'fixture' },
  '/jenkins/job/team/job/portal/api/json': MULTI,
  '/jenkins/job/team/job/deploy/api/json': PLAIN,
  '/jenkins/job/team/job/portal/job/main/api/json': BUILDS,
};
const LIST_ANSWERS = { ...ANSWERS, '/jenkins/job/team/job/portal/api/json': { ...LIST } };

const recordJenOutputs = async () => {
  const store = mkdtempSync(join(tmpdir(), 'plot-record-jen-out-'));
  const results = [];
  try {
    const run = async (name, answers, argv) => {
      const { server, port } = await stubJenkins(answers);
      try {
        const env = {
          PATH: process.env.PATH,
          HOME: store,
          JEN_URL: `http://127.0.0.1:${port}/jenkins`,
          JEN_CONFIG_DIR: store,
          JEN_TOKEN: 'fixture-bearer',
          JENKINS_USER: 'fixture',
          JENKINS_API_TOKEN: 'fixture-api-token',
        };
        const ran = await new Promise((resolve) => {
          const child = spawn(JEN, ['-I', 'jenkins.example.org', ...argv], { env, stdio: ['ignore', 'pipe', 'pipe'] });
          let stdout = '';
          child.stdout.on('data', (c) => (stdout += c));
          child.on('close', (status) => resolve({ status, stdout }));
        });
        results.push({
          name,
          argv,
          answers: JSON.parse(JSON.stringify(answers).replaceAll('http://stub', '')),
          status: ran.status,
          stdout: ran.stdout.replaceAll(`127.0.0.1:${port}`, '127.0.0.1:PORT'),
        });
      } finally {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
    };
    await run('auth-ok', ANSWERS, ['auth', 'status']);
    await run('auth-unreachable', {}, ['auth', 'status']);
    await run('view-multibranch', ANSWERS, ['job', 'view', 'team/portal', '--json']);
    await run('view-plain', ANSWERS, ['job', 'view', 'team/deploy', '--json']);
    await run('list-multibranch', LIST_ANSWERS, ['job', 'list', 'team/portal', '--json']);
    await run('list-plain', ANSWERS, ['job', 'list', 'team/deploy', '--json']);
    await run('api-builds', ANSWERS, ['api', '/job/team/job/portal/job/main/api/json?tree=builds[number]']);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
  return { jen: version, cases: results };
};

const MULTIBRANCH_CLASS = 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject';
const SHA = (n) => n.toString(16).padStart(40, '0');
const T0 = 1_700_000_000_000;

/** One Jenkins build with the revision records the reads look at. */
const build = (number, result, sha, branches = ['origin/main'], extra = {}) => ({
  _class: 'org.jenkinsci.plugins.workflow.job.WorkflowRun',
  number,
  result,
  building: false,
  timestamp: T0 + number * 60_000 + 999,
  url: `{{ORIGIN}}/jenkins/job/team/job/portal/job/main/${number}/`,
  actions: [{}, { _class: 'hudson.plugins.git.util.BuildData', lastBuiltRevision: { SHA1: sha, branch: branches.map((name) => ({ SHA1: sha, name })) } }],
  ...extra,
});

const ME = { '/me/api/json': { body: { fullName: 'Fixture User', id: 'fixture' } } };
const HTML = { status: 200, text: '<html><body>Sign in</body></html>' };
const OAUTH = { status: 302, headers: { Location: '{{ORIGIN}}/oauth2/start?rd=x' } };
const MAIN = '/job/team/job/portal/job/main';
const PORTAL = '/job/team/job/portal';
const DEAD = { destroy: true };

const LISTING = {
  _class: MULTIBRANCH_CLASS,
  jobs: [
    { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'main', color: 'blue' },
    { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'feature%2Fa', color: 'red_anime' },
    { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'bug%2Ffoo%20bar', color: 'yellow' },
    { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'x%C3%BC', color: 'blue' },
    { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'old', color: 'disabled' },
    { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'fresh', color: 'notbuilt' },
    { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'broken', color: 'red' },
  ],
};

const A = SHA(0xa);
const B = SHA(0xb);
const C = SHA(0xc);

const SCENARIOS = [
  { name: 'map-multibranch', kind: 'map', job: 'team/portal', routes: { ...ME, [PORTAL + '/api/json']: { body: LISTING } } },
  { name: 'map-multibranch-empty', kind: 'map', job: 'team/portal', routes: { ...ME, [PORTAL + '/api/json']: { body: { _class: MULTIBRANCH_CLASS, jobs: [] } } } },
  { name: 'map-root', kind: 'map', job: '', routes: { ...ME, '/api/json': { body: { jobs: LISTING.jobs } } } },
  {
    name: 'map-plain',
    kind: 'map',
    job: 'team/deploy',
    routes: { ...ME, '/job/team/job/deploy/api/json': { body: { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: 'deploy', color: 'blue_anime' } } },
  },
  {
    name: 'map-freestyle',
    kind: 'map',
    job: 'team/legacy',
    routes: { ...ME, '/job/team/job/legacy/api/json': { body: { _class: 'hudson.model.FreeStyleProject', name: 'legacy', color: 'blue' } } },
  },
  { name: 'map-unreachable', kind: 'map', job: 'team/portal', routes: {} },
  { name: 'map-transport-failure', kind: 'map', job: 'team/portal', routes: { '/me/api/json': DEAD, [PORTAL + '/api/json']: DEAD } },
  { name: 'map-html', kind: 'map', job: 'team/portal', routes: { ...ME, [PORTAL + '/api/json']: HTML } },
  { name: 'map-oauth-redirect', kind: 'map', job: 'team/portal', routes: { ...ME, [PORTAL + '/api/json']: OAUTH } },
  { name: 'map-third-host-redirect', kind: 'map', job: 'team/portal', routes: { ...ME, [PORTAL + '/api/json']: { status: 302, headers: { Location: '{{OTHER}}/landing' } } } },
  { name: 'map-forbidden', kind: 'map', job: 'team/portal', routes: { ...ME, [PORTAL + '/api/json']: { status: 403, text: '{}' } } },

  {
    name: 'runs-by-sha',
    kind: 'runs',
    ops: [{ op: 'runsForSha', branch: 'main', sha: A }, { op: 'runForSha', branch: 'main', sha: A }, { op: 'runs', branch: 'main' }],
    routes: { [MAIN + '/api/json']: { body: { _class: 'x', builds: [build(5, 'SUCCESS', A), build(4, 'FAILURE', B), build(3, 'ABORTED', C), build(2, 'NOT_BUILT', A)] } } },
  },
  {
    name: 'runs-sha-prefix',
    kind: 'runs',
    ops: [{ op: 'runsForSha', branch: 'main', sha: A.slice(0, 7) }, { op: 'runsForSha', branch: 'main', sha: A.slice(0, 6) }],
    routes: { [MAIN + '/api/json']: { body: { _class: 'x', builds: [build(2, 'SUCCESS', A)] } } },
  },
  {
    name: 'runs-running-build',
    kind: 'runs',
    ops: [{ op: 'runsForSha', branch: 'main', sha: A }, { op: 'runForSha', branch: 'main', sha: A }, { op: 'runs', branch: 'main' }],
    routes: { [MAIN + '/api/json']: { body: { _class: 'x', builds: [build(6, null, A, ['origin/main'], { building: true }), build(5, 'SUCCESS', A)] } } },
  },
  {
    name: 'runs-not-built',
    kind: 'runs',
    ops: [{ op: 'runsForSha', branch: 'main', sha: A }, { op: 'runs', branch: 'main' }],
    routes: { [MAIN + '/api/json']: { body: { _class: 'x', builds: [build(3, 'NOT_BUILT', A), build(2, 'NOT_BUILT', B)] } } },
  },
  {
    name: 'runs-rebuild-of-one-commit',
    kind: 'runs',
    ops: [{ op: 'runsForSha', branch: 'main', sha: A }, { op: 'runForSha', branch: 'main', sha: A }],
    routes: { [MAIN + '/api/json']: { body: { _class: 'x', builds: [build(43, 'SUCCESS', A), build(42, 'FAILURE', A)] } } },
  },
  {
    name: 'runs-record-names-the-commit',
    kind: 'runs',
    ops: [{ op: 'runsForSha', branch: 'main', sha: B }, { op: 'runsForSha', branch: 'main', sha: A }],
    routes: {
      [MAIN + '/api/json']: {
        body: {
          _class: 'x',
          builds: [
            { ...build(9, 'SUCCESS', A), actions: [{ lastBuiltRevision: { SHA1: B, branch: [{ name: 'refs/remotes/origin/other' }] } }, { lastBuiltRevision: { SHA1: A, branch: [{ name: 'refs/heads/main' }] } }] },
            { ...build(8, 'SUCCESS', B), actions: [{ lastBuiltRevision: { SHA1: B, branch: [] } }] },
            { ...build(7, 'SUCCESS', C), actions: [{}] },
          ],
        },
      },
    },
  },
  {
    name: 'runs-many-aborted',
    kind: 'runs',
    ops: [{ op: 'runs', branch: 'main', limit: 5 }, { op: 'runs', branch: 'main', limit: 2 }],
    routes: { [MAIN + '/api/json']: { body: { _class: 'x', builds: [...Array.from({ length: 13 }, (_, i) => build(40 - i, 'ABORTED', A)), ...Array.from({ length: 7 }, (_, i) => build(27 - i, 'SUCCESS', B))] } } },
  },
  {
    name: 'runs-abandoned-window',
    kind: 'runs',
    ops: [{ op: 'runs', branch: 'main', limit: 3 }],
    routes: { [MAIN + '/api/json']: { body: { _class: 'x', builds: [...Array.from({ length: 12 }, (_, i) => build(40 - i, 'ABORTED', A)), build(20, 'SUCCESS', B)] } } },
  },
  {
    name: 'runs-encoded-branch',
    kind: 'runs',
    ops: [{ op: 'runsForSha', branch: 'feature/a', sha: A }, { op: 'runs', branch: 'feature/a' }],
    routes: { [PORTAL + '/job/feature%2Fa/api/json']: { body: { _class: 'x', builds: [build(3, 'SUCCESS', A, ['origin/feature/a'])] } } },
  },
  {
    name: 'runs-plain-job',
    kind: 'runs',
    ops: [{ op: 'runs', branch: 'main' }, { op: 'runsForSha', branch: 'main', sha: A }, { op: 'runs', branch: 'nobody' }],
    routes: {
      [MAIN + '/api/json']: { status: 404, text: '<html>404</html>' },
      [PORTAL + '/api/json']: { body: { _class: 'x', builds: [build(5, 'SUCCESS', A, ['origin/main']), build(4, 'FAILURE', B, ['origin/other']), build(3, 'SUCCESS', C, ['origin/main'])] } },
    },
  },
  {
    name: 'runs-never-indexed-multibranch',
    kind: 'runs',
    ops: [{ op: 'runsForSha', branch: 'ghost', sha: A }, { op: 'runs', branch: 'ghost' }],
    routes: { [PORTAL + '/job/ghost/api/json']: { status: 404, text: '<html>404</html>' }, [PORTAL + '/api/json']: { body: { _class: MULTIBRANCH_CLASS } } },
  },
  {
    name: 'runs-branch-answered-no-builds',
    kind: 'runs',
    ops: [{ op: 'runsForSha', branch: 'main', sha: A }],
    routes: { [MAIN + '/api/json']: { body: { _class: 'x' } }, [PORTAL + '/api/json']: { body: { _class: 'y' } } },
  },
  { name: 'runs-transport-failure', kind: 'runs', ops: [{ op: 'runsForSha', branch: 'main', sha: A }, { op: 'runs', branch: 'main' }], routes: { [MAIN + '/api/json']: DEAD, [PORTAL + '/api/json']: DEAD } },
  { name: 'runs-html', kind: 'runs', ops: [{ op: 'runsForSha', branch: 'main', sha: A }], routes: { [MAIN + '/api/json']: HTML, [PORTAL + '/api/json']: HTML } },
  { name: 'runs-oauth-redirect', kind: 'runs', ops: [{ op: 'runsForSha', branch: 'main', sha: A }], routes: { [MAIN + '/api/json']: OAUTH, [PORTAL + '/api/json']: OAUTH } },
  {
    name: 'runs-third-host-redirect',
    kind: 'runs',
    ops: [{ op: 'runsForSha', branch: 'main', sha: A }],
    routes: { [MAIN + '/api/json']: { status: 302, headers: { Location: '{{OTHER}}/landing' } }, [PORTAL + '/api/json']: { status: 302, headers: { Location: '{{OTHER}}/landing' } } },
  },
  { name: 'runs-forbidden', kind: 'runs', ops: [{ op: 'runsForSha', branch: 'main', sha: A }], routes: { [MAIN + '/api/json']: { status: 403, text: '{}' }, [PORTAL + '/api/json']: { status: 403, text: '{}' } } },
];

/** Serves `routes` on 127.0.0.1 under `/jenkins`, logging each request and honouring the builds window. */
const serve = async (routes, origins) => {
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
    if (route.destroy) {
      req.socket.destroy();
      return;
    }
    const fill = (text) => text.replaceAll('{{ORIGIN}}', origins.origin()).replaceAll('{{OTHER}}', origins.other());
    const headers = Object.fromEntries(Object.entries(route.headers ?? {}).map(([k, v]) => [k, fill(v)]));
    let text = route.text ?? JSON.stringify(route.body ?? {});
    if (route.body !== undefined && Array.isArray(route.body.builds)) {
      const window = /%7B0,(\d+)%7D/.exec(url) ?? /\{0,(\d+)\}/.exec(url);
      if (window !== null) text = JSON.stringify({ ...route.body, builds: route.body.builds.slice(0, Number(window[1])) });
    }
    res.writeHead(route.status ?? 200, { 'Content-Type': route.text === undefined ? 'application/json' : 'text/html', ...headers });
    res.end(fill(text));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, seen };
};

/** A `jen` on PATH that runs the real one and keeps what it was asked and answered. */
const recordingShim = (dir) => {
  writeFileSync(
    join(dir, 'jen'),
    [
      '#!/usr/bin/env bash',
      `dir=${JSON.stringify(dir)}`,
      'n=$(ls "$dir" | grep -c "\\.argv$")',
      'printf \'%s\\n\' "$@" > "$dir/call-$n.argv"',
      `${JSON.stringify(JEN)} "$@" > "$dir/call-$n.out" 2> "$dir/call-$n.err"`,
      'code=$?',
      'echo "$code" > "$dir/call-$n.code"',
      'cat "$dir/call-$n.out"; cat "$dir/call-$n.err" >&2',
      'exit "$code"',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'jen'), 0o755);
};

const callsIn = (dir, port) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.argv'))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((f) => {
      const base = join(dir, f.replace(/\.argv$/, ''));
      const port_ = (text) => text.replaceAll(`127.0.0.1:${port}`, '127.0.0.1:{{PORT}}');
      return {
        argv: readFileSync(`${base}.argv`, 'utf8').split('\n').slice(0, -1),
        stdout: port_(readFileSync(`${base}.out`, 'utf8')),
        stderr: port_(readFileSync(`${base}.err`, 'utf8')),
        code: Number(readFileSync(`${base}.code`, 'utf8')),
      };
    });

/** Runs a command without blocking the event loop, so the stub server in this process can answer it. */
const runAsync = (cmd, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal });
    });
    child.stdout.resume();
    child.stderr.resume();
  });

const liftHost = (name) => {
  const run = spawnSync('awk', [`/^${name}\\(\\) *\\{/{on=1} on{print} on&&/^\\}/{on=0}`, join(ROOT, 'skills/plot/scripts/plot-host.sh')], { encoding: 'utf8' });
  if (run.status !== 0 || run.stdout === '') throw new Error(`could not lift ${name}`);
  return run.stdout;
};

const recordReads = async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'plot-record-reads-'));
  const out = [];
  try {
    for (const scenario of SCENARIOS) {
      const other = await serve({}, { origin: () => '', other: () => '' });
      let originPort = 0;
      const origins = { origin: () => `http://127.0.0.1:${originPort}/jenkins`.replace(/\/jenkins$/, ''), other: () => `http://127.0.0.1:${other.port}` };
      const main = await serve(scenario.routes, origins);
      originPort = main.port;
      try {
        const runs = scenario.kind === 'map' ? [{ op: 'map' }] : scenario.ops;
        const recorded = [];
        for (const one of runs) {
          const dir = mkdtempSync(join(scratch, 'shim-'));
          recordingShim(dir);
          const store = mkdtempSync(join(scratch, 'store-'));
          const env = {
            PATH: `${dir}:${process.env.PATH}`,
            HOME: store,
            JEN_URL: `http://127.0.0.1:${main.port}/jenkins`,
            JEN_CONFIG_DIR: store,
            JEN_TOKEN: 'fixture-bearer',
            JENKINS_USER: 'fixture',
            JENKINS_API_TOKEN: 'fixture-api-token',
            JEN_REALM_URL: 'https://id.example.org/realms/r',
            PLOT_BUDGET_OFF: '1',
            PLOT_JEN_BOUND_S: '10',
          };
          main.seen.length = 0;
          let result;
          if (scenario.kind === 'map') {
            result = await runAsync('bash', ['-c', `${liftHost('jenkins_build_map')}\njenkins_build_map ${JSON.stringify(scenario.job === '' ? 'jenkins.example.org' : `jenkins.example.org/${scenario.job}`)}`], { env });
          } else {
            const args = one.op === 'runs' ? ['runs', one.branch] : [one.op === 'runForSha' ? 'run-for-sha' : 'runs-for-sha', one.branch, one.sha];
            if (one.limit !== undefined) args.push('--limit', String(one.limit));
            result = await runAsync('bash', [join(ROOT, 'skills/plot/scripts/plot-host.sh'), ...args], {
              env: { ...env, PLOT_CI: 'jenkins', JENKINS_INSTANCE: 'jenkins.example.org/team/portal' },
              cwd: ROOT,
            });
          }
          if (result.error || result.status === null) console.error(scenario.name, one.op, result.error, result.signal);
          recorded.push({ ...one, shellCode: result.status, calls: callsIn(dir, main.port), requests: main.seen.map((u) => u.replace(/^\/jenkins/, '')), otherHits: other.seen.length });
        }
        out.push({ name: scenario.name, kind: scenario.kind, job: scenario.job, routes: scenario.routes, ops: recorded });
      } finally {
        for (const one of [main, other]) {
          one.server.closeAllConnections?.();
          await new Promise((resolve) => one.server.close(resolve));
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { jen: version, scenarios: out };
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'url-functions.json'), `${JSON.stringify(recordUrlFunctions(), null, 2)}\n`);
writeFileSync(join(OUT, 'jen-outputs.json'), `${JSON.stringify(await recordJenOutputs(), null, 2)}\n`);
writeFileSync(join(OUT, 'reads.json'), `${JSON.stringify(await recordReads(), null, 2)}\n`);
console.log(`recorded jen ${version} into ${OUT}`);
