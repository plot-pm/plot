import { describe, it, expect } from 'vitest';
import { planStoreRef } from '../src/adapters/plan-store/plan-store-ref.js';
import { refsFixture } from '../src/adapters/refs/refs-fixture.js';
import { shellContext } from '../src/adapters/scripts.js';
import { isAnswered } from '../src/port-result.js';
import { failed } from '../src/port-result.js';
import type { Refs, TreeBlob } from '../src/ports/refs.js';

const REPO_ROOT = new URL('../../..', import.meta.url).pathname;

const PLAN_TEXT = [
  '# A plan',
  '',
  '## Status',
  '',
  '- **State:** Approved',
  '',
  '## Slices',
  '',
  '### Only slice',
  '',
  '- `feature/alpha` — the work',
  '',
].join('\n');

describe('planStoreRef — listPlans filters the tree listing to regular plan files', () => {
  it('excludes a symlink-mode blob, even when its path ends in .md', async () => {
    const refs = refsFixture({
      shas: { 'origin/main': 'deadbeef' },
      trees: {
        'origin/main': [
          { mode: '100644', sha: 'sha-real', path: 'docs/plans/2026-10-26-a-plan.md' },
          { mode: '120000', sha: 'sha-link', path: 'docs/plans/active/2026-10-26-a-plan.md' },
        ],
      },
      blobs: { 'sha-real': PLAN_TEXT },
    });

    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    const files = await store.listPlans();
    if (!isAnswered(files)) throw new Error('listPlans should answer');
    expect(files.value).toEqual(['docs/plans/2026-10-26-a-plan.md']);
  });

  it('fails, and does not answer an empty list, for an unreadable ref', async () => {
    // A ref whose tree cannot be listed is NOT a repository with no plans: an
    // empty answer would make the board drop every plan when one fetch glitches.
    const refs: Refs = { ...refsFixture({}), listBlobs: async () => failed<readonly TreeBlob[]>() };

    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    expect((await store.listPlans()).ok).toBe(false);
    expect((await store.readPlans(['docs/plans/2026-10-26-a-plan.md'])).ok).toBe(false);
  });

  it('answers an empty list, not an error, for a readable ref with zero plan files', async () => {
    const refs = refsFixture({
      shas: { 'origin/main': 'deadbeef' },
      trees: { 'origin/main': [] },
    });

    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    const files = await store.listPlans();
    if (!isAnswered(files)) throw new Error('listPlans should answer');
    expect(files.value).toEqual([]);
  });
});

describe('planStoreRef — readPlans parses ref-read content through the real parser', () => {
  it('reads the staged blob content back into a PlanRecord naming the slice branch', async () => {
    const refs = refsFixture({
      shas: { 'origin/main': 'deadbeef' },
      trees: {
        'origin/main': [{ mode: '100644', sha: 'sha-real', path: 'docs/plans/2026-10-26-a-plan.md' }],
      },
      blobs: { 'sha-real': PLAN_TEXT },
    });

    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    const records = await store.readPlans(['docs/plans/2026-10-26-a-plan.md']);
    if (!isAnswered(records)) throw new Error('readPlans should answer');
    expect(records.value).toHaveLength(1);
    expect(records.value[0]!.file).toBe('docs/plans/2026-10-26-a-plan.md');
    expect(records.value[0]!.slices[0]!.branches[0]!.branch).toBe('feature/alpha');
  });

  it('calls readBlobs exactly once across more than one plan file in one round-trip', async () => {
    let calls = 0;
    const base = refsFixture({
      shas: { 'origin/main': 'deadbeef' },
      trees: {
        'origin/main': [
          { mode: '100644', sha: 'sha-one', path: 'docs/plans/2026-10-26-one.md' },
          { mode: '100644', sha: 'sha-two', path: 'docs/plans/2026-10-26-two.md' },
        ],
      },
      blobs: { 'sha-one': PLAN_TEXT, 'sha-two': PLAN_TEXT },
    });
    const refs: Refs = {
      ...base,
      readBlobs: (shas) => {
        calls += 1;
        return base.readBlobs(shas);
      },
    };

    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    const files = await store.listPlans();
    if (!isAnswered(files)) throw new Error('listPlans should answer');
    const records = await store.readPlans(files.value);
    if (!isAnswered(records)) throw new Error('readPlans should answer');
    expect(records.value).toHaveLength(2);
    expect(calls).toBe(1);
  });
});

const WIP_PLAN = PLAN_TEXT.replace('feature/alpha', 'wip/alpha');

describe('planStoreRef — readPlansAt reads by object name and passes the configured prefixes', () => {
  const blobsOf = (refs: Refs) => planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');

  it('parses with --prefixes: a non-default list changes the parse the default list gives', async () => {
    // The default list `idea|feature|bug|docs|infra` does not name `wip/`, so a
    // call that omits the flag reads this plan with no branch. A repository on
    // the default list cannot tell the two apart, which is why this fixture
    // does not use it.
    const refs = refsFixture({ blobs: { 'sha-wip': WIP_PLAN } });
    const blob = { sha: 'sha-wip', path: 'docs/plans/2026-10-26-wip.md' };

    const flagged = await blobsOf(refs).readPlansAt([blob], ['wip', 'spike']);
    const unflagged = await blobsOf(refs).readPlansAt([blob], []);
    if (!isAnswered(flagged) || !isAnswered(unflagged)) throw new Error('both should answer');
    expect(flagged.value[0]!.branches).toEqual(['wip/alpha']);
    expect(unflagged.value[0]!.branches).toEqual([]);
  });

  it('reads the object names it is given and lists no tree', async () => {
    // The tree under `origin/main` holds a DIFFERENT blob at the same path, as a
    // fetch landing after the caller's snapshot would. A read keyed by ref name
    // parses that one; a read keyed by object name parses the handed-in one.
    const base = refsFixture({
      shas: { 'origin/main': 'newer' },
      trees: { 'origin/main': [{ mode: '100644', sha: 'sha-newer', path: 'docs/plans/2026-10-26-a.md' }] },
      blobs: { 'sha-snapshot': PLAN_TEXT, 'sha-newer': PLAN_TEXT.replace('feature/alpha', 'feature/newer') },
    });
    let listed = 0;
    const refs: Refs = {
      ...base,
      listBlobs: (ref, dir) => {
        listed += 1;
        return base.listBlobs(ref, dir);
      },
    };

    const records = await blobsOf(refs).readPlansAt(
      [{ sha: 'sha-snapshot', path: 'docs/plans/2026-10-26-a.md' }],
      [],
    );
    if (!isAnswered(records)) throw new Error('readPlansAt should answer');
    expect(records.value[0]!.branches).toEqual(['feature/alpha']);
    expect(listed).toBe(0);
  });

  it('fails when an object name cannot be read, rather than answering a smaller estate', async () => {
    const refs = refsFixture({ blobs: { 'sha-a': PLAN_TEXT } });
    const records = await blobsOf(refs).readPlansAt(
      [
        { sha: 'sha-a', path: 'docs/plans/a.md' },
        { sha: 'sha-gone', path: 'docs/plans/b.md' },
      ],
      [],
    );
    expect(records.ok).toBe(false);
  });
});
