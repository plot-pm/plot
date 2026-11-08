import { describe, it, expect } from 'vitest';
import { refsFixture } from '../src/adapters/index.js';
import { failed } from '../src/port-result.js';
import {
  lagLine,
  linkTarget,
  recordRef,
  removedKeyFinding,
  stateTrackRef,
  unionBlobs,
} from '../src/rules/record-ref.js';
import {
  derefRecord,
  listRecordBlobs,
  readRecordFindings,
  readRefFor,
  recordsAhead,
  resolveRecordRef,
} from '../src/workflows/record-listing.js';

const STATE = 'refs/remotes/origin/plot/state';
const MAIN = 'refs/remotes/origin/main';
const source = { stateBranch: 'plot/state', defaultBranch: 'main' };
const blob = (path: string, sha: string, mode = '100644') => ({ mode, sha, path });
const commit = (subject: string) => ({ at: 0, subject, tree: 't', parentTree: 'p' });

describe('recordRef', () => {
  it('answers default with no key', () => {
    expect(recordRef('', 'main', true)).toEqual({ kind: 'default', ref: MAIN });
  });
  it('answers default while the state ref is absent', () => {
    expect(recordRef('plot/state', 'main', false).kind).toBe('default');
  });
  it('answers state when the key resolves and the ref exists', () => {
    expect(recordRef('plot/state', 'main', true)).toMatchObject({ kind: 'state', ref: STATE, defaultRef: MAIN, isBranch: true });
  });
  it('answers default for a key that is not a ref name', () => {
    expect(recordRef('bad..name', 'main', true).kind).toBe('default');
  });
  it('names no track ref for an empty key', () => {
    expect(stateTrackRef('', 'main')).toBeNull();
    expect(stateTrackRef('plot/state', 'main')).toBe(STATE);
  });
});

describe('unionBlobs', () => {
  it('lets the state entry win and keeps default-only paths', () => {
    const merged = unionBlobs(
      [blob('docs/plans/a.md', 'state-a')],
      [blob('docs/plans/a.md', 'main-a'), blob('docs/plans/b.md', 'main-b')],
    );
    expect(merged.map((b) => `${b.path}=${b.sha}`)).toEqual(['docs/plans/a.md=state-a', 'docs/plans/b.md=main-b']);
  });
});

describe('lagLine', () => {
  it('reads none for the sync PR and 0 ahead for equal refs', () => {
    expect(lagLine(0, null, 'main').text).toBe('Records: 0 ahead of main · sync PR: none');
  });
  it('names the open sync PR', () => {
    expect(lagLine(3, 42, 'main').text).toBe('Records: 3 ahead of main · sync PR: #42');
  });
});

describe('removedKeyFinding', () => {
  it('is null while a key is declared, the branch is level, or the count is unknown', () => {
    expect(removedKeyFinding('plot/state', 'main', 4)).toBeNull();
    expect(removedKeyFinding('', 'main', 0)).toBeNull();
    expect(removedKeyFinding('', 'main', null)).toBeNull();
  });
  it('names the branch and the fix in order', () => {
    const found = removedKeyFinding('', 'main', 2);
    expect(found?.fix[0]).toMatch(/^merge the sync PR/);
    expect(found?.fix[1]).toMatch(/^then remove the State branch key/);
    expect(found?.text).toContain('plot/state is 2 ahead of main');
  });
});

describe('linkTarget', () => {
  it('resolves a relative target against the link directory', () => {
    expect(linkTarget('docs/plans/active/g.md', '../2026-01-01-g.md')).toBe('docs/plans/2026-01-01-g.md');
  });
  it('refuses an absolute target and one that leaves the repository', () => {
    expect(linkTarget('a/b.md', '/etc/passwd')).toBeNull();
    expect(linkTarget('a/b.md', '../../x.md')).toBeNull();
    expect(linkTarget('docs/a/g.md', './../x//y.md')).toBe('docs/x/y.md');
  });
});

describe('listRecordBlobs', () => {
  const trees = {
    sha1: [blob('docs/plans/a.md', 'main-a'), blob('docs/plans/b.md', 'main-b')],
    [STATE]: [blob('docs/plans/a.md', 'state-a')],
  };
  it('lists the default branch alone with no key', async () => {
    const refs = refsFixture({ trees, shas: { [`${STATE}^{commit}`]: 's' } });
    const listed = await listRecordBlobs(refs, { stateBranch: '', defaultBranch: 'main' }, 'sha1', 'docs/plans/');
    expect(listed.ok && listed.value.map((b) => b.sha)).toEqual(['main-a', 'main-b']);
  });
  it('lists the default branch alone while the state ref is absent', async () => {
    const refs = refsFixture({ trees });
    const listed = await listRecordBlobs(refs, source, 'sha1', 'docs/plans/');
    expect(listed.ok && listed.value.map((b) => b.sha)).toEqual(['main-a', 'main-b']);
  });
  it('fails where the default branch cannot be listed', async () => {
    const refs = { ...refsFixture({ trees }), listBlobs: async () => failed<never>() };
    expect((await listRecordBlobs(refs, source, 'sha1', 'docs/plans/')).ok).toBe(false);
  });
  it('keeps the default listing when the state listing cannot be read', async () => {
    const base = refsFixture({ trees, shas: { [`${STATE}^{commit}`]: 's' } });
    const refs = { ...base, listBlobs: async (ref: string, dir: string) => (ref === STATE ? failed<never>() : base.listBlobs(ref, dir)) };
    const listed = await listRecordBlobs(refs, source, 'sha1', 'docs/plans/');
    expect(listed.ok && listed.value.map((b) => b.sha)).toEqual(['main-a', 'main-b']);
  });
  it('unites both refs with the state entry winning', async () => {
    const refs = refsFixture({ trees, shas: { [`${STATE}^{commit}`]: 's' } });
    const listed = await listRecordBlobs(refs, source, 'sha1', 'docs/plans/');
    expect(listed.ok && listed.value.map((b) => b.sha)).toEqual(['state-a', 'main-b']);
  });
});

describe('readRefFor', () => {
  const files = { [`${STATE}:docs/plans/a.md`]: 'x', [`${MAIN}:docs/plans/b.md`]: 'y' };
  it('reads origin/<default> with no key', async () => {
    expect(await readRefFor(refsFixture({ files }), { stateBranch: '', defaultBranch: 'main' }, 'docs/plans/a.md')).toBe('origin/main');
  });
  it('reads the state ref for a path it holds, and the default branch otherwise', async () => {
    const refs = refsFixture({ files, shas: { [`${STATE}^{commit}`]: 's' } });
    expect(await readRefFor(refs, source, 'docs/plans/a.md')).toBe(STATE);
    expect(await readRefFor(refs, source, 'docs/plans/b.md')).toBe('origin/main');
    expect(await readRefFor(refs, source)).toBe(STATE);
  });
});

describe('recordsAhead and readRecordFindings', () => {
  const range = `${MAIN}..${STATE}`;
  const shas = { [`${STATE}^{commit}`]: 's' };
  it('counts the commits the state ref holds beyond the default branch', async () => {
    const refs = refsFixture({ shas, commitSubjects: { [range]: [commit('a'), commit('b')] } });
    expect(await recordsAhead(refs, source)).toBe(2);
    expect((await readRecordFindings(refs, source)).recordLag?.text).toBe('Records: 2 ahead of main · sync PR: none');
  });
  it('reads 0 ahead for equal refs and null where the count fails', async () => {
    expect(await recordsAhead(refsFixture({ shas }), source)).toBe(0);
    expect(await recordsAhead(refsFixture({ shas, failing: ['commitSubjects'] }), source)).toBeNull();
    expect((await readRecordFindings(refsFixture({ shas, failing: ['commitSubjects'] }), source)).recordLag).toBeNull();
  });
  it('reports no lag line and no finding with no key and no state branch', async () => {
    expect(await readRecordFindings(refsFixture({}), { stateBranch: '', defaultBranch: 'main' })).toEqual({ recordLag: null, recordKeyRemoved: null });
  });
  it('reports a stranded plot/state when the key is gone', async () => {
    const refs = refsFixture({ shas, commitSubjects: { [range]: [commit('a')] } });
    const found = await readRecordFindings(refs, { stateBranch: '', defaultBranch: 'main' });
    expect(found.recordLag).toBeNull();
    expect(found.recordKeyRemoved?.ahead).toBe(1);
  });
  it('resolves the state ref locally and never asks the network', async () => {
    expect((await resolveRecordRef(refsFixture({ shas }), source)).kind).toBe('state');
  });
});

describe('derefRecord', () => {
  const trees = {
    r: [
      blob('docs/plans/active/g.md', 'l1', '120000'),
      blob('docs/plans/2026-01-01-g.md', 'p1'),
      blob('docs/plans/active/loop.md', 'l2', '120000'),
    ],
  };
  const files = { 'r:docs/plans/active/g.md': '../2026-01-01-g.md\n', 'r:docs/plans/active/loop.md': 'loop.md' };
  it('follows a symlink to the plan', async () => {
    expect(await derefRecord(refsFixture({ trees, files }), 'r', 'docs/plans/active/g.md')).toBe('docs/plans/2026-01-01-g.md');
  });
  it('returns a regular path unchanged', async () => {
    expect(await derefRecord(refsFixture({ trees, files }), 'r', 'docs/plans/2026-01-01-g.md')).toBe('docs/plans/2026-01-01-g.md');
  });
  it('refuses a cycle', async () => {
    expect(await derefRecord(refsFixture({ trees, files }), 'r', 'docs/plans/active/loop.md')).toBeNull();
  });
  it('returns null where the listing cannot be read', async () => {
    const refs = { ...refsFixture({ trees, files }), listBlobs: async () => failed<never>() };
    expect(await derefRecord(refs, 'r', 'docs/plans/active/g.md')).toBeNull();
  });
  it('returns null where a link cannot be read', async () => {
    const lone = { r: [blob('docs/plans/active/x.md', 'l3', '120000')] };
    expect(await derefRecord(refsFixture({ trees: lone }), 'r', 'docs/plans/active/x.md')).toBeNull();
  });
  it('returns null where a link is absolute', async () => {
    const lone = { r: [blob('docs/plans/active/x.md', 'l3', '120000')] };
    const abs = { 'r:docs/plans/active/x.md': '/etc/passwd' };
    expect(await derefRecord(refsFixture({ trees: lone, files: abs }), 'r', 'docs/plans/active/x.md')).toBeNull();
  });
});
