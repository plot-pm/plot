import { describe, it, expect } from 'vitest';
import { planStoreRef } from '../src/adapters/plan-store/plan-store-ref.js';
import { refsFixture } from '../src/adapters/refs/refs-fixture.js';
import { shellContext } from '../src/adapters/scripts.js';
import { isAnswered } from '../src/port-result.js';
import type { Refs } from '../src/ports/refs.js';

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

  it('answers an empty list, not an error, for an unreadable ref', async () => {
    // `origin/main` is absent from `trees`: `refsFixture.listBlobs` answers `[]`
    // for it, the same reading an unresolvable ref gives through the real
    // adapter's `git ls-tree` failing outright (`planBlobs`'s `!listing.ok`
    // branch folds both into one empty-list answer).
    const refs = refsFixture({});

    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    const files = await store.listPlans();
    if (!isAnswered(files)) throw new Error('listPlans should answer, not fail, on an unreadable ref');
    expect(files.value).toEqual([]);

    const records = await store.readPlans(['docs/plans/2026-10-26-a-plan.md']);
    if (!isAnswered(records)) throw new Error('readPlans should answer, not fail, on an unreadable ref');
    expect(records.value).toEqual([]);
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
