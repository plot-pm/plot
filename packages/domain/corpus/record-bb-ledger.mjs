#!/usr/bin/env node
/**
 * Records the fixtures `bb-ledger.corpus.test.ts` reads.
 *
 * A person runs it once per `bb` version. It refuses any `bb` that does not
 * report `1.15.0`. It makes no network call: the ledger functions run on fixed
 * inputs in bash, and the real `bb` runs against a stub Bitbucket on
 * 127.0.0.1 with fixture credentials and a scratch state directory.
 *
 * It writes `fixtures/bb-ledger/`:
 *
 * - `functions.json`: for each case, what the functions lifted from `bb` with
 *   `awk` answered (`bb_hour_stamps`, `bb_utc_hms`, `bb_shown_wait`,
 *   `bb_state_path`, `bb_account_key` under `LC_ALL=C` and under a UTF-8
 *   locale, `bb_hourly_limit`, `bb_budget_count`, `bb_budget_prune`,
 *   `bb_pause_read`, `bb_pause_is_stale`, `bb_pause_after_429`,
 *   `bb_pause_write`).
 * - `bb-outputs.json`: what `bb rate-limit --json` printed for a fixed state,
 *   and the exit-75 stderr line of `bb api` and `bb pr list` at the ceiling,
 *   during a pause, after a 429 and after a 429 on a later page.
 * - `interop.json`: the files the TS adapter wrote, and what the lifted
 *   `bb_budget_count` and `bb_pause_read` read from them.
 *
 * Usage: BB=<path to bb 1.15.0> node packages/domain/corpus/record-bb-ledger.mjs
 * (`BB` defaults to the `bb` on `PATH`; the file is run with bash, so it need
 * not be executable).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = join(ROOT, 'packages/domain/corpus/fixtures/bb-ledger');
const BB = process.env.BB || execFileSync('bash', ['-c', 'command -v bb'], { encoding: 'utf8' }).trim();
const VERSION = '1.15.0';
const LOOPBACK = 'http://127.0.0.1:9';
// 2026-08-29T10:42:03Z.
const NOW = 1_788_000_123;
const LOCALES = { c: 'C', utf8: 'en_US.UTF-8' };

const version = execFileSync('bash', [BB, '--version'], { encoding: 'utf8' }).trim();
if (!version.startsWith(`bb ${VERSION} `)) throw new Error(`bb reports '${version}'; this recorder is for ${VERSION}`);

const FUNCTIONS = [
  'bb_now', 'bb_date_utc', 'bb_hour_stamps', 'bb_utc_hms', 'bb_shown_wait', 'bb_state_path', 'bb_state_dir',
  'bb_state_warn', 'bb_account_key', 'bb_hourly_limit', 'bb_budget_count', 'bb_budget_prune', 'bb_pause_read',
  'bb_pause_is_stale', 'bb_pause_left', 'bb_pause_write', 'bb_pause_after_429',
];

/** The text of the named functions, lifted from `bb` with awk. */
const lift = () =>
  FUNCTIONS.map((name) => {
    const run = spawnSync('awk', [`/^${name}\\(\\) *\\{/{on=1; one=($0 ~ /\\}$/)} on{print} on&&(one||/^\\}/){on=0; one=0}`, BB], { encoding: 'utf8' });
    if (run.status !== 0 || run.stdout === '') throw new Error(`could not lift ${name}`);
    return run.stdout;
  }).join('\n');

/** The constants the lifted functions read, lifted with grep. */
const constants = () => {
  const text = readFileSync(BB, 'utf8');
  const lines = ['BB_BUDGET_DEFAULT', 'BB_BUDGET_WINDOW', 'BB_PAUSE_SKEW'].map((name) => {
    const line = text.split('\n').find((one) => one.startsWith(`${name}=`));
    if (line === undefined) throw new Error(`could not lift ${name}`);
    return line;
  });
  const flavour = /case "\$\{OSTYPE:-\}" in\n[\s\S]*?\nesac\n/.exec(text);
  if (flavour === null) throw new Error('could not lift BB_DATE_FLAVOUR');
  return `${lines.join('\n')}\n${flavour[0]}`;
};

const PRELUDE = `${constants()}\n${lift()}\n`;

/** Runs `body` in bash with the lifted functions, the given environment and `BB_NOW`. */
const shell = (body, env = {}, now = NOW) => {
  const run = spawnSync('bash', ['-c', `${PRELUDE}\n${body}`], {
    env: { PATH: process.env.PATH, LC_ALL: 'C', BB_API_URL: LOOPBACK, BB_NOW: String(now), ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
  return { stdout: run.stdout, stderr: run.stderr, status: run.status };
};

const q = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

const SECONDS = [NOW, 1_787_961_600, 1_787_961_599, 1_788_047_999, 0, 1_735_689_600];
const WAITS = [0, 1, 428, 429, 430, 3600];
const STATE_ENVS = [
  { BB_STATE_DIR: '/s/bb', XDG_STATE_HOME: '/x', HOME: '/h' },
  { BB_STATE_DIR: '', XDG_STATE_HOME: '/x', HOME: '/h' },
  { BB_STATE_DIR: '', XDG_STATE_HOME: '', HOME: '/h' },
  { XDG_STATE_HOME: '/x' },
  { BB_STATE_DIR: '', XDG_STATE_HOME: '', HOME: '' },
  {},
];
const EMAILS = ['me.name@example.com', 'Me.Name@Example.COM', 'ÜMLAUT@example.com', 'Ärger.Öl@Straße.de', ''];
const LIMITS = [null, '', '0', '00', '010', '800', '999999999', '1234567890', '0001234567890', 'abc', '-1', '8 0', '1e3'];

const line = (second) => `${second}\n`;
const lines = (...seconds) => seconds.map(line).join('');
const COUNTS = [
  { limit: 800, prev: '', cur: '' },
  { limit: 800, prev: lines(NOW - 3600, NOW - 3599), cur: lines(NOW - 10, NOW) },
  { limit: 3, prev: lines(NOW - 3000), cur: lines(NOW - 20, NOW - 10) },
  { limit: 2, prev: lines(NOW - 3000), cur: lines(NOW - 20, NOW - 10) },
  { limit: 1, prev: '', cur: lines(NOW - 10, NOW - 3000, NOW - 20) },
  { limit: 2, prev: '', cur: `garbage\n${NOW - 5} \n0${NOW - 5}\n${'1'.repeat(13)}\n${NOW + 1}\n\n${NOW - 7}\n` },
  { limit: 1, prev: '', cur: `${NOW - 5}` },
  { limit: 999999999, prev: '', cur: lines(NOW) },
];
const PRUNES = {
  prev: '2026082909',
  names: [
    'requests-aaaaaaaaaaaa-2026082908.log',
    'requests-aaaaaaaaaaaa-2026082909.log',
    'requests-aaaaaaaaaaaa-2026082910.log',
    'requests-bbbbbbbbbbbb-2025123123.log',
    'requests-x-y-2026082908.log',
    'requests-aaaaaaaaaaaa-202608290.log',
    'requests-aaaaaaaaaaaa-2026082908.txt',
    'pause-aaaaaaaaaaaa',
    'other-2026082908.log',
  ],
};
const PAUSE_TEXTS = [
  null, '', `${NOW + 300} 300\n`, `${NOW + 300} 300`, `${NOW + 300}  300\n`, `${NOW + 300}\t300\n`, `${NOW + 300} 0\n`,
  `0000${NOW + 300} 00300\n`, `${NOW + 300} 300 9\n`, `${NOW + 300}\n`, `-1 300\n`, `${'1'.repeat(13)} 300\n`,
  `${NOW + 300} 300\nsecond line\n`, ' 5 5\n', 'x y\n', `${NOW + 300} 3a\n`,
];
const STALE = [
  [NOW + 300, 300], [NOW + 305, 300], [NOW + 306, 300], [NOW - 1, 300], [NOW, 1], [NOW + 3700, 3600],
];
const AFTER_429 = [
  { stored: null, retryAfter: null },
  { stored: null, retryAfter: '30' },
  { stored: null, retryAfter: '900' },
  { stored: null, retryAfter: '00429' },
  { stored: null, retryAfter: 'soon' },
  { stored: null, retryAfter: '1234567890' },
  { stored: `${NOW - 100} 300\n`, retryAfter: null },
  { stored: `${NOW - 100} 2400\n`, retryAfter: null },
  { stored: `${NOW - 3600} 300\n`, retryAfter: null },
  { stored: `${NOW - 3599} 300\n`, retryAfter: '700' },
  { stored: `${NOW + 100} 300\n`, retryAfter: null },
  { stored: `${NOW + 100} 300\n`, retryAfter: '500' },
  { stored: `${NOW + 100} 300\n`, retryAfter: '10' },
  { stored: `${NOW + 9000} 300\n`, retryAfter: null },
  { stored: 'junk\n', retryAfter: null },
];
const WRITES = [
  { stored: `${NOW + 2000} 2400\n`, end: NOW + 300, length: 300 },
  { stored: `${NOW + 200} 300\n`, end: NOW + 600, length: 600 },
  { stored: `${NOW + 9000} 300\n`, end: NOW + 300, length: 300 },
  { stored: `${NOW + 400} 100\n`, end: NOW + 300, length: 300 },
  { stored: null, end: NOW + 300, length: 300 },
];

const KEY = 'aaaaaaaaaaaa';

/** Runs `body` with a scratch state directory that holds `files`, and answers the run plus the directory's files after it. */
const inState = (files, body, env = {}, now = NOW) => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-record-bb-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const run = shell(body, { BB_STATE_DIR: dir, ...env }, now);
    const after = Object.fromEntries(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name), 'utf8')]));
    return { ...run, stdout: run.stdout.replaceAll(dir, '<dir>'), stderr: run.stderr.replaceAll(dir, '<dir>'), after };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const recordFunctions = () => ({
  bb: version,
  now: NOW,
  hourStamps: SECONDS.map((second) => ({ second, output: shell(`bb_hour_stamps ${second}`).stdout.replace(/\n$/, '') })),
  utcHms: SECONDS.map((second) => ({ second, output: shell(`bb_utc_hms ${second}`).stdout.replace(/\n$/, '') })),
  shownWait: WAITS.map((seconds) => ({ seconds, output: Number(shell(`bb_shown_wait ${seconds}`).stdout) })),
  statePath: STATE_ENVS.map((env) => {
    const run = shell('bb_state_path', env);
    return { env, output: run.status === 0 ? run.stdout.replace(/\n$/, '') : null };
  }),
  accountKey: EMAILS.map((email) => ({
    email,
    ...Object.fromEntries(
      Object.entries(LOCALES).map(([name, locale]) => [name, shell(`bb_account_key ${q(email)}`, { LC_ALL: locale }).stdout.replace(/\n$/, '')]),
    ),
  })),
  hourlyLimit: LIMITS.map((value) => {
    const run = shell('bb_hourly_limit', value === null ? {} : { BB_HOURLY_LIMIT: value });
    return { value, status: run.status, stdout: run.stdout.replace(/\n$/, ''), stderr: run.stderr.replace(/\n$/, '') };
  }),
  budgetCount: COUNTS.map((one) => {
    const run = inState(
      { [`requests-${KEY}-2026082909.log`]: one.prev, [`requests-${KEY}-2026082910.log`]: one.cur },
      `bb_budget_count ${NOW} ${one.limit} "$BB_STATE_DIR/requests-${KEY}-2026082909.log" "$BB_STATE_DIR/requests-${KEY}-2026082910.log"`,
    );
    return { ...one, now: NOW, output: run.stdout.replace(/\n$/, '') };
  }),
  budgetCountMissing: inState({}, `bb_budget_count ${NOW} 800 "$BB_STATE_DIR/a.log" "$BB_STATE_DIR/b.log"`).stdout.replace(/\n$/, ''),
  prune: {
    ...PRUNES,
    kept: Object.keys(inState(Object.fromEntries(PRUNES.names.map((name) => [name, '1\n'])), `bb_budget_prune "$BB_STATE_DIR" ${PRUNES.prev}`).after),
  },
  pauseRead: PAUSE_TEXTS.map((text) => ({
    text,
    output: inState(text === null ? {} : { [`pause-${KEY}`]: text }, `bb_pause_read ${KEY}`).stdout.replace(/\n$/, ''),
  })),
  pauseIsStale: STALE.map(([end, length]) => ({ end, length, now: NOW, stale: shell(`bb_pause_is_stale ${end} ${length} ${NOW}`).status === 0 })),
  pauseAfter429: AFTER_429.map((one) => {
    const run = inState(
      one.stored === null ? {} : { [`pause-${KEY}`]: one.stored },
      `bb_pause_after_429 ${KEY} ${one.retryAfter === null ? "''" : q(one.retryAfter)}`,
    );
    return { ...one, now: NOW, tail: run.stdout.replace(/\n$/, ''), file: run.after[`pause-${KEY}`] ?? null };
  }),
  pauseWrite: WRITES.map((one) => {
    const run = inState(one.stored === null ? {} : { [`pause-${KEY}`]: one.stored }, `bb_pause_write ${KEY} ${one.end} ${one.length} ${NOW}`);
    return { ...one, now: NOW, output: run.stdout.replace(/\n$/, ''), file: run.after[`pause-${KEY}`] ?? null, files: Object.keys(run.after) };
  }),
});

/** A stub Bitbucket on 127.0.0.1 answering by path. */
const stubBitbucket = async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    const path = (req.url ?? '').split('?')[0];
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (path === '/user') {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '30' });
      res.end('{"type":"error","error":{"message":"Rate limit for this resource has been exceeded"}}');
      return;
    }
    if (path === '/repositories/ws/repo/pullrequests') {
      const values = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, title: `pr ${index + 1}`, state: 'OPEN' }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ values, next: `${origin}/page2` }));
      return;
    }
    if (path === '/page2') {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end('{"type":"error","error":{"message":"Rate limit for this resource has been exceeded"}}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"username":"fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

const EMAIL = 'me.name@example.com';

const recordOutputs = async () => {
  const server = await stubBitbucket();
  const port = server.address().port;
  const key = shell(`bb_account_key ${q(EMAIL)}`).stdout.replace(/\n$/, '');
  const run = async (name, files, argv, env = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-record-bb-out-'));
    try {
      for (const [file, text] of Object.entries(files)) {
        if (text === null) mkdirSync(join(dir, file));
        else writeFileSync(join(dir, file), text);
      }
      const ran = await new Promise((resolve) => {
        const child = spawn('bash', [BB, ...argv], {
          env: {
            PATH: process.env.PATH,
            HOME: dir,
            LC_ALL: 'C',
            BB_API_URL: `http://127.0.0.1:${port}`,
            BB_NOW: String(NOW),
            BB_STATE_DIR: dir,
            BB_EMAIL: EMAIL,
            BB_TOKEN: 'fixture-token',
            ...env,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      });
      const named = (text) => text.replaceAll(dir, '<dir>').replaceAll(`127.0.0.1:${port}`, '127.0.0.1:PORT');
      return { name, argv, env, files, status: ran.status, stdout: named(ran.stdout), stderr: named(ran.stderr) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const cur = `requests-${key}-2026082910.log`;
  const prev = `requests-${key}-2026082909.log`;
  const pause = `pause-${key}`;
  const cases = [];
  try {
    cases.push(await run('rate-limit-idle', { [prev]: lines(NOW - 3000), [cur]: lines(NOW - 10) }, ['rate-limit', '--json']));
    cases.push(await run('rate-limit-ceiling', { [prev]: lines(NOW - 3000), [cur]: lines(NOW - 20, NOW - 10) }, ['rate-limit', '--json'], { BB_HOURLY_LIMIT: '3' }));
    cases.push(await run('rate-limit-paused', { [cur]: lines(NOW - 10), [pause]: `${NOW + 200} 300\n` }, ['rate-limit', '--json']));
    cases.push(await run('rate-limit-paused-429', { [pause]: `${NOW + 429} 600\n` }, ['rate-limit', '--json']));
    cases.push(await run('rate-limit-unknown', { [cur]: null }, ['rate-limit', '--json']));
    cases.push(await run('rate-limit-off', { [cur]: lines(NOW - 20, NOW - 10) }, ['rate-limit', '--json'], { BB_HOURLY_LIMIT: '0' }));
    cases.push(await run('refused-ceiling', { [prev]: lines(NOW - 3000), [cur]: lines(NOW - 20, NOW - 10) }, ['api', '/user'], { BB_HOURLY_LIMIT: '3' }));
    cases.push(await run('refused-paused', { [pause]: `${NOW + 200} 300\n` }, ['api', '/user']));
    cases.push(await run('refused-429', {}, ['api', '/user']));
    cases.push(await run('refused-429-later-page', {}, ['-R', 'ws/repo', 'pr', 'list', '--all', '--json']));
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  return { bb: version, now: NOW, email: EMAIL, key, cases };
};

/** Lets the TS adapter's `.js` imports resolve to their `.ts` sources. */
registerHooks({
  resolve: (specifier, context, next) => {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.endsWith('.js')) return next(`${specifier.slice(0, -3)}.ts`, context);
      throw error;
    }
  },
});

const recordInterop = async () => {
  const { bbAccountKey, bbLedgerFile } = await import(join(ROOT, 'packages/domain/src/adapters/host/bb-ledger-file.ts'));
  const dir = mkdtempSync(join(tmpdir(), 'plot-record-bb-interop-'));
  try {
    const key = bbAccountKey(EMAIL);
    const at = (second) => bbLedgerFile({ env: { BB_STATE_DIR: dir }, now: () => second * 1000, log: () => undefined });
    for (const second of [NOW - 3000, NOW - 20, NOW - 10]) await at(second).guard(EMAIL, 800);
    await at(NOW - 5).pauseAfter429(EMAIL, '30');
    const written = Object.fromEntries(readdirSync(dir).sort().map((name) => [name.replace(key, '<key>'), readFileSync(join(dir, name), 'utf8')]));
    const count = shell(
      `bb_budget_count ${NOW} 3 "$BB_STATE_DIR/requests-${key}-2026082909.log" "$BB_STATE_DIR/requests-${key}-2026082910.log"`,
      { BB_STATE_DIR: dir },
    ).stdout.replace(/\n$/, '');
    const pause = shell(`bb_pause_read ${key}`, { BB_STATE_DIR: dir }).stdout.replace(/\n$/, '');
    return { bb: version, now: NOW, key, shellKey: shell(`bb_account_key ${q(EMAIL)}`).stdout.replace(/\n$/, ''), written, count, pause };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'functions.json'), `${JSON.stringify(recordFunctions(), null, 2)}\n`);
writeFileSync(join(OUT, 'bb-outputs.json'), `${JSON.stringify(await recordOutputs(), null, 2)}\n`);
writeFileSync(join(OUT, 'interop.json'), `${JSON.stringify(await recordInterop(), null, 2)}\n`);
console.log(`recorded ${version} into ${OUT}`);
