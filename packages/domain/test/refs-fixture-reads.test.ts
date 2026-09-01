import { describe, it, expect } from 'vitest';

import { refsFixture } from '../src/adapters/refs/refs-fixture.js';

/**
 * The fixture's tree and blob readings, which the board's read path uses most.
 *
 * `adapters-fixtures.test.ts` covers the branch and merge questions. These are
 * the ones `board.ts` reaches for on every request — listing a ref's plans and
 * reading their bytes — and they were uncovered because the migration added
 * them and moved on.
 *
 * A fixture is worth asserting for the same reason it is worth having: every
 * test that stands in for git inherits whatever it gets wrong, and the two
 * distinctions below are exactly the ones a careless stub collapses.
 */
describe('refsFixture: a listing is scoped to the directory asked for', () => {
  const refs = refsFixture({
    trees: {
      'origin/main': [
        { path: 'docs/plans/a.md', sha: 'aaa', mode: '100644' },
        { path: 'docs/plans/nested/b.md', sha: 'bbb', mode: '100644' },
        { path: 'docs/sprints/c.md', sha: 'ccc', mode: '100644' },
        { path: 'docs/plans/link.md', sha: 'ddd', mode: '120000' },
      ],
    },
  });

  it('returns only the blobs under the directory', async () => {
    const listed = await refs.listBlobs('origin/main', 'docs/plans/');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((b) => b.path)).toEqual([
      'docs/plans/a.md',
      'docs/plans/nested/b.md',
      'docs/plans/link.md',
    ]);
  });

  it('carries the mode, because a symlink is not a file', async () => {
    // The reason the fixture states full blobs rather than paths: `120000` is
    // what separates a plan from a link pointing at one, and the index
    // directories are built from links.
    const listed = await refs.listBlobs('origin/main', 'docs/plans/');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.find((b) => b.path === 'docs/plans/link.md')?.mode).toBe('120000');
  });

  it('answers an empty list for a ref it holds no tree for', async () => {
    const listed = await refs.listBlobs('origin/nothing', 'docs/plans/');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toEqual([]);
  });
});

describe('refsFixture: an unreadable object is absent, not empty', () => {
  const refs = refsFixture({ blobs: { aaa: '# a plan', bbb: '' } });

  it('returns the content of every sha it holds', async () => {
    const read = await refs.readBlobs(['aaa']);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.get('aaa')).toBe('# a plan');
  });

  it('keeps an EMPTY file distinct from a missing one', async () => {
    // git answers `<sha> missing` and carries no body. A fixture answering ''
    // for both would make an unreadable object indistinguishable from an empty
    // file, and the caller cannot tell a truncated read from a blank plan.
    const read = await refs.readBlobs(['bbb', 'zzz']);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.get('bbb')).toBe('');
    expect(read.value.has('zzz')).toBe(false);
  });
});

describe('refsFixture: the readings that answer null rather than zero', () => {
  it('reports how far behind a ref the checkout sits', async () => {
    const refs = refsFixture({ behind: { 'origin/main': 3 } });
    const behind = await refs.countBehind('origin/main');
    expect(behind.ok).toBe(true);
    if (!behind.ok) return;
    expect(behind.value).toBe(3);
  });

  it('answers null for a ref with no reading — a detached HEAD, not zero', async () => {
    const refs = refsFixture({ behind: {} });
    const behind = await refs.countBehind('origin/main');
    expect(behind.ok).toBe(true);
    if (!behind.ok) return;
    expect(behind.value).toBeNull();
  });
});

describe('refsFixture: an absent pulse cannot be asked, and does not read empty', () => {
  it('is unaskable when the fixture states no pulse', async () => {
    const asked = await refsFixture({}).pulse();
    // NOT `{ ok: true, value: <empty fleet> }` — a fixture that forgot to state
    // a pulse must not read as an estate with nothing in it.
    expect(asked.ok).toBe(false);
  });
});

describe('refsFixture: the remaining single-value readings', () => {
  it('resolves a ref it holds and refuses one it does not', async () => {
    const refs = refsFixture({ shas: { 'origin/main': 'deadbee' } });
    const hit = await refs.resolve('origin/main');
    expect(hit.ok).toBe(true);
    if (hit.ok) expect(hit.value).toBe('deadbee');
    expect((await refs.resolve('origin/absent')).ok).toBe(false);
  });

  it('reports the repository root', async () => {
    const root = await refsFixture({ repoRoot: '/tmp/estate' }).repoRoot();
    expect(root.ok).toBe(true);
    if (root.ok) expect(root.value).toBe('/tmp/estate');
  });

  it('shows a file at a ref, keyed by `<ref>:<path>`', async () => {
    const refs = refsFixture({ files: { 'origin/main:docs/plans/a.md': '# a' } });
    const shown = await refs.showFile('origin/main', 'docs/plans/a.md');
    expect(shown.ok).toBe(true);
    if (shown.ok) expect(shown.value).toBe('# a');
  });

  it('reports the files a branch changed', async () => {
    const refs = refsFixture({ changedFiles: { 'feature/x': ['a.ts', 'b.ts'] } });
    const changed = await refs.changedFiles('feature/x');
    expect(changed.ok).toBe(true);
    if (changed.ok) expect(changed.value).toEqual(['a.ts', 'b.ts']);
  });
});

/**
 * `branchTips` takes REF PATTERNS, not branch names, because that is what
 * `git for-each-ref` takes — and the fixture has to match them the way git
 * would or every caller inherits a different matcher.
 */
describe('refsFixture: a tip lookup matches the pattern git was given', () => {
  const refs = refsFixture({
    tips: { 'feature/x': 'cafe1', 'feature/y': 'cafe2', 'bug/z': 'cafe3' },
  });

  it('matches a trailing-star prefix', async () => {
    const tips = await refs.branchTips(['refs/remotes/origin/feature/*']);
    expect(tips.ok).toBe(true);
    if (!tips.ok) return;
    expect(tips.value.map((t) => t.branch).sort()).toEqual(['feature/x', 'feature/y']);
  });

  it('matches one exact ref', async () => {
    const tips = await refs.branchTips(['refs/remotes/origin/bug/z']);
    expect(tips.ok).toBe(true);
    if (!tips.ok) return;
    expect(tips.value).toEqual([{ branch: 'bug/z', sha: 'cafe3' }]);
  });

  it('matches nothing for a pattern outside the remote namespace', async () => {
    // A local `refs/heads/*` pattern is not what this reading answers, and
    // silently treating it as a remote one would report tips for refs the
    // caller did not ask about.
    const tips = await refs.branchTips(['refs/heads/feature/*']);
    expect(tips.ok).toBe(true);
    if (!tips.ok) return;
    expect(tips.value).toEqual([]);
  });
});
