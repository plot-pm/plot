import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { shellContext } from '../src/adapters/scripts.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';
import { jiraApi } from '../src/adapters/tracker/jira-api.js';
import { trackerJira } from '../src/adapters/tracker/tracker-jira.js';
import type { PortResult } from '../src/port-result.js';
import type { IssueRead, Tracker } from '../src/ports/tracker.js';
import { jiraRelativeMinutes } from '../src/rules/jira-jql.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Do the in-process Jira issue reads and `plot-host.sh issue-list` answer the
 * same JQL, the same issues, the same completeness and the same outcome from
 * one recorded Jira answer?
 *
 * `corpus/record-jira-issue-reads.mjs` ran `plot-host.sh issue-list` with a
 * recording `curl` stub on `PATH` and wrote, per case, each request the script
 * sent and the page it was answered with. This test serves those pages to
 * `trackerJira(context, base, { api })` over a stub HTTP server on 127.0.0.1,
 * and to `trackerJira(context, base)` through the same `curl` stub, and
 * compares what each side sent and what each answered. `rules/jira-jql.ts`
 * and `rules/jira-issue-row.ts` are declared duplicates of the script's query
 * and jq program, and `tracker-jira-reads.ts` repeats the page loop of
 * `walk` in `tracker-shell.ts`. Neither side is authoritative: a disagreement
 * stops the branch.
 *
 * One request difference is declared, not hidden: after a 401 the shared client
 * re-reads its credentials and sends the request once more, and curl does not.
 * Three things are compared less than exactly, each because the transports
 * differ and not the rule. The text of a refused request differs (curl's
 * `jira HTTP <n>` against the client's own wording), so a failed request
 * compares its outcome only. The text of a `--since` usage error differs for
 * the same reason, and compares its outcome only. A changed read's `-<N>m`
 * depends on the clock of each run, so `N` is replaced in the compared JQL and
 * checked on its own: the shell's `N` lies between the values the rule gives
 * for the clock before and after the run, and the in-process `N` is within one
 * minute of the shell's.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures/jira-issue-reads');
const BASE = 'https://jira.fixture.example';
const report = describingAs({ left: 'in-process', right: 'shell' });

interface Ask {
  readonly kind: 'open' | 'closed' | 'changed' | 'inbox';
  readonly since?: string;
  readonly limit: number;
}

interface Sent {
  readonly path: string;
  readonly query: Record<string, string>;
}

interface Fixture {
  readonly name: string;
  readonly read: Ask;
  readonly env: Record<string, string>;
  readonly gatedByTracker?: boolean;
  readonly exchanges: readonly { readonly request: Sent; readonly status: number; readonly response: unknown }[];
}

interface Side {
  readonly result: PortResult<IssueRead>;
  readonly refusal: string | null;
  readonly sent: Sent[];
  readonly bracket: readonly [number, number];
}

interface Read {
  readonly fixture: Fixture;
  readonly inProcess: Side;
  readonly shell: Side;
}

let sandbox = '';
let reads: Read[] = [];

const readFixtures = (): Fixture[] =>
  readdirSync(FIXTURES)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as Fixture);

const ask = (tracker: Tracker, read: Ask): Promise<PortResult<IssueRead>> =>
  read.kind === 'open'
    ? tracker.issueListOpen(read.limit)
    : read.kind === 'inbox'
      ? tracker.issueListInbox(read.limit)
      : read.kind === 'closed'
        ? tracker.issueListClosed(read.since ?? '', read.limit)
        : tracker.issueListChanged(read.since ?? '', read.limit);

const outcomeOf = (result: PortResult<IssueRead>): string => (result.ok ? 'answered' : result.why);

/** The environment one fixture ran under; credentials and base URL are the test's, absent where the fixture says so. */
const environmentOf = (fixture: Fixture, base: string): Record<string, string | undefined> => {
  const { NO_CREDENTIALS, NO_BASE_URL, ...jira } = fixture.env;
  return {
    ...jira,
    PLOT_JIRA_BASE_URL: NO_BASE_URL === undefined ? base : undefined,
    JIRA_EMAIL: NO_CREDENTIALS === undefined ? 'fixture@fixture.example' : undefined,
    JIRA_API_TOKEN: NO_CREDENTIALS === undefined ? 'fixture-token' : undefined,
    PLOT_JIRA_JQL: jira.PLOT_JIRA_JQL,
  };
};

const withEnv = async <T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> => {
  const names = [...Object.keys(env), 'PATH', 'PLOT_TRACKER', 'PLOT_BUDGET_OFF', 'PLOT_REPO_ROOT', 'PLOT_UNATTENDED'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

/** What one curl argv asked, in the recorder's shape. */
const sentOf = (argv: readonly string[]): Sent => {
  const query: Record<string, string> = {};
  argv.forEach((word, i) => {
    if (word !== '--data-urlencode') return;
    const pair = argv[i + 1] ?? '';
    query[pair.slice(0, pair.indexOf('='))] = pair.slice(pair.indexOf('=') + 1);
  });
  return { path: new URL(argv.find((word) => word.startsWith('http')) ?? BASE).pathname, query };
};

const shellRead = async (fixture: Fixture, dir: string): Promise<Side> => {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  copyFileSync(join(FIXTURES, 'curl-stub'), join(bin, 'curl'));
  chmodSync(join(bin, 'curl'), 0o755);
  fixture.exchanges.forEach((one, i) => {
    writeFileSync(join(dir, `call-${i}.body`), JSON.stringify(one.response));
    writeFileSync(join(dir, `call-${i}.status`), String(one.status));
  });
  const env = { ...environmentOf(fixture, BASE), PATH: `${bin}:${process.env.PATH}`, JIRA_STUB_DIR: dir, PLOT_TRACKER: 'jira', PLOT_BUDGET_OFF: '1', PLOT_REPO_ROOT: undefined, PLOT_UNATTENDED: undefined };
  const before = Date.now();
  const { result, refusal } = await withEnv(env, async () => {
    const tracker = trackerJira(shellContext(ROOT), env.PLOT_JIRA_BASE_URL ?? '');
    return { result: await ask(tracker, fixture.read), refusal: tracker.lastRefusal() };
  });
  const after = Date.now();
  const count = readdirSync(dir).filter((file) => file.startsWith('sent-')).length;
  const sent = Array.from({ length: count }, (_, i) => sentOf(readFileSync(join(dir, `sent-${i}.args`), 'utf8').replace(/\n$/, '').split('\n')));
  const since = fixture.read.since ?? '';
  return { result, refusal, sent, bracket: since === '' ? [0, 0] : [jiraRelativeMinutes(since, before), jiraRelativeMinutes(since, after)] };
};

const inProcessRead = async (fixture: Fixture, dir: string): Promise<Side> => {
  const sent: Sent[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://stub');
      sent.push({ path: url.pathname, query: Object.fromEntries(url.searchParams.entries()) });
      const one = fixture.exchanges[sent.length - 1];
      res.writeHead(one?.status ?? 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(one?.response ?? { errorMessages: ['unrecorded request'] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const env = Object.fromEntries(Object.entries(environmentOf(fixture, url)).filter(([, value]) => value !== undefined)) as Record<string, string>;
    const home = join(dir, 'budget');
    const api = jiraApi({
      repoRoot: join(dir, 'nowhere'),
      baseUrl: env.PLOT_JIRA_BASE_URL === undefined ? '' : url,
      env,
      budget: budgetFile({ home }),
      slots: slotsFile({ home, isAlive: () => true }),
    });
    const before = Date.now();
    const tracker = trackerJira(shellContext(join(dir, 'nowhere')), '', { api, ticketPrefixes: '', env });
    const result = await ask(tracker, fixture.read);
    const after = Date.now();
    const since = fixture.read.since ?? '';
    return {
      result: result.ok ? { ...result, value: { ...result.value, issues: result.value.issues.map((issue) => JSON.parse(JSON.stringify(issue).split(url).join(BASE)) as typeof issue) } } : result,
      refusal: tracker.lastRefusal(),
      sent,
      bracket: since === '' ? [0, 0] : [jiraRelativeMinutes(since, before), jiraRelativeMinutes(since, after)],
    };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-jira-issues-corpus-'));
  reads = [];
  for (const fixture of readFixtures()) {
    const dir = join(sandbox, fixture.name);
    mkdirSync(join(dir, 'shell'), { recursive: true });
    mkdirSync(join(dir, 'in'), { recursive: true });
    const shell = await shellRead(fixture, join(dir, 'shell'));
    const inProcess = await inProcessRead(fixture, join(dir, 'in'));
    reads.push({ fixture, inProcess, shell });
  }
}, 300_000);

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

/** A request with the changed read's relative minutes replaced. */
const normalised = (one: Sent): Sent => ({ ...one, query: { ...one.query, jql: (one.query.jql ?? '').replace(/"-[0-9]+m"/, '"-Nm"') } });
const minutesIn = (one: Sent | undefined): number | null => {
  const hit = /"-([0-9]+)m"/.exec(one?.query.jql ?? '');
  return hit === null ? null : Number(hit[1]);
};
const refusedByHost = (fixture: Fixture): boolean => fixture.exchanges.some((one) => one.status >= 300);

describe('the in-process Jira issue reads agree with plot-host.sh issue-list', () => {
  it('sends the requests the script sent, in order: path, JQL, fields, page size and page token', () => {
    const found: Disagreement[] = [];
    for (const { fixture, inProcess, shell } of reads) {
      // A 401 is the one place the two transports send different requests: the
      // shared client re-reads its credentials once and sends the request again
      // (`jira-api.ts`, held by `test/jira-api.test.ts`), and curl sends it once.
      const retried = fixture.exchanges[0]?.status === 401;
      const expected = retried ? [...shell.sent, ...shell.sent.slice(0, 1)] : shell.sent;
      compareField(found, fixture.name, 'requests', inProcess.sent.map(normalised), expected.map(normalised));
      // A read the tracker refuses never reaches the script; the recording shows what the script alone would send.
      if (fixture.gatedByTracker === true) compareField(found, `${fixture.name} (gated)`, 'requests', shell.sent, []);
      else compareField(found, `${fixture.name} (recording)`, 'requests', shell.sent.map(normalised), fixture.exchanges.map((one) => normalised(one.request)));
    }
    expect(found.map(report)).toEqual([]);
  });

  it('sends a changed read’s relative minutes within the bracket the clock gives', () => {
    const changed = reads.filter((r) => r.fixture.read.kind === 'changed' && r.shell.sent.length > 0);
    expect(changed.length).toBeGreaterThanOrEqual(2);
    for (const { fixture, inProcess, shell } of changed) {
      const theirs = minutesIn(shell.sent[0]) ?? NaN;
      const mine = minutesIn(inProcess.sent[0]) ?? NaN;
      expect(theirs, fixture.name).toBeGreaterThanOrEqual(shell.bracket[0]);
      expect(theirs, fixture.name).toBeLessThanOrEqual(shell.bracket[1]);
      expect(Math.abs(mine - theirs), fixture.name).toBeLessThanOrEqual(1);
    }
  });

  it('answers the same outcome, and the same refusal text without the script prefix where the text is the rule’s', () => {
    const found: Disagreement[] = [];
    for (const { fixture, inProcess, shell } of reads) {
      compareField(found, fixture.name, 'outcome', outcomeOf(inProcess.result), outcomeOf(shell.result));
      if (refusedByHost(fixture) || fixture.name.endsWith('bad-since')) continue;
      compareField(found, fixture.name, 'refusal', inProcess.refusal, shell.refusal?.replace(/^plot-host: /, '') ?? null);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('returns the same issues, in the same order, field by field', () => {
    const found: Disagreement[] = [];
    for (const { fixture, inProcess, shell } of reads) {
      if (!inProcess.result.ok || !shell.result.ok) continue;
      compareField(found, fixture.name, 'ids', inProcess.result.value.issues.map((i) => i.id), shell.result.value.issues.map((i) => i.id));
      shell.result.value.issues.forEach((issue, i) => {
        const other = (inProcess.result.ok ? inProcess.result.value.issues[i] ?? {} : {}) as unknown as Record<string, unknown>;
        const mine = issue as unknown as Record<string, unknown>;
        for (const key of new Set([...Object.keys(mine), ...Object.keys(other)])) {
          compareField(found, `${fixture.name} #${issue.id}`, key, other[key], mine[key]);
        }
      });
    }
    expect(found.map(report)).toEqual([]);
  });

  it('returns the same completeness and the same page count', () => {
    const found: Disagreement[] = [];
    for (const { fixture, inProcess, shell } of reads) {
      if (!inProcess.result.ok || !shell.result.ok) continue;
      compareField(found, fixture.name, 'complete', inProcess.result.value.complete, shell.result.value.complete);
      compareField(found, fixture.name, 'pages', inProcess.result.value.pages, shell.result.value.pages);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('holds every shape the rules read, so the comparison is not vacuous', () => {
    const issues = reads.flatMap((r) => (r.shell.result.ok ? r.shell.result.value.issues : []));
    expect(new Set(issues.map((i) => i.statusCategory))).toEqual(new Set(['To Do', 'In Progress', 'Done']));
    expect(new Set(issues.map((i) => i.assignees.length))).toEqual(new Set([0, 1]));
    expect(issues.some((i) => i.assignees[0]?.includes('@')) && issues.some((i) => i.assignees[0]?.startsWith('acct-'))).toBe(true);
    expect(issues.some((i) => i.type !== undefined) && issues.some((i) => i.type === undefined)).toBe(true);
    expect(issues.some((i) => (i.releases ?? []).length === 2) && issues.some((i) => (i.releases ?? []).length === 0)).toBe(true);
    expect(issues.some((i) => i.updatedAt !== undefined)).toBe(true);
    expect(issues.some((i) => i.closedAt !== undefined && i.closedAt !== null)).toBe(true);
    expect(new Set(reads.map((r) => r.fixture.read.kind))).toEqual(new Set(['open', 'closed', 'changed', 'inbox']));
    expect(new Set(reads.map((r) => outcomeOf(r.shell.result)))).toEqual(new Set(['answered', 'failed', 'unaskable']));
    expect(new Set(reads.flatMap((r) => (r.shell.result.ok ? [r.shell.result.value.complete] : [])))).toEqual(new Set([true, false]));
    expect(reads.some((r) => r.shell.result.ok && r.shell.result.value.issues.length === 0)).toBe(true);
    expect(reads.some((r) => r.shell.result.ok && r.shell.result.value.issues.length > 100)).toBe(true);
    expect(reads.some((r) => r.shell.sent.some((one) => one.query.nextPageToken !== undefined))).toBe(true);
    expect(reads.some((r) => refusedByHost(r.fixture) && r.fixture.exchanges.length > 1)).toBe(true);
    expect(reads.some((r) => r.fixture.name.startsWith('no-') && r.shell.sent.length === 0)).toBe(true);
  });
});
