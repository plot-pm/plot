import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { hostShell, prListingArgs, refusalKindOfRun } from '../src/adapters/host/host-shell.js';
import { listingCompleteness } from '../src/adapters/host/listing-notices.js';
import type { ShellContext } from '../src/adapters/scripts.js';
import type { Pr } from '../src/entities/pr.js';


const roots: string[] = [];

/** A context whose `plot-host.sh` is the given body; the body sees `pr-list …` as `$@`. */
const hostThat = (body: string): ShellContext => {
  const root = mkdtempSync(join(tmpdir(), 'plot-host-listing-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return { repoRoot: root, scriptDir };
};

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const ROW = '{"number":7,"head":"feature/a","state":"OPEN","checks":"green","draft":false}';
const OPEN_CLAIM = 'plot-host: github pr-list state=open page complete (1 rows below requested limit 9) — this page holds every pull request the host has in this state';

describe('Host.prListing over plot-host.sh', () => {
  it('a page that prints no page complete notice for a state answers possibly-truncated for that state', async () => {
    const host = hostShell(hostThat(`echo '${ROW}'`));
    const listing = await host.prListing({ state: 'open', limit: 9, rich: true });
    expect(listing.answer).toBe('answered');
    expect(listing.rows).toEqual([JSON.parse(ROW)]);
    expect(listing.complete).toEqual({ open: 'possibly-truncated' });
    expect(listing.refusal).toBeNull();
    expect(host.lastRefusal()).toBeNull();
  });

  it('a page complete notice for the asked state answers whole', async () => {
    const listing = await hostShell(hostThat(`echo '${ROW}'; echo '${OPEN_CLAIM}' >&2`)).prListing({ state: 'open', limit: 9 });
    expect(listing.complete).toEqual({ open: 'whole' });
  });

  it('passes the query to the script as pr-list arguments', async () => {
    const context = hostThat('printf \'%s\\n\' "$@" > "$(dirname "$0")/args"');
    await hostShell(context).prListing({ state: 'all', limit: 5, since: '2026-11-01T00:00:00Z', richOpen: true, boundShas: { 'feature/a': 'abc' } });
    expect(readFileSync(join(context.scriptDir, 'args'), 'utf8').trim().split('\n')).toEqual([
      'pr-list', '--rich-open', '--state', 'all', '--limit', '5', '--since', '2026-11-01T00:00:00Z', '--bound-shas', '{"feature/a":"abc"}',
    ]);
  });

  it('a secondary limit (exit 6) answers failed with the kind and the words verbatim', async () => {
    const host = hostShell(hostThat('echo "You have exceeded a secondary rate limit" >&2; exit 6'));
    const listing = await host.prListing({ state: 'open' });
    expect(listing).toEqual({
      answer: 'failed',
      rows: [],
      complete: { open: 'possibly-truncated' },
      refusal: { kind: 'secondary', said: 'You have exceeded a secondary rate limit' },
    });
    expect(host.lastRefusal()).toEqual(listing.refusal);
  });

  it('a 401 from gh answers the refusal kind auth', async () => {
    const said = 'HTTP 401: Bad credentials (https://api.github.com/graphql)';
    const listing = await hostShell(hostThat(`echo "${said}" >&2; exit 3`)).prListing({ state: 'merged', limit: 500 });
    expect(listing.refusal).toEqual({ kind: 'auth', said });
  });

  it('a spent quota (exit 5) answers throttled', async () => {
    const listing = await hostShell(hostThat('echo "API rate limit exceeded" >&2; exit 5')).prListing({ state: 'open' });
    expect(listing.refusal?.kind).toBe('throttled');
  });

  it('a partial answer (exit 7) keeps its rows and names the missing state', async () => {
    const listing = await hostShell(hostThat(`echo '${ROW}'; echo "state merged failed" >&2; exit 7`)).prListing({ state: 'all' });
    expect(listing.answer).toBe('partial');
    expect(listing.rows).toHaveLength(1);
    expect(listing.refusal).toEqual({ kind: 'failed', said: 'state merged failed' });
  });

  it('an unaskable host (exit 4) answers unaskable with its words', async () => {
    const listing = await hostShell(hostThat('echo "no arm for gitlab" >&2; exit 4')).prListing({ state: 'open' });
    expect(listing.answer).toBe('unaskable');
    expect(listing.refusal).toEqual({ kind: 'failed', said: 'no arm for gitlab' });
  });

  it('a line that is not a JSON object fails the call', async () => {
    for (const line of ['{not json}', '[1]', 'null']) {
      const listing = await hostShell(hostThat(`echo '${line}'`)).prListing({ state: 'open' });
      expect(listing.answer).toBe('failed');
      expect(listing.refusal?.said).toBe('pr-list printed a line that is not a PR row');
    }
  });

  it('names the script exit where the failed run said nothing', async () => {
    const listing = await hostShell(hostThat('exit 3')).prListing({ state: 'open' });
    expect(listing.refusal).toEqual({ kind: 'failed', said: 'plot-host.sh exited 3' });
  });
});

describe('prListingArgs', () => {
  it('asks plain, rich and rich-open with only the flags the query names', () => {
    expect(prListingArgs({ state: 'open' })).toEqual(['pr-list', '--state', 'open']);
    expect(prListingArgs({ state: 'open', rich: true })).toEqual(['pr-list', '--rich', '--state', 'open']);
    expect(prListingArgs({ state: 'all', rich: true, richOpen: true, boundShas: {} })).toEqual(['pr-list', '--rich-open', '--state', 'all']);
  });
});

describe('refusalKindOfRun', () => {
  it('reads auth only off a failed exit that names a 401', () => {
    expect(refusalKindOfRun(3, 'HTTP 401: Bad credentials')).toBe('auth');
    expect(refusalKindOfRun(1, 'Bad credentials')).toBe('auth');
    expect(refusalKindOfRun(3, 'HTTP 503')).toBe('failed');
    expect(refusalKindOfRun(7, 'HTTP 401')).toBe('failed');
    expect(refusalKindOfRun(5, 'HTTP 401')).toBe('throttled');
    expect(refusalKindOfRun(6, 'HTTP 401')).toBe('secondary');
  });
});

describe('listingCompleteness', () => {
  const claim = (state: string, how = 'page') => `plot-host: github pr-list state=${state} ${how} complete (1 rows) — …`;
  const doubt = (state: string) => `plot-host: github pr-list state=${state} possibly truncated (9 rows, requested limit 9 unprovable)`;

  it('reads each state a notice names', () => {
    expect(listingCompleteness(`${claim('open')}\n${claim('all')}`, 'all')).toEqual({ open: 'whole', all: 'whole' });
    expect(listingCompleteness(`${claim('open')}\n${doubt('all')}`, 'all')).toEqual({ open: 'whole', all: 'possibly-truncated' });
    expect(listingCompleteness(`${claim('open')}\n${doubt('open')}`, 'open')).toEqual({ open: 'possibly-truncated' });
  });

  it('reads the asked state from the states the host reported where no notice names it', () => {
    expect(listingCompleteness(`${claim('OPEN', 'window')}\n${claim('MERGED', 'window')}`, 'all').all).toBe('whole');
    expect(listingCompleteness(`${claim('OPEN')}\n${doubt('MERGED')}`, 'all').all).toBe('possibly-truncated');
    expect(listingCompleteness('', 'open')).toEqual({ open: 'possibly-truncated' });
  });

  it('reads a sweep claim as the asked state whole', () => {
    expect(listingCompleteness('plot-host: pr-list sweep complete (3 branches asked, 2 of 2 states answered)', 'settled')).toEqual({ settled: 'whole' });
  });
});

describe('hostFixture.prListing', () => {
  const pr = (number: number, state: Pr['state']): Pr => ({
    number, repo: '', head: `feature/${number}`, base: 'main', state, mergedAt: null, mergeCommit: '', draft: false,
    mergeable: 'unknown', review: '', checks: 'unknown', failingChecks: [], url: '', author: '',
  });

  it('lists the fixture PRs in the asked state, whole below the limit', async () => {
    const host = hostFixture({ prs: [pr(1, 'OPEN'), pr(2, 'MERGED'), pr(3, 'MERGED')] });
    expect((await host.prListing({ state: 'open' })).rows.map((row) => row.number)).toEqual([1]);
    const merged = await host.prListing({ state: 'merged', limit: 2 });
    expect(merged.rows.map((row) => row.number)).toEqual([2, 3]);
    expect(merged.complete).toEqual({ merged: 'possibly-truncated' });
    expect((await host.prListing({ state: 'all', limit: 9 })).complete).toEqual({ all: 'whole' });
  });
});
