#!/usr/bin/env node
/**
 * Records the fixtures `jira-issue-reads.corpus.test.ts` reads.
 *
 * For each case it runs `plot-host.sh issue-list` with a recording `curl` stub
 * on `PATH` (`fixtures/jira-issue-reads/curl-stub`). The stub answers the
 * case's scripted Jira pages in order and logs the argv of every call. The
 * recorder drives the page loop the way `walk` in `tracker-shell.ts` does:
 * each call asks `--limit` of the rows still wanted and passes the previous
 * page's token as `--page-token`. It writes, per case:
 *
 * - `read`: the state, `since` and `limit` the case asked.
 * - `gatedByTracker`: set where `trackerJira` refuses the read before the script runs (an unscoped inbox), so the script's own request is a fact about the script and not about the tracker.
 * - `env`: the Jira variables the shell ran under; credentials and base URL are
 *   stated by the test, never recorded.
 * - `exchanges`: each request the shell sent (path and query parameters as
 *   `--data-urlencode` named them) and the page it was answered with.
 * - `calls`: each `issue-list` call's argv, stdout, stderr and exit code.
 *
 * It makes no network call and reads no real credential. The changed-read
 * `-Nm` in a recorded JQL depends on the recording's clock; the corpus
 * compares it with the minutes replaced.
 *
 * Usage: node packages/domain/corpus/record-jira-issue-reads.mjs [case ...]
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const STUB = join(ROOT, 'packages/domain/corpus/fixtures/jira-issue-reads/curl-stub');
const OUT = join(ROOT, 'packages/domain/corpus/fixtures/jira-issue-reads');
const BASE = 'https://jira.fixture.example';

const stamp = (hours) => new Date(Date.UTC(2026, 9, 1) + hours * 3_600_000).toISOString().replace('Z', '+0000');

/** One Jira issue, every field the arm asks in any state; attributes derive from `n`. */
const issue = (n, over = {}) => ({
  key: `AB-${n}`,
  fields: {
    summary: n % 4 === 0 ? `Title with "quotes" and \\ backslash ${n}` : `Title ${n}`,
    created: stamp(n),
    updated: stamp(n + 100),
    status: n % 3 === 0 ? { name: 'Erledigt', statusCategory: { name: 'Done' } } : n % 3 === 1 ? { name: 'In Review', statusCategory: { name: 'In Progress' } } : { name: 'Open', statusCategory: { name: 'To Do' } },
    assignee: n % 3 === 0 ? { emailAddress: `p${n}@fixture.example`, accountId: `acct-${n}` } : n % 3 === 1 ? { accountId: `acct-${n}` } : null,
    issuetype: n % 2 === 0 ? { name: 'Bug' } : null,
    fixVersions: n % 3 === 0 ? [{ name: 'v1' }, { name: 'v2' }] : [],
    resolutiondate: n % 3 === 0 ? stamp(n + 50) : null,
    ...over,
  },
});
const issues = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => issue(from + i));
const page = (rows, nextPageToken) => ({ status: 200, body: { issues: rows, ...(nextPageToken === undefined ? {} : { nextPageToken }) } });
const refused = (status, message) => ({ status, body: { errorMessages: [message], errors: {} } });

const SCOPED = { PLOT_TICKET_PREFIXES: 'AB, CD' };
const UNSCOPED = { PLOT_TICKET_PREFIXES: '' };
const OPEN = { kind: 'open', limit: 30 };
const CLOSED = { kind: 'closed', since: '2026-10-01T08:30:45Z', limit: 30 };
const CHANGED = { kind: 'changed', since: '2026-10-01T08:30:00Z', limit: 30 };

const CASES = {
  'open-scoped-one-page': { env: SCOPED, read: OPEN, pages: [page(issues(1, 6))] },
  'open-unscoped-person-clause': { env: UNSCOPED, read: OPEN, pages: [page(issues(1, 3))] },
  'open-jql-override': { env: { ...SCOPED, PLOT_JIRA_JQL: 'project = ZZ AND labels = x ORDER BY rank' }, read: OPEN, pages: [page(issues(1, 2))] },
  'open-empty-answer': { env: SCOPED, read: OPEN, pages: [page([])] },
  'open-comma-only-prefixes': { env: { PLOT_TICKET_PREFIXES: ' , ,' }, read: OPEN, pages: [page(issues(1, 2))] },
  'open-two-pages-complete': { env: SCOPED, read: { kind: 'open', limit: 10 }, pages: [page(issues(1, 3), 'TOKEN-2'), page(issues(4, 5))] },
  'open-two-pages-at-limit': { env: SCOPED, read: { kind: 'open', limit: 5 }, pages: [page(issues(1, 3), 'TOKEN-2'), page(issues(4, 5))] },
  'open-token-repeats': { env: SCOPED, read: { kind: 'open', limit: 50 }, pages: [page(issues(1, 2), 'SAME'), page(issues(3, 4), 'SAME'), page(issues(5, 6), 'SAME')] },
  'open-empty-page-with-token': { env: SCOPED, read: { kind: 'open', limit: 50 }, pages: [page(issues(1, 2), 'T2'), page([], 'T3')] },
  'open-over-one-page': { env: SCOPED, read: { kind: 'open', limit: 150 }, pages: [page(issues(1, 100), 'BIG-2'), page(issues(101, 120))] },
  'open-first-page-refused': { env: SCOPED, read: OPEN, pages: [refused(400, 'The query is invalid')] },
  'open-second-page-refused': { env: SCOPED, read: { kind: 'open', limit: 10 }, pages: [page(issues(1, 3), 'TOKEN-2'), refused(500, 'Internal error')] },
  'open-unauthorised': { env: SCOPED, read: OPEN, pages: [refused(401, 'Unauthorized')] },
  'inbox-scoped': { env: SCOPED, read: { kind: 'inbox', limit: 30 }, pages: [page(issues(1, 4))] },
  'inbox-jql-override': { env: { ...SCOPED, PLOT_JIRA_JQL: 'assignee = currentUser() ORDER BY rank' }, read: { kind: 'inbox', limit: 30 }, pages: [page(issues(1, 2))] },
  'inbox-unscoped': { env: UNSCOPED, read: { kind: 'inbox', limit: 30 }, pages: [], gatedByTracker: true },
  'closed-scoped': { env: SCOPED, read: CLOSED, pages: [page([issue(3), issue(6, { resolutiondate: stamp(500) }), issue(9, { resolutiondate: null }), issue(12)])] },
  'closed-date-only-since': { env: SCOPED, read: { kind: 'closed', since: '2026-10-01', limit: 30 }, pages: [page(issues(3, 3))] },
  'closed-minutes-only-since': { env: SCOPED, read: { kind: 'closed', since: '2026-10-01T08:30Z', limit: 30 }, pages: [page(issues(3, 3))] },
  'closed-ignores-override': { env: { ...SCOPED, PLOT_JIRA_JQL: 'project = ZZ' }, read: CLOSED, pages: [page(issues(3, 3))] },
  'closed-unscoped': { env: UNSCOPED, read: CLOSED, pages: [] },
  'closed-bad-since': { env: SCOPED, read: { kind: 'closed', since: 'last week', limit: 30 }, pages: [] },
  'closed-two-pages': { env: SCOPED, read: { kind: 'closed', limit: 10, since: '2026-10-01' }, pages: [page([issue(3), issue(6)], 'C2'), page([issue(9, { resolutiondate: stamp(900) })])] },
  'changed-scoped': { env: SCOPED, read: CHANGED, pages: [page([issue(1), issue(3), issue(5)])] },
  'changed-date-only-since': { env: SCOPED, read: { kind: 'changed', since: '2026-10-01', limit: 30 }, pages: [page(issues(1, 2))] },
  'changed-ignores-override': { env: { ...SCOPED, PLOT_JIRA_JQL: 'project = ZZ' }, read: CHANGED, pages: [page(issues(1, 2))] },
  'changed-unscoped': { env: UNSCOPED, read: CHANGED, pages: [] },
  'changed-refused': { env: SCOPED, read: CHANGED, pages: [refused(503, 'Service Unavailable')] },
  'no-credentials': { env: { ...SCOPED, NO_CREDENTIALS: '1' }, read: OPEN, pages: [] },
  'no-base-url': { env: { ...SCOPED, NO_BASE_URL: '1' }, read: OPEN, pages: [] },
};

const HEAD = {
  open: ['issue-list', '--paged'],
  inbox: ['issue-list', '--state', 'inbox', '--paged'],
  closed: (since) => ['issue-list', '--state', 'closed', '--since', since],
  changed: (since) => ['issue-list', '--state', 'changed', '--since', since],
};

/** The request one curl argv describes: the path and the `--data-urlencode` pairs. */
const requestOf = (argv) => {
  const query = {};
  argv.forEach((word, i) => {
    if (word !== '--data-urlencode') return;
    const pair = argv[i + 1];
    query[pair.slice(0, pair.indexOf('='))] = pair.slice(pair.indexOf('=') + 1);
  });
  return { path: new URL(argv.find((word) => word.startsWith('http'))).pathname, query };
};

const run = (args, env, cwd) =>
  new Promise((resolve) => {
    const child = spawn('bash', [HOST, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

const record = async (name, one) => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-jira-record-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'curl'), readFileSync(STUB));
    execFileSync('chmod', ['+x', join(bin, 'curl')]);
    one.pages.forEach((p, i) => {
      writeFileSync(join(dir, `call-${i}.body`), JSON.stringify(p.body));
      writeFileSync(join(dir, `call-${i}.status`), String(p.status));
    });
    const { NO_CREDENTIALS, NO_BASE_URL, ...jiraEnv } = one.env;
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, JIRA_STUB_DIR: dir, PLOT_TRACKER: 'jira', PLOT_BUDGET_OFF: '1', ...jiraEnv };
    delete env.PLOT_REPO_ROOT;
    delete env.PLOT_UNATTENDED;
    if (NO_BASE_URL === undefined) env.PLOT_JIRA_BASE_URL = BASE;
    else delete env.PLOT_JIRA_BASE_URL;
    if (NO_CREDENTIALS === undefined) Object.assign(env, { JIRA_EMAIL: 'fixture@fixture.example', JIRA_API_TOKEN: 'fixture-token' });
    else delete env.JIRA_EMAIL, delete env.JIRA_API_TOKEN;
    const { kind, since, limit } = one.read;
    const head = typeof HEAD[kind] === 'function' ? HEAD[kind](since) : HEAD[kind];
    const calls = [];
    let rows = 0;
    let token = null;
    const seen = new Set();
    while (rows < limit) {
      const args = [...head, '--limit', String(limit - rows), ...(token === null ? [] : ['--page-token', token])];
      const said = await run(args, env, ROOT);
      calls.push({ argv: args, stdout: said.stdout, stderr: said.stderr, code: said.code });
      if (said.code !== 0) break;
      const lines = said.stdout.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
      const next = lines.find((l) => l.nextPageToken !== undefined)?.nextPageToken ?? null;
      const got = lines.filter((l) => l.nextPageToken === undefined).length;
      rows += got;
      token = next;
      if (token === null || got === 0 || seen.has(token)) break;
      seen.add(token);
    }
    const count = existsSync(join(dir, 'count')) ? Number(readFileSync(join(dir, 'count'), 'utf8')) : 0;
    const exchanges = Array.from({ length: count }, (_, i) => ({
      request: requestOf(readFileSync(join(dir, `sent-${i}.args`), 'utf8').replace(/\n$/, '').split('\n')),
      status: one.pages[i]?.status ?? 599,
      response: one.pages[i]?.body ?? null,
    }));
    const fixture = { name, read: one.read, env: one.env, ...(one.gatedByTracker ? { gatedByTracker: true } : {}), calls, exchanges };
    writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(fixture)}\n`);
    process.stdout.write(`${name}: ${calls.length} call(s), last exit ${calls.at(-1)?.code}, ${exchanges.length} request(s)\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const main = async () => {
  const names = process.argv.slice(2);
  for (const [name, one] of Object.entries(CASES)) if (names.length === 0 || names.includes(name)) await record(name, one);
};

await main();
