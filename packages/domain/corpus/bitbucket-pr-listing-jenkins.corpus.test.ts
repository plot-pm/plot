import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bitbucketPrListing } from '../src/adapters/host/bitbucket-pr-listing.js';
import { hostShell } from '../src/adapters/host/host-shell.js';
import type { PrListing } from '../src/ports/host.js';
import { bitbucketReplayClient, startBitbucketReplay, type BitbucketListingFixture } from '../test/fixtures/bitbucket-replay.js';
import { compareField, describingAs, type Disagreement } from './compare.js';
import { serveJenkins, stubJenReplay, stubReader, type JenkinsRecording } from './jenkins-listing-replay.js';

/**
 * Do the in-process Bitbucket PR listing with the Jenkins overlay and
 * `plot-host.sh pr-list` with `CI: jenkins` answer the same rows from one
 * recorded Bitbucket and one recorded Jenkins?
 *
 * `corpus/record-bitbucket-pr-listing.mjs` ran `plot-host.sh pr-list` with a
 * stub `bb` and the real `jen` against a stub Jenkins. This test serves the
 * recorded `bb` and `jen` answers to the shell side through stubs on `PATH`,
 * and the recorded pages and Jenkins routes to `bitbucketPrListing` built with
 * a Jenkins reader. `rules/ci-build-rows.ts` is a declared duplicate of the
 * `jq` projection in `plot-host.sh`; neither side is authoritative, and a
 * disagreement stops the branch.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const DIR = new URL('./fixtures/bitbucket-pr-listing-jenkins', import.meta.url).pathname;
const report = describingAs({ left: 'in-process', right: 'shell' });

type Fixture = BitbucketListingFixture & { readonly jenkins: JenkinsRecording };

interface Read {
  readonly fixture: Fixture;
  readonly inProcess: PrListing;
  readonly shell: PrListing;
  readonly jenkinsRequests: number;
}

let sandbox = '';
let reads: Read[] = [];

const stubBb = (dir: string, fixture: Fixture): void => {
  mkdirSync(dir, { recursive: true });
  fixture.calls.forEach((call, i) => {
    writeFileSync(join(dir, `call-${String(i)}.argv`), `${call.argv.join('\n')}\n`);
    writeFileSync(join(dir, `call-${String(i)}.out`), call.stdout);
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

const unreachableCheckout = (): string => {
  const repo = join(sandbox, 'checkout');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', join(sandbox, 'no-such-origin.git')], { cwd: repo });
  return repo;
};

const shellListing = async (dir: string, checkout: string, fixture: Fixture): Promise<PrListing> => {
  const set = {
    PATH: `${join(dir, 'bb')}:${join(dir, 'jen')}:${process.env.PATH ?? ''}`,
    PLOT_HOST: 'bitbucket',
    PLOT_CI: 'jenkins',
    JENKINS_INSTANCE: fixture.jenkins.instance,
    PLOT_BUDGET_OFF: '1',
    PLOT_BB_SKIP_CAP_CHECK: '1',
  };
  const saved = Object.fromEntries(Object.keys(set).map((name) => [name, process.env[name]]));
  Object.assign(process.env, set);
  try {
    return await hostShell({ repoRoot: checkout, scriptDir: join(ROOT, 'skills/plot/scripts') }).prListing(fixture.query);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

const inProcessListing = async (fixture: Fixture): Promise<{ listing: PrListing; requests: number }> => {
  const replay = await startBitbucketReplay(fixture.exchanges);
  const jenkins = await serveJenkins(fixture.jenkins.routes);
  const { api, cleanup } = bitbucketReplayClient(replay.base);
  const stub = stubReader(fixture.jenkins, jenkins.port);
  const refs = {
    resolve: async () => ({ ok: false as const, why: 'failed' as const }),
    conflictPaths: async () => ({ ok: false as const, why: 'failed' as const }),
  };
  try {
    return { listing: await bitbucketPrListing(api, refs, stub.reader).prListing(fixture.query), requests: jenkins.seen.length };
  } finally {
    await replay.close();
    await jenkins.close();
    cleanup();
    stub.cleanup();
  }
};

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-bitbucket-listing-jenkins-corpus-'));
  const checkout = unreachableCheckout();
  reads = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
    const fixture = { name: file.replace(/\.json$/, ''), ...(JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Omit<Fixture, 'name'>) };
    const dir = join(sandbox, fixture.name);
    stubBb(join(dir, 'bb'), fixture);
    stubJenReplay(join(dir, 'jen'), fixture.jenkins);
    const shell = await shellListing(dir, checkout, fixture);
    const { listing, requests } = await inProcessListing(fixture);
    reads.push({ fixture, inProcess: listing, shell, jenkinsRequests: requests });
  }
}, 600_000);

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('the in-process Bitbucket listing with the Jenkins overlay agrees with plot-host.sh pr-list', () => {
  it('reads the fixtures recorded for the Jenkins arm', () => {
    expect(reads.map((r) => r.fixture.name).sort()).toEqual(['jenkins-all-rich-open', 'jenkins-open-rich-open', 'jenkins-open-rich-open-refused']);
  });

  it('answers both sides, so the comparison reads rows and not refusals', () => {
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

  it('returns the same completeness word', () => {
    const found: Disagreement[] = [];
    for (const { fixture, inProcess, shell } of reads) compareField(found, fixture.name, 'complete', inProcess.complete, shell.complete);
    expect(found.map(report)).toEqual([]);
  });

  it('holds the shapes the overlay decides, so the comparison is not vacuous', () => {
    const rows = reads.flatMap((r) => r.shell.rows);
    const lookup = (word: string): boolean => rows.some((row) => row.checksLookup === word);
    for (const word of ['green', 'failing', 'none', 'unknown']) expect(rows.some((row) => row.checks === word), word).toBe(true);
    expect(lookup('skipped'), 'a row past the lookup cap').toBe(true);
    expect(lookup('broken'), 'a named row whose lookup did not answer').toBe(true);
    expect(rows.some((row) => row.checks === 'green' && row.checksSha !== ''), 'a green row bound to its commit').toBe(true);
    expect(reads.every((r) => r.jenkinsRequests > 0)).toBe(true);
  });
});
