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
 * Usage: node packages/domain/corpus/record-jenkins-reads.mjs
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'url-functions.json'), `${JSON.stringify(recordUrlFunctions(), null, 2)}\n`);
writeFileSync(join(OUT, 'jen-outputs.json'), `${JSON.stringify(await recordJenOutputs(), null, 2)}\n`);
console.log(`recorded jen ${version} into ${OUT}`);
