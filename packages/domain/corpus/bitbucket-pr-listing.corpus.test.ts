import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bitbucketPrListing } from '../src/adapters/host/bitbucket-pr-listing.js';
import { hostShell, prListingArgs } from '../src/adapters/host/host-shell.js';
import type { PrListing } from '../src/ports/host.js';
import {
  bitbucketReplayClient,
  decoded,
  readBitbucketFixtures,
  startBitbucketReplay,
  type BitbucketListingFixture,
} from '../test/fixtures/bitbucket-replay.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Do the in-process Bitbucket PR listing and `plot-host.sh pr-list` answer the
 * same rows and the same completeness words from one recorded Bitbucket answer?
 *
 * `corpus/record-bitbucket-pr-listing.mjs` ran `plot-host.sh pr-list` against a
 * stub `bb` that pages a generated dataset the way Bitbucket Cloud does, and
 * recorded every `bb` stdout and every request path. This test serves the
 * stdouts to `hostShell(...).prListing` through a stub `bb` on `PATH`, and the
 * pages to `bitbucketPrListing` over a stub HTTP server. The row projection
 * (`rules/bitbucket-pr-row.ts`) and the sweep and window claims are declared
 * duplicates of `plot-host.sh`. Neither side is authoritative: a disagreement
 * stops the branch.
 *
 * Both sides read mergeability from a checkout whose `origin` cannot be
 * fetched, so every open row reads `unknown` on both. Real `git merge-tree`
 * answers are covered in `test/bitbucket-pr-listing.test.ts`.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const report = describingAs({ left: 'in-process', right: 'shell' });

interface Read {
  readonly fixture: BitbucketListingFixture;
  readonly inProcess: PrListing;
  readonly shell: PrListing;
  readonly sent: readonly string[];
}

let sandbox = '';
let reads: Read[] = [];

/** A stub `bb` that prints the recorded stdout for the recorded argv, and fails on any other argv. */
const stubBb = (dir: string, fixture: BitbucketListingFixture): void => {
  fixture.calls.forEach((call, i) => {
    writeFileSync(join(dir, `call-${i}.argv`), `${call.argv.join('\n')}\n`);
    writeFileSync(join(dir, `call-${i}.out`), call.stdout);
  });
  writeFileSync(
    join(dir, 'bb'),
    [
      '#!/usr/bin/env bash',
      `dir=${JSON.stringify(dir)}`,
      'printf \'%s\\n\' "$@" > "$dir/asked"',
      'for f in "$dir"/call-*.argv; do',
      '  if cmp -s "$f" "$dir/asked"; then cat "${f%.argv}.out"; exit 0; fi',
      'done',
      'echo "stub bb: unrecorded argv: $*" >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'bb'), 0o755);
};

/** A checkout whose `origin` no fetch can reach. */
const unreachableCheckout = (): string => {
  const repo = join(sandbox, 'checkout');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', join(sandbox, 'no-such-origin.git')], { cwd: repo });
  return repo;
};

/** `plot-host.sh pr-list` answering through the stub `bb`. */
const shellListing = async (dir: string, checkout: string, fixture: BitbucketListingFixture): Promise<PrListing> => {
  const names = ['PATH', 'PLOT_HOST', 'PLOT_CI', 'PLOT_BUDGET_OFF', 'PLOT_BB_SKIP_CAP_CHECK'] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.PATH = `${dir}:${saved.PATH}`;
  process.env.PLOT_HOST = 'bitbucket';
  process.env.PLOT_CI = 'github-actions';
  process.env.PLOT_BUDGET_OFF = '1';
  process.env.PLOT_BB_SKIP_CAP_CHECK = '1';
  try {
    return await hostShell({ repoRoot: checkout, scriptDir: join(ROOT, 'skills/plot/scripts') }).prListing(fixture.query);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

/** The in-process listing answering from the recorded pages, over a clone whose base cannot be resolved. */
const inProcessListing = async (fixture: BitbucketListingFixture): Promise<{ listing: PrListing; sent: string[] }> => {
  const replay = await startBitbucketReplay(fixture.exchanges);
  const { api, cleanup } = bitbucketReplayClient(replay.base);
  const refs = {
    resolve: async () => ({ ok: false as const, why: 'failed' as const }),
    conflictPaths: async () => ({ ok: false as const, why: 'failed' as const }),
  };
  try {
    return { listing: await bitbucketPrListing(api, refs).prListing(fixture.query), sent: replay.sent };
  } finally {
    await replay.close();
    cleanup();
  }
};

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-bitbucket-listing-corpus-'));
  const checkout = unreachableCheckout();
  reads = [];
  for (const fixture of readBitbucketFixtures()) {
    const dir = join(sandbox, fixture.name);
    mkdirSync(dir);
    stubBb(dir, fixture);
    const shell = await shellListing(dir, checkout, fixture);
    const { listing, sent } = await inProcessListing(fixture);
    reads.push({ fixture, inProcess: listing, shell, sent });
  }
}, 120_000);

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('the in-process Bitbucket PR listing agrees with plot-host.sh pr-list', () => {
  it('asks plot-host.sh with the arguments each fixture was recorded with', () => {
    expect(reads.length).toBeGreaterThanOrEqual(10);
    for (const { fixture } of reads) expect(prListingArgs(fixture.query), fixture.name).toEqual(['pr-list', ...fixture.args]);
  });

  it('requests the pages bb requested, in order, however each encodes the query', () => {
    const found: Disagreement[] = [];
    for (const { fixture, sent } of reads) {
      compareField(found, fixture.name, 'requests', sent.map(decoded), fixture.exchanges.map((one) => decoded(one.path)));
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
    expect(words('state')).toEqual(new Set(['OPEN', 'MERGED', 'CLOSED']));
    expect(words('draft')).toEqual(new Set([true, false]));
    expect(words('mergeable')).toContain('unknown');
    expect(rows.some((row) => row.author === '' || row.author === null)).toBe(true);
    expect(rows.some((row) => row.url === '' || row.url === null)).toBe(true);
    expect(rows.some((row) => String(row.head).includes('ünïcode'))).toBe(true);
    expect(new Set(reads.flatMap((r) => Object.values(r.shell.complete)))).toEqual(new Set(['whole', 'possibly-truncated']));
    expect(reads.some((r) => r.shell.rows.length > 100)).toBe(true);
    expect(reads.some((r) => r.fixture.query.since !== undefined)).toBe(true);
    expect(reads.some((r) => (r.fixture.query.branches?.length ?? 0) > 1)).toBe(true);
  });
});
