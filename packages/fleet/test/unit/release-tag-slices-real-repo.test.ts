// The tag reading against a real repository: merge subjects, a sprint branch
// carried into the tag, a squash merge, and a `→ commit` slice. No host exists.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { planStoreRef } from '@plot-pm/domain/adapters/plan-store/plan-store-ref';
import { releaseUnbooked } from '@plot-pm/domain/rules/release-unbooked';
import { removeTree } from '../rm-tree.mjs';
import { releaseUnbookedReadingsFor } from '../../src/shared/release-world.js';
import { tagEstate, V110_BOOKED } from '../release-tag-estate.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

const readings = async (repo: string) => {
  const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
  const refs = refsGit(context);
  return releaseUnbookedReadingsFor({ refs, plans: planStoreRef(refs, context, 'origin/main', 'docs/plans'), ref: 'origin/main', sprintDir: 'docs/sprints/' });
};

const owed = (answer: ReturnType<typeof releaseUnbooked>): readonly string[] => (typeof answer === 'object' ? answer.plans : []);

describe('the tag reading over a real repository', () => {
  it('books the changeset plan and the plans whose slices first shipped in v1.1.0', async () => {
    const { repo } = tagEstate(roots);
    const r = await readings(repo);
    expect(r.tag).toMatchObject({ tag: 'v1.1.0' });
    expect(owed(releaseUnbooked(r))).toEqual(V110_BOOKED);
  });

  it('reads a sprint merge carried into the tag, and names no merge for a squash or a prose reference', async () => {
    const { repo } = tagEstate(roots);
    const slices = (await readings(repo)).tagSlices;
    if (slices === 'unaskable') throw new Error('unaskable');
    expect(slices.get('d')?.merges.map((m) => m.containingTags[0])).toEqual(['v1.1.0']);
    expect(slices.get('f')?.merges.map((m) => m.mergeCommit)).toEqual(['']);
    expect(slices.get('c')?.references).toEqual([{ reference: null, deferred: false }]);
    expect(slices.get('b')?.merges.map((m) => m.containingTags)).toEqual([['v1.1.0'], []]);
    expect(slices.get('k')?.merges.map((m) => m.number)).toEqual([0]);
  });

  it('books the plan with a slice after v1.1.0 in v1.2.0', async () => {
    const estate = tagEstate(roots);
    estate.shipNext();
    const answer = releaseUnbooked(await readings(estate.repo));
    expect(answer).toMatchObject({ version: 'v1.2.0' });
    expect(owed(answer)).toEqual(['b']);
  });
});
