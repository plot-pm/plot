import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildActions } from '../src/adapters/build/build-actions.js';
import { shellContext } from '../src/adapters/scripts.js';
import type { WorkflowShaRun } from '../src/entities/build.js';
import type { PortResult } from '../src/port-result.js';
import { canonical } from '../test/fixtures/github-replay.js';
import { exchangeClient, readExchangeFixtures, startExchangeReplay, type ExchangeFixture, type SentRequest } from '../test/fixtures/github-exchange-replay.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Do the in-process `runsForSha` and `plot-host.sh runs-for-sha` pick the
 * same runs from one recorded GitHub Actions answer?
 *
 * `corpus/record-github-issues-runs.mjs` ran `plot-host.sh runs-for-sha` with
 * the real `gh`, pointed at a stub GitHub through `gh`'s `http_unix_socket`,
 * and recorded every REST exchange and the `gh run list` stdout. This test
 * serves the exchanges to `buildActions(context, api)` over a stub HTTP
 * server, and the stdout to `buildActions(context)` through a stub `gh` on
 * `PATH`. The pick (`rules/runs-for-sha.ts`, newest first, only the asked
 * commit) is a declared duplicate of the jq program in the `runs-for-sha`
 * arm; `gh`'s flattening of the REST answer is copied into
 * `adapters/host/github-runs.ts`. Neither side is authoritative: a
 * disagreement stops the branch.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const report = describingAs({ left: 'in-process', right: 'shell' });

interface Read {
  readonly fixture: ExchangeFixture;
  readonly inProcess: PortResult<readonly WorkflowShaRun[]>;
  readonly shell: PortResult<readonly WorkflowShaRun[]>;
  readonly sent: readonly SentRequest[];
}

let sandbox = '';
let reads: Read[] = [];

/** A stub `gh` that replays the recorded output for the recorded argv, and fails on any other argv. */
const stubGh = (dir: string, fixture: ExchangeFixture): void => {
  fixture.calls.forEach((call, i) => {
    writeFileSync(join(dir, `call-${i}.argv`), `${call.argv.join('\n')}\n`);
    writeFileSync(join(dir, `call-${i}.out`), call.stdout);
    writeFileSync(join(dir, `call-${i}.code`), String(call.code));
  });
  writeFileSync(
    join(dir, 'gh'),
    [
      '#!/usr/bin/env bash',
      `dir=${JSON.stringify(dir)}`,
      'printf \'%s\\n\' "$@" > "$dir/asked"',
      'for f in "$dir"/call-*.argv; do',
      '  if cmp -s "$f" "$dir/asked"; then b="${f%.argv}"; cat "$b.out"; exit "$(cat "$b.code")"; fi',
      'done',
      'echo "stub gh: unrecorded argv: $*" >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'gh'), 0o755);
};

/** `plot-host.sh runs-for-sha` answering through the stub `gh`. */
const shellRead = async (dir: string, branch: string, sha: string): Promise<PortResult<readonly WorkflowShaRun[]>> => {
  const saved = { PATH: process.env.PATH, PLOT_HOST: process.env.PLOT_HOST, PLOT_BUDGET_OFF: process.env.PLOT_BUDGET_OFF };
  process.env.PATH = `${dir}:${saved.PATH}`;
  process.env.PLOT_HOST = 'github';
  process.env.PLOT_BUDGET_OFF = '1';
  try {
    return await buildActions(shellContext(ROOT)).runsForSha(branch, sha);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

/** The in-process read answering from the recorded exchanges. */
const inProcessRead = async (fixture: ExchangeFixture, branch: string, sha: string) => {
  const replay = await startExchangeReplay(fixture.exchanges);
  const { api, cleanup } = exchangeClient(replay.url);
  try {
    return { result: await buildActions(shellContext(ROOT), api).runsForSha(branch, sha), sent: replay.sent };
  } finally {
    await replay.close();
    cleanup();
  }
};

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-runs-for-sha-corpus-'));
  reads = [];
  for (const fixture of readExchangeFixtures('github-runs-for-sha')) {
    const dir = join(sandbox, fixture.name);
    mkdirSync(dir);
    stubGh(dir, fixture);
    const branch = fixture.branch as string;
    const sha = fixture.sha as string;
    const shell = await shellRead(dir, branch, sha);
    const inProcess = await inProcessRead(fixture, branch, sha);
    reads.push({ fixture, inProcess: inProcess.result, shell, sent: inProcess.sent });
  }
}, 120_000);

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('the in-process runsForSha agrees with plot-host.sh runs-for-sha', () => {
  it('reads fixtures recorded with the gh version the issue reads were recorded with', () => {
    expect(reads.length).toBeGreaterThanOrEqual(5);
    expect([...new Set(reads.map((r) => r.fixture.gh))]).toEqual(['gh version 2.103.3 (2026-10-26)']);
  });

  it('sends the REST requests gh sent, in order', () => {
    const found: Disagreement[] = [];
    for (const { fixture, sent } of reads) {
      compareField(found, fixture.name, 'requests', sent.map(canonical), fixture.exchanges.map((one) => canonical(one.request)));
    }
    expect(found.map(report)).toEqual([]);
  });

  it('answers both sides, so the comparison reads runs and not refusals', () => {
    for (const { fixture, inProcess, shell } of reads) expect([inProcess.ok, shell.ok], fixture.name).toEqual([true, true]);
  });

  it('picks the same runs, in the same order, field by field', () => {
    const found: Disagreement[] = [];
    for (const { fixture, inProcess, shell } of reads) {
      if (!inProcess.ok || !shell.ok) continue;
      compareField(found, fixture.name, 'count', inProcess.value.length, shell.value.length);
      shell.value.forEach((run, i) => {
        const other = (inProcess.value[i] ?? {}) as unknown as Record<string, unknown>;
        const mine = run as unknown as Record<string, unknown>;
        for (const key of new Set([...Object.keys(mine), ...Object.keys(other)])) {
          compareField(found, `${fixture.name} [${String(i)}]`, key, other[key], mine[key]);
        }
      });
    }
    expect(found.map(report)).toEqual([]);
  });

  it('holds every shape the pick reads, so the comparison is not vacuous', () => {
    const runs = reads.flatMap((r) => (r.shell.ok ? r.shell.value : []));
    expect(runs.some((run) => run.conclusion === null)).toBe(true);
    expect(new Set(runs.map((run) => run.conclusion))).toEqual(new Set([null, 'success', 'failure', 'cancelled', 'action_required', 'skipped', 'neutral']));
    expect(new Set(runs.map((run) => run.workflow))).toEqual(new Set(['CI', 'Board', 'Release', '']));
    expect(runs.some((run) => run.startedAt === '0001-01-01T00:00:00Z')).toBe(true);
    expect(reads.filter((r) => r.shell.ok && r.shell.value.length === 0).map((r) => r.fixture.name).sort()).toEqual(['no-match', 'no-runs', 'past-the-limit']);
    expect(reads.some((r) => r.shell.ok && r.shell.value.length > 1)).toBe(true);
  });
});
