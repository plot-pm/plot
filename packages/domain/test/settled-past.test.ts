import { describe, expect, it } from 'vitest';
import { settledPast, type UnsettledReading } from '../src/rules/settled-past.js';
import { readUnsettled } from '../src/workflows/unsettled-line.js';
import { refsFixture } from '../src/adapters/refs/refs-fixture.js';

const SETTLED = { sha: 's'.repeat(40) };
const SET = ['docs/plans/', '.plot/briefs/', 'skills/plot/scripts/board/board-server.mjs'];
const line = (...commits: [string, readonly string[] | 'unknown'][]): UnsettledReading => ({
  headSha: commits[0]?.[0] ?? SETTLED.sha,
  commits: commits.map(([sha, files]) => ({ sha, files })),
});

describe('settledPast', () => {
  it('settles a head whose only commits are a bundle commit and a bookkeeping commit', () => {
    const past = line(['b2', ['skills/plot/scripts/board/board-server.mjs']], ['b1', ['docs/plans/x.md', '.plot/briefs/x.md']]);
    expect(settledPast(SETTLED, past, SET)).toBe(true);
  });

  it('settles a head equal to the settled commit', () => {
    expect(settledPast(SETTLED, { headSha: SETTLED.sha, commits: [] }, SET)).toBe(true);
  });

  it('refuses a commit with one in-set path and one outside it', () => {
    expect(settledPast(SETTLED, line(['b1', ['docs/plans/x.md', 'packages/a.ts']]), SET)).toBe(false);
  });

  it('refuses one code commit among Plot commits', () => {
    expect(settledPast(SETTLED, line(['b3', ['docs/plans/x.md']], ['b2', ['packages/a.ts']], ['b1', ['docs/plans/y.md']]), SET)).toBe(false);
  });

  it('refuses a rename from outside the set into it, which lists both paths', () => {
    expect(settledPast(SETTLED, line(['b1', ['packages/x/y.ts', 'docs/plans/y.ts']]), SET)).toBe(false);
  });

  it('refuses a path with a .. segment', () => {
    expect(settledPast(SETTLED, line(['b1', ['docs/plans/../../packages/a.ts']]), SET)).toBe(false);
  });

  it('refuses an unread diff', () => {
    expect(settledPast(SETTLED, line(['b1', 'unknown']), SET)).toBe(false);
  });

  it('refuses an unread line, an empty set, and an empty line before a different head', () => {
    expect(settledPast(SETTLED, 'unread', SET)).toBe(false);
    expect(settledPast(SETTLED, line(['b1', ['docs/plans/x.md']]), [])).toBe(false);
    expect(settledPast(SETTLED, { headSha: 'h', commits: [] }, SET)).toBe(false);
  });

  it('refuses a line that does not end at its head', () => {
    expect(settledPast(SETTLED, { headSha: 'other', commits: [{ sha: 'b1', files: ['docs/plans/x.md'] }] }, SET)).toBe(false);
  });

  it('refuses more than five commits, though each lies inside the set', () => {
    const six = Array.from({ length: 6 }, (_, i) => [`c${i}`, ['docs/plans/x.md']] as [string, string[]]);
    const five = six.slice(0, 5);
    expect(settledPast(SETTLED, line(...five), SET)).toBe(true);
    expect(settledPast(SETTLED, line(...six), SET)).toBe(false);
  });
});

describe('readUnsettled', () => {
  const commit = (sha: string) => ({ sha, tree: `t-${sha}`, subject: '', forward: false });
  const range = `${SETTLED.sha}..h3`;

  it('reads each commit with rename detection off', async () => {
    const refs = refsFixture({
      firstParentCommitLists: { [range]: [commit('h3'), commit('h2')] },
      commitFiles: { h3: ['docs/plans/y.ts'], h2: ['docs/plans/x.md'] },
      commitFilesNoRenames: { h3: ['packages/x/y.ts', 'docs/plans/y.ts'] },
    });
    expect(await readUnsettled(refs, SETTLED.sha, 'h3')).toEqual({
      headSha: 'h3',
      commits: [
        { sha: 'h3', files: ['packages/x/y.ts', 'docs/plans/y.ts'] },
        { sha: 'h2', files: ['docs/plans/x.md'] },
      ],
    });
  });

  it('reads a failed line as unread, never as empty', async () => {
    const refs = refsFixture({ failing: ['firstParentCommits'] });
    expect(await readUnsettled(refs, SETTLED.sha, 'h3')).toBe('unread');
  });

  it('reads a failed diff as unknown files', async () => {
    const refs = refsFixture({ firstParentCommitLists: { [range]: [commit('h3')] }, failing: ['commitFiles'] });
    expect(await readUnsettled(refs, SETTLED.sha, 'h3')).toEqual({ headSha: 'h3', commits: [{ sha: 'h3', files: 'unknown' }] });
  });

  it('reads a line longer than five as unread without asking any diff', async () => {
    const list = Array.from({ length: 6 }, (_, i) => commit(`c${i}`));
    const refs = refsFixture({ firstParentCommitLists: { [range]: list }, failing: ['commitFiles'] });
    expect(await readUnsettled(refs, SETTLED.sha, 'h3')).toBe('unread');
  });

  it('reads nothing where the head is the settled commit', async () => {
    const refs = refsFixture({ failing: ['firstParentCommits'] });
    expect(await readUnsettled(refs, SETTLED.sha, SETTLED.sha)).toEqual({ headSha: SETTLED.sha, commits: [] });
  });
});
