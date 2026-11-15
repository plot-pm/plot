import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shellContext } from '../src/adapters/scripts.js';
import { trackerGithub } from '../src/adapters/tracker/tracker-github.js';
import type { PortResult } from '../src/port-result.js';
import type { IssueRead, Tracker } from '../src/ports/tracker.js';
import { canonical } from '../test/fixtures/github-replay.js';
import { exchangeClient, readExchangeFixtures, startExchangeReplay, type ExchangeFixture, type SentRequest } from '../test/fixtures/github-exchange-replay.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Do the in-process GitHub issue reads and `plot-host.sh issue-list` answer
 * the same issues, the same completeness and the same outcome from one
 * recorded GitHub answer?
 *
 * `corpus/record-github-issues-runs.mjs` ran `plot-host.sh issue-list` with
 * the real `gh`, pointed at a stub GitHub through `gh`'s `http_unix_socket`,
 * and recorded every GraphQL exchange and every `gh` stdout, stderr and exit
 * code. This test serves the exchanges to `trackerGithub(context, api)` over
 * a stub HTTP server, and the `gh` output to `trackerGithub(context)` through
 * a stub `gh` on `PATH`. The row projection (`rules/github-issue-row.ts`) is
 * a declared duplicate of the jq program in `plot-host.sh`'s GitHub
 * `issue-list` arm; `gh`'s flattening of the GraphQL answer is copied into
 * `adapters/host/github-issue-list.ts`. Neither side is authoritative: a
 * disagreement stops the branch.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const report = describingAs({ left: 'in-process', right: 'shell' });

/** What the recorder asked, per fixture. */
interface IssueAsk {
  readonly kind: 'open' | 'closed' | 'changed';
  readonly since?: string;
  readonly limit: number;
}

interface Read {
  readonly fixture: ExchangeFixture;
  readonly inProcess: PortResult<IssueRead>;
  readonly inProcessRefusal: string | null;
  readonly shell: PortResult<IssueRead>;
  readonly shellRefusal: string | null;
  readonly sent: readonly SentRequest[];
}

let sandbox = '';
let reads: Read[] = [];

/** Asks one tracker the fixture's read. */
const ask = (tracker: Tracker, read: IssueAsk): Promise<PortResult<IssueRead>> =>
  read.kind === 'open'
    ? tracker.issueListOpen(read.limit)
    : read.kind === 'closed'
      ? tracker.issueListClosed(read.since ?? '', read.limit)
      : tracker.issueListChanged(read.since ?? '', read.limit);

/** A stub `gh` that replays the recorded output for the recorded argv, and fails on any other argv. */
const stubGh = (dir: string, fixture: ExchangeFixture): void => {
  fixture.calls.forEach((call, i) => {
    writeFileSync(join(dir, `call-${i}.argv`), `${call.argv.join('\n')}\n`);
    writeFileSync(join(dir, `call-${i}.out`), call.stdout);
    writeFileSync(join(dir, `call-${i}.err`), call.stderr);
    writeFileSync(join(dir, `call-${i}.code`), String(call.code));
  });
  writeFileSync(
    join(dir, 'gh'),
    [
      '#!/usr/bin/env bash',
      `dir=${JSON.stringify(dir)}`,
      'printf \'%s\\n\' "$@" > "$dir/asked"',
      'for f in "$dir"/call-*.argv; do',
      '  if cmp -s "$f" "$dir/asked"; then b="${f%.argv}"; cat "$b.out"; cat "$b.err" >&2; exit "$(cat "$b.code")"; fi',
      'done',
      'echo "stub gh: unrecorded argv: $*" >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'gh'), 0o755);
};

/** `plot-host.sh issue-list` answering through the stub `gh`. */
const shellRead = async (dir: string, read: IssueAsk): Promise<{ result: PortResult<IssueRead>; refusal: string | null }> => {
  const saved = { PATH: process.env.PATH, PLOT_HOST: process.env.PLOT_HOST, PLOT_BUDGET_OFF: process.env.PLOT_BUDGET_OFF };
  process.env.PATH = `${dir}:${saved.PATH}`;
  process.env.PLOT_HOST = 'github';
  process.env.PLOT_BUDGET_OFF = '1';
  try {
    const tracker = trackerGithub(shellContext(ROOT));
    const result = await ask(tracker, read);
    return { result, refusal: tracker.lastRefusal() };
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

/** The in-process reads answering from the recorded exchanges. */
const inProcessRead = async (fixture: ExchangeFixture, read: IssueAsk) => {
  const replay = await startExchangeReplay(fixture.exchanges);
  const { api, cleanup } = exchangeClient(replay.url);
  try {
    const tracker = trackerGithub(shellContext(ROOT), api);
    const result = await ask(tracker, read);
    return { result, refusal: tracker.lastRefusal(), sent: replay.sent };
  } finally {
    await replay.close();
    cleanup();
  }
};

/** The outcome of a result, without its value. */
const outcomeOf = (result: PortResult<IssueRead>): string => (result.ok ? 'answered' : result.why);

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-github-issues-corpus-'));
  reads = [];
  for (const fixture of readExchangeFixtures('github-issue-reads')) {
    const dir = join(sandbox, fixture.name);
    mkdirSync(dir);
    stubGh(dir, fixture);
    const read = fixture.read as IssueAsk;
    const shell = await shellRead(dir, read);
    const inProcess = await inProcessRead(fixture, read);
    reads.push({ fixture, inProcess: inProcess.result, inProcessRefusal: inProcess.refusal, shell: shell.result, shellRefusal: shell.refusal, sent: inProcess.sent });
  }
}, 120_000);

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('the in-process GitHub issue reads agree with plot-host.sh issue-list', () => {
  it('reads fixtures recorded with the gh version whose queries the PR listing also sends', () => {
    expect(reads.length).toBeGreaterThanOrEqual(10);
    expect([...new Set(reads.map((r) => r.fixture.gh))]).toEqual(['gh version 2.103.3 (2026-10-26)']);
  });

  it('sends the GraphQL requests gh sent, in order', () => {
    const found: Disagreement[] = [];
    for (const { fixture, sent } of reads) {
      compareField(found, fixture.name, 'requests', sent.map(canonical), fixture.exchanges.map((one) => canonical(one.request)));
    }
    expect(found.map(report)).toEqual([]);
  });

  it('answers the same outcome, and the same refusal text without the script prefix', () => {
    const found: Disagreement[] = [];
    for (const { fixture, inProcess, shell, inProcessRefusal, shellRefusal } of reads) {
      compareField(found, fixture.name, 'outcome', outcomeOf(inProcess), outcomeOf(shell));
      compareField(found, fixture.name, 'refusal', inProcessRefusal, shellRefusal?.replace(/^plot-host: /, '') ?? null);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('returns the same issues, in the same order, field by field', () => {
    const found: Disagreement[] = [];
    for (const { fixture, inProcess, shell } of reads) {
      if (!inProcess.ok || !shell.ok) continue;
      compareField(found, fixture.name, 'ids', inProcess.value.issues.map((i) => i.id), shell.value.issues.map((i) => i.id));
      shell.value.issues.forEach((issue, i) => {
        const other = (inProcess.value.issues[i] ?? {}) as unknown as Record<string, unknown>;
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
      if (!inProcess.ok || !shell.ok) continue;
      compareField(found, fixture.name, 'complete', inProcess.value.complete, shell.value.complete);
      compareField(found, fixture.name, 'pages', inProcess.value.pages, shell.value.pages);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('holds every shape the projection reads, so the comparison is not vacuous', () => {
    const issues = reads.flatMap((r) => (r.shell.ok ? r.shell.value.issues : []));
    expect(new Set(issues.map((i) => i.status))).toEqual(new Set(['open', 'closed']));
    expect(new Set(issues.map((i) => i.statusCategory))).toEqual(new Set(['To Do', 'Done']));
    expect(new Set(issues.map((i) => i.assignees.length))).toEqual(new Set([0, 1, 2]));
    expect(issues.some((i) => i.type !== undefined) && issues.some((i) => i.type === undefined)).toBe(true);
    expect(issues.some((i) => (i.releases ?? []).length > 0) && issues.some((i) => (i.releases ?? []).length === 0)).toBe(true);
    expect(issues.some((i) => (i.labels ?? []).length > 0) && issues.some((i) => i.labels !== undefined && i.labels.length === 0)).toBe(true);
    expect(issues.some((i) => i.updatedAt !== undefined)).toBe(true);
    expect(issues.some((i) => i.status === 'closed' && i.closedAt === null)).toBe(true);
    expect(new Set(reads.map((r) => r.fixture.name.split('-')[0]))).toEqual(new Set(['open', 'closed', 'changed', 'issues']));
    expect(new Set(reads.map((r) => outcomeOf(r.shell)))).toEqual(new Set(['answered', 'failed']));
    expect(new Set(reads.flatMap((r) => (r.shell.ok ? [r.shell.value.complete] : [])))).toEqual(new Set([true, false]));
    expect(reads.some((r) => r.shell.ok && r.shell.value.issues.length === 0)).toBe(true);
    expect(reads.some((r) => r.shell.ok && r.shell.value.issues.length > 100)).toBe(true);
    const ids = reads.flatMap((r) => (r.shell.ok ? [r.shell.value.issues.map((i) => i.id)] : []));
    expect(ids.some((one) => new Set(one).size < one.length)).toBe(true);
  });
});
