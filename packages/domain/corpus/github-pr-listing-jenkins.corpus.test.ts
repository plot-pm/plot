import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { githubPrListing } from '../src/adapters/host/github-pr-listing.js';
import { hostShell } from '../src/adapters/host/host-shell.js';
import { shellContext } from '../src/adapters/scripts.js';
import type { PrListing } from '../src/ports/host.js';
import { canonical, replayClient, startGithubReplay, type ListingFixture } from '../test/fixtures/github-replay.js';
import { compareField, describingAs, type Disagreement } from './compare.js';
import { serveJenkins, stubJenReplay, stubReader, type JenkinsRecording } from './jenkins-listing-replay.js';

/**
 * Do the in-process GitHub PR listing with the Jenkins overlay and
 * `plot-host.sh pr-list` with `CI: jenkins` answer the same rows from one
 * recorded GitHub and one recorded Jenkins?
 *
 * `corpus/record-github-pr-listing.mjs` ran `plot-host.sh pr-list` with the
 * real `gh` and the real `jen` against stub servers. This test serves the
 * recorded `gh` and `jen` answers to the shell side through stubs on `PATH`,
 * and the recorded GraphQL exchanges and Jenkins routes to `githubPrListing`
 * built with a Jenkins reader. `rules/ci-build-rows.ts` is a declared
 * duplicate of the `jq` projection in `plot-host.sh`; neither side is
 * authoritative, and a disagreement stops the branch. The shell's field list
 * omits `statusCheckRollup` under `CI: jenkins` and the in-process query keeps
 * it, so GraphQL requests match by their variables.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const DIR = new URL('./fixtures/github-pr-listing-jenkins', import.meta.url).pathname;
const report = describingAs({ left: 'in-process', right: 'shell' });

type Fixture = ListingFixture & { readonly jenkins: JenkinsRecording };

interface Read {
  readonly fixture: Fixture;
  readonly inProcess: PrListing;
  readonly shell: PrListing;
  readonly jenkinsRequests: number;
}

let sandbox = '';
let reads: Read[] = [];

const stubGh = (dir: string, fixture: Fixture): void => {
  mkdirSync(dir, { recursive: true });
  fixture.calls.forEach((call, i) => {
    writeFileSync(join(dir, `call-${String(i)}.argv`), `${call.argv.join('\n')}\n`);
    writeFileSync(join(dir, `call-${String(i)}.out`), call.stdout);
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

const shellListing = async (dir: string, fixture: Fixture): Promise<PrListing> => {
  const set = { PATH: `${join(dir, 'gh')}:${join(dir, 'jen')}:${process.env.PATH ?? ''}`, PLOT_HOST: 'github', PLOT_CI: 'jenkins', JENKINS_INSTANCE: fixture.jenkins.instance, PLOT_BUDGET_OFF: '1' };
  const saved = Object.fromEntries(Object.keys(set).map((name) => [name, process.env[name]]));
  Object.assign(process.env, set);
  try {
    return await hostShell(shellContext(ROOT)).prListing(fixture.query);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

const inProcessListing = async (fixture: Fixture): Promise<{ listing: PrListing; requests: number }> => {
  const byVariables = (body: unknown): string => canonical((body as { variables?: unknown }).variables ?? null);
  const replay = await startGithubReplay(fixture.exchanges, (body) => {
    const hit = fixture.exchanges.find((one) => byVariables(one.request) === byVariables(body));
    return hit === undefined ? { status: 500, body: { message: 'unrecorded request' } } : { status: 200, body: hit.response };
  });
  const jenkins = await serveJenkins(fixture.jenkins.routes);
  const { api, cleanup } = replayClient(replay.url);
  const stub = stubReader(fixture.jenkins, jenkins.port);
  try {
    return { listing: await githubPrListing(api, stub.reader).prListing(fixture.query), requests: jenkins.seen.length };
  } finally {
    await replay.close();
    await jenkins.close();
    cleanup();
    stub.cleanup();
  }
};

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-github-listing-jenkins-corpus-'));
  reads = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
    const fixture = { name: file.replace(/\.json$/, ''), ...(JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Omit<Fixture, 'name'>) };
    const dir = join(sandbox, fixture.name);
    stubGh(join(dir, 'gh'), fixture);
    stubJenReplay(join(dir, 'jen'), fixture.jenkins);
    const shell = await shellListing(dir, fixture);
    const { listing, requests } = await inProcessListing(fixture);
    reads.push({ fixture, inProcess: listing, shell, jenkinsRequests: requests });
  }
}, 600_000);

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('the in-process GitHub listing with the Jenkins overlay agrees with plot-host.sh pr-list', () => {
  it('reads the fixtures recorded for the Jenkins arm', () => {
    expect(reads.map((r) => r.fixture.name).sort()).toEqual(['jenkins-all-rich-open', 'jenkins-open-rich', 'jenkins-open-rich-refused'].sort());
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
    const rows = reads.filter((r) => r.fixture.name !== 'jenkins-open-rich-refused').flatMap((r) => r.shell.rows);
    const words = new Set(rows.map((row) => `${String(row.checks)}${row.checksLookup === undefined ? '' : `/${String(row.checksLookup)}`}`));
    for (const word of ['green', 'failing', 'none', 'unknown']) expect([...words].some((w) => w.startsWith(word)), word).toBe(true);
    expect(rows.some((row) => row.checks === 'unknown' && row.checksLookup === 'skipped'), 'a row past the lookup cap').toBe(true);
    expect(rows.some((row) => row.checks === 'green' && row.checksSha !== ''), 'a green row bound to its commit').toBe(true);
    expect(reads.every((r) => r.jenkinsRequests > 0)).toBe(true);
  });
});
