import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GH_QUERIES_FROM, githubPrListing } from '../src/adapters/host/github-pr-listing.js';
import { hostShell, prListingArgs } from '../src/adapters/host/host-shell.js';
import { shellContext } from '../src/adapters/scripts.js';
import type { PrListing } from '../src/ports/host.js';
import { canonical, readListingFixtures, replayClient, startGithubReplay, type ListingFixture } from '../test/fixtures/github-replay.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Do the in-process GitHub PR listing and `plot-host.sh pr-list` answer the
 * same rows and the same completeness words from one recorded GitHub answer?
 *
 * `corpus/record-github-pr-listing.mjs` ran `plot-host.sh pr-list` with the
 * real `gh`, pointed at a stub GitHub through `gh`'s `http_unix_socket`, and
 * recorded every GraphQL exchange and every `gh` stdout. This test serves the
 * exchanges to `githubPrListing` over a stub HTTP server, and the stdouts to
 * `hostShell(...).prListing` through a stub `gh` on `PATH`. The row
 * projection (`rules/github-pr-row.ts`, `rules/checks-of.ts`,
 * `rules/mergeable-of.ts`) is a declared duplicate of the jq programs in
 * `plot-host.sh`; `gh`'s own flattening of the GraphQL answer is copied into
 * the adapter. Neither side is authoritative: a disagreement stops the branch.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const report = describingAs({ left: 'in-process', right: 'shell' });

interface Read {
  readonly fixture: ListingFixture;
  readonly inProcess: PrListing;
  readonly shell: PrListing;
  readonly sent: readonly unknown[];
}

let sandbox = '';
let reads: Read[] = [];

/** A stub `gh` that prints the recorded stdout for the recorded argv, and fails on any other argv. */
const stubGh = (dir: string, fixture: ListingFixture): void => {
  fixture.calls.forEach((call, i) => {
    writeFileSync(join(dir, `call-${i}.argv`), `${call.argv.join('\n')}\n`);
    writeFileSync(join(dir, `call-${i}.out`), call.stdout);
  });
  writeFileSync(
    join(dir, 'gh'),
    [
      '#!/usr/bin/env bash',
      `dir=${JSON.stringify(dir)}`,
      'printf \'%s\\n\' "$@" > "$dir/asked"',
      'for f in "$dir"/call-*.argv; do',
      '  if cmp -s "$f" "$dir/asked"; then cat "${f%.argv}.out"; printf \'\\n\'; exit 0; fi',
      'done',
      'echo "stub gh: unrecorded argv: $*" >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'gh'), 0o755);
};

/** `plot-host.sh pr-list` answering through the stub `gh`. */
const shellListing = async (dir: string, fixture: ListingFixture): Promise<PrListing> => {
  const saved = { PATH: process.env.PATH, PLOT_HOST: process.env.PLOT_HOST, PLOT_CI: process.env.PLOT_CI, PLOT_BUDGET_OFF: process.env.PLOT_BUDGET_OFF };
  process.env.PATH = `${dir}:${saved.PATH}`;
  process.env.PLOT_HOST = 'github';
  process.env.PLOT_CI = 'github-actions';
  process.env.PLOT_BUDGET_OFF = '1';
  try {
    return await hostShell(shellContext(ROOT)).prListing(fixture.query);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

/** The in-process listing answering from the recorded exchanges. */
const inProcessListing = async (fixture: ListingFixture): Promise<{ listing: PrListing; sent: unknown[] }> => {
  const replay = await startGithubReplay(fixture.exchanges);
  const { api, cleanup } = replayClient(replay.url);
  try {
    return { listing: await githubPrListing(api).prListing(fixture.query), sent: replay.sent };
  } finally {
    await replay.close();
    cleanup();
  }
};

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-github-listing-corpus-'));
  reads = [];
  for (const fixture of readListingFixtures()) {
    const dir = join(sandbox, fixture.name);
    mkdirSync(dir);
    stubGh(dir, fixture);
    const shell = await shellListing(dir, fixture);
    const { listing, sent } = await inProcessListing(fixture);
    reads.push({ fixture, inProcess: listing, shell, sent });
  }
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('the in-process GitHub PR listing agrees with plot-host.sh pr-list', () => {
  it('reads fixtures recorded with the gh version whose queries the adapter sends', () => {
    expect(reads.length).toBeGreaterThanOrEqual(10);
    expect([...new Set(reads.map((r) => r.fixture.gh))]).toEqual([GH_QUERIES_FROM]);
  });

  it('asks plot-host.sh with the arguments each fixture was recorded with', () => {
    for (const { fixture } of reads) expect(prListingArgs(fixture.query), fixture.name).toEqual(['pr-list', ...fixture.args]);
  });

  it('sends the GraphQL requests gh sent, in order', () => {
    const found: Disagreement[] = [];
    for (const { fixture, sent } of reads) {
      const recorded = fixture.exchanges.map((one) => canonical(one.request));
      compareField(found, fixture.name, 'requests', sent.map(canonical), recorded);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('answers both sides in full, so the comparison reads rows and not refusals', () => {
    for (const { fixture, inProcess, shell } of reads) {
      expect([inProcess.answer, shell.answer, inProcess.refusal, shell.refusal], fixture.name).toEqual(['answered', 'answered', null, null]);
    }
  });

  it('returns the same rows, in the same order, field by field', () => {
    const found: Disagreement[] = [];
    for (const { fixture, inProcess, shell } of reads) {
      compareField(found, fixture.name, 'numbers', inProcess.rows.map((r) => r.number), shell.rows.map((r) => r.number));
      shell.rows.forEach((row, i) => {
        const other = inProcess.rows[i] ?? {};
        for (const key of new Set([...Object.keys(row), ...Object.keys(other)])) {
          compareField(found, `${fixture.name} #${String(row.number)}`, key, other[key], row[key]);
        }
      });
    }
    expect(found.map(report)).toEqual([]);
  });

  it('returns the same completeness word for every state', () => {
    const found: Disagreement[] = [];
    for (const { fixture, inProcess, shell } of reads) compareField(found, fixture.name, 'complete', inProcess.complete, shell.complete);
    expect(found.map(report)).toEqual([]);
  });

  it('holds every shape the projection reads, so the comparison is not vacuous', () => {
    const rows = reads.flatMap((r) => r.shell.rows);
    const words = (key: string) => new Set(rows.map((row) => row[key]).filter((v) => v !== undefined));
    expect(words('checks')).toEqual(new Set(['green', 'pending', 'failing', 'none', 'unknown']));
    expect(words('ciChecks')).toEqual(new Set(['green', 'pending', 'failing', 'none']));
    expect(words('mergeable')).toEqual(new Set(['mergeable', 'conflicting', 'unknown']));
    expect(words('plotReview')).toEqual(new Set(['absent', 'success', 'pending', 'failure', 'error']));
    expect(words('state')).toEqual(new Set(['OPEN', 'MERGED', 'CLOSED']));
    expect(words('draft')).toEqual(new Set([true, false]));
    expect([...words('author')].some((a) => String(a).startsWith('app/'))).toBe(true);
    expect(rows.some((row) => Array.isArray(row.failing_checks) && row.failing_checks.length > 1)).toBe(true);
    expect(new Set(reads.flatMap((r) => Object.values(r.shell.complete)))).toEqual(new Set(['whole', 'possibly-truncated']));
    expect(reads.some((r) => r.shell.rows.length > 100)).toBe(true);
    expect(reads.some((r) => r.fixture.query.since !== undefined)).toBe(true);
  });
});
