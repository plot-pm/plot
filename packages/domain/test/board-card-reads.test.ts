import { describe, expect, it } from 'vitest';

import { planRecord } from '../src/adapters/plan-store/plan-store-fixture.js';
import { answered, failed, type PortResult } from '../src/port-result.js';
import type { PlanBlobRef, PlanStore } from '../src/ports/plan-store.js';
import type { BranchTip, Containment, Refs, TreeBlob } from '../src/ports/refs.js';
import { readBranchPlans, readDeliveredInputs, readSprints, readStories } from '../src/workflows/board-card-reads.js';

const MAIN = 'a'.repeat(40);
const EMPTY = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const md = (path: string, sha: string, mode = '100644'): TreeBlob => ({ path, sha, mode });

const refsOf = (over: {
  tips?: PortResult<readonly BranchTip[]>;
  trees?: Record<string, PortResult<readonly TreeBlob[]>>;
  blobs?: Record<string, string>;
  blobsFail?: boolean;
  contains?: PortResult<readonly Containment[]>;
  commits?: Record<string, PortResult<string | null>>;
}): Refs & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    branchTips: async () => over.tips ?? answered([]),
    listBlobs: async (ref: string, dir: string) => {
      asked.push(`list ${ref} ${dir}`);
      return over.trees?.[`${ref} ${dir}`] ?? failed();
    },
    readBlobs: async (shas: readonly string[]) =>
      over.blobsFail === true
        ? failed()
        : answered(new Map(shas.flatMap((sha) => (over.blobs?.[sha] === undefined ? [] : [[sha, over.blobs[sha]!] as const])))),
    containsMany: async () => over.contains ?? failed(),
    recordCommit: async (file: string) => over.commits?.[file] ?? failed(),
    resolve: async () => failed(),
  } as unknown as Refs & { asked: string[] };
};

const storeOf = (fail = false): PlanStore & { parsed: PlanBlobRef[][] } => {
  const parsed: PlanBlobRef[][] = [];
  return {
    parsed,
    readPlansAt: async (blobs: readonly PlanBlobRef[]) => {
      parsed.push([...blobs]);
      return fail ? failed() : answered(blobs.map(({ path }) => planRecord({ file: path, phase: 'draft' })));
    },
  } as unknown as PlanStore & { parsed: PlanBlobRef[][] };
};

const input = { mainBranch: 'main', mainSha: MAIN, planDir: 'docs/plans/', prefixes: ['idea', 'feature'], recordSource: { stateBranch: '', defaultBranch: 'main' } };

describe('readBranchPlans', () => {
  it('parses a Draft plan on a feature/ branch and a plan whose basename differs from its branch slug, through one parse', async () => {
    const refs = refsOf({
      tips: answered([
        { branch: 'feature/x', sha: 'b'.repeat(40) },
        { branch: 'idea/short', sha: 'c'.repeat(40) },
        { branch: 'feature/merged', sha: 'd'.repeat(40) },
        { branch: 'main', sha: MAIN },
      ]),
      contains: answered(['no', 'unknown', 'yes']),
      trees: {
        [`${MAIN} docs/plans/`]: answered([md('docs/plans/on-main.md', '1'.repeat(40))]),
        'origin/feature/x docs/plans/': answered([md('docs/plans/2026-01-01-x.md', '2'.repeat(40)), md('docs/plans/on-main.md', '1'.repeat(40)), md('docs/plans/empty.md', EMPTY)]),
        'origin/idea/short docs/plans/': answered([md('docs/plans/2026-01-02-a-longer-name.md', '3'.repeat(40))]),
      },
    });
    const store = storeOf();
    const read = await readBranchPlans(refs, store, input);
    expect(read.ok && read.value.map(({ branch, path, record }) => [branch, path, record.phase])).toEqual([
      ['feature/x', 'docs/plans/2026-01-01-x.md', 'draft'],
      ['idea/short', 'docs/plans/2026-01-02-a-longer-name.md', 'draft'],
    ]);
    expect(store.parsed).toHaveLength(1);
    expect(refs.asked).not.toContain('list origin/feature/merged docs/plans/');
  });

  it('reads every branch as not contained where containment fails, and skips a branch whose tree cannot be listed', async () => {
    const refs = refsOf({
      tips: answered([{ branch: 'feature/x', sha: 'b'.repeat(40) }, { branch: 'feature/gone', sha: 'c'.repeat(40) }]),
      trees: { [`${MAIN} docs/plans/`]: answered([]), 'origin/feature/x docs/plans/': answered([md('docs/plans/x.md', '2'.repeat(40))]) },
    });
    const read = await readBranchPlans(refs, storeOf(), input);
    expect(read.ok && read.value.map((p) => p.path)).toEqual(['docs/plans/x.md']);
  });

  it('lists a branch whose containment the answer leaves out, as not contained', async () => {
    const refs = refsOf({
      tips: answered([{ branch: 'feature/x', sha: 'b'.repeat(40) }, { branch: 'feature/y', sha: 'c'.repeat(40) }]),
      contains: answered(['no']),
      trees: {
        [`${MAIN} docs/plans/`]: answered([]),
        'origin/feature/x docs/plans/': answered([md('docs/plans/x.md', '2'.repeat(40))]),
        'origin/feature/y docs/plans/': answered([md('docs/plans/y.md', '3'.repeat(40))]),
      },
    });
    const read = await readBranchPlans(refs, storeOf(), input);
    expect(read.ok && read.value.map((p) => p.path)).toEqual(['docs/plans/x.md', 'docs/plans/y.md']);
  });

  it('answers none with no prefix and none with no branch, and fails where a listing or the parse fails', async () => {
    expect(await readBranchPlans(refsOf({}), storeOf(), { ...input, prefixes: [] })).toEqual(answered([]));
    expect(await readBranchPlans(refsOf({ tips: answered([{ branch: 'main', sha: MAIN }]) }), storeOf(), input)).toEqual(answered([]));
    expect((await readBranchPlans(refsOf({ tips: failed() }), storeOf(), input)).ok).toBe(false);
    const tips = answered([{ branch: 'feature/x', sha: 'b'.repeat(40) }]);
    expect((await readBranchPlans(refsOf({ tips }), storeOf(), input)).ok).toBe(false);
    const listed = refsOf({ tips, contains: answered(['no']), trees: { [`${MAIN} docs/plans/`]: answered([]), 'origin/feature/x docs/plans/': answered([md('docs/plans/x.md', '2'.repeat(40))]) } });
    expect((await readBranchPlans(listed, storeOf(true), input)).ok).toBe(false);
  });
});

describe('readDeliveredInputs', () => {
  const text = '# P\n\n## Verification\n\n- Claim-1 supported — works — lens\n';
  const records = [
    { record: planRecord({ file: 'docs/plans/d.md', phase: 'delivered' }), sha: '1'.repeat(40) },
    { record: planRecord({ file: 'docs/plans/no-commit.md', phase: 'delivered' }), sha: '2'.repeat(40) },
    { record: planRecord({ file: 'docs/plans/no-text.md', phase: 'delivered' }), sha: '3'.repeat(40) },
    { record: planRecord({ file: 'docs/plans/a.md', phase: 'approved' }), sha: '4'.repeat(40) },
  ];

  it('carries the claim lines and delivery commit of each Delivered plan, and no plan text', async () => {
    const refs = refsOf({
      blobs: { ['1'.repeat(40)]: text, ['2'.repeat(40)]: text },
      commits: { 'docs/plans/d.md': answered('abc1234') },
    });
    const read = await readDeliveredInputs(refs, records, 'origin/main');
    expect(read).toEqual(answered({ 'docs/plans/d.md': { claimLines: ['- Claim-1 supported — works — lens'], deliveryCommit: 'abc1234' } }));
    expect(JSON.stringify(read)).not.toContain('# P');
  });

  it('answers none with no Delivered plan, and fails where the blobs cannot be read', async () => {
    expect(await readDeliveredInputs(refsOf({}), [records[3]!], 'origin/main')).toEqual(answered({}));
    expect((await readDeliveredInputs(refsOf({ blobsFail: true }), records, 'origin/main')).ok).toBe(false);
  });
});

describe('readSprints', () => {
  it('parses the sprint files under active/ and skips one that is not a sprint', async () => {
    const refs = refsOf({
      trees: {
        'origin/main docs/sprints/active': answered([
          md('docs/sprints/active/2026-W45-s.md', '1'.repeat(40)),
          md('docs/sprints/active/README.md', '2'.repeat(40)),
          md('docs/sprints/active/gone.md', '3'.repeat(40)),
        ]),
      },
      blobs: { ['1'.repeat(40)]: '## Status\n\n- **State:** Active\n', ['2'.repeat(40)]: '# Readme\n' },
    });
    const read = await readSprints(refs, 'origin/main', 'docs/sprints/');
    expect(read.ok && read.value.map(({ path, sprint }) => [path, sprint.slug, sprint.phase])).toEqual([['docs/sprints/active/2026-W45-s.md', 's', 'Active']]);
  });

  it('answers none for an empty directory, and fails where the listing or the blobs cannot be read', async () => {
    expect(await readSprints(refsOf({ trees: { 'origin/main docs/sprints/active': answered([]) } }), 'origin/main', 'docs/sprints')).toEqual(answered([]));
    expect((await readSprints(refsOf({}), 'origin/main', 'docs/sprints')).ok).toBe(false);
    const listed = { 'origin/main docs/sprints/active': answered([md('docs/sprints/active/s.md', '1'.repeat(40))]) };
    expect((await readSprints(refsOf({ trees: listed, blobsFail: true }), 'origin/main', 'docs/sprints')).ok).toBe(false);
  });
});

describe('readStories', () => {
  it('reads live and archived stories with the design documents beside each, first path per slug', async () => {
    const refs = refsOf({
      trees: {
        'origin/main docs/stories/': answered([
          md('docs/stories/s/STORY-s.md', '1'.repeat(40)),
          md('docs/stories/s/DESIGN-a.md', '2'.repeat(40)),
          md('docs/stories/again/STORY-s.md', '1'.repeat(40)),
          md('docs/stories/archived/old/STORY-old.md', '3'.repeat(40)),
          md('docs/stories/README.md', '4'.repeat(40)),
        ]),
      },
      blobs: { ['1'.repeat(40)]: '# S\n', ['2'.repeat(40)]: '# D\n', ['3'.repeat(40)]: '# Old\n', ['4'.repeat(40)]: '# R\n' },
    });
    const read = await readStories(refs, 'origin/main', 'docs/stories/', 'jira');
    if (!read.ok) throw new Error('expected a reading');
    expect(read.value.live.map((s) => [s.slug, s.path, s.designDocs])).toEqual([['s', 'docs/stories/s/STORY-s.md', ['DESIGN-a.md']]]);
    expect(read.value.archived.map((s) => [s.slug, s.title])).toEqual([['old', 'Old']]);
  });

  it('fails where the listing cannot be read', async () => {
    expect((await readStories(refsOf({}), 'origin/main', 'docs/stories/', 'jira')).ok).toBe(false);
  });
});
