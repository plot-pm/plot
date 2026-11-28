// The release scope's tag arm through every reader, against one real
// repository. The host throws on any call: the tag arm reads local git only.
// Run with `env -u PLOT_UNATTENDED`: the finish's push script reads the env.
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import type { Host } from '@plot-pm/domain';
import { tagEstate, throwingHost, V110_BOOKED } from '../../../fleet/test/release-tag-estate.js';
import { finishReleaseVersion, type FinishContext } from '../../src/server/entry/release-finish.js';
import { readUnbooked } from '../../src/server/entry/release-unbooked.js';
import { ownUnbookedRead } from '../../src/server/release-unbooked-reading.js';
import type { BuildBoardOptions } from '../../src/server/board.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const noWait = async (): Promise<void> => {};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const finishContext = (repo: string): FinishContext => {
  const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
  const real = scriptsShell(context);
  const scripts = {
    ...real,
    awaited: async (script: string, args: readonly string[], options?: unknown) =>
      script === 'plot-issue-status.sh' || script === 'plot-plan-state.sh'
        ? { stdout: 'summary: tracker=none\n', stderr: '', code: 0 }
        : real.awaited(script, args, options as never),
  };
  return {
    repoRoot: repo,
    refs: refsGit(context),
    host: throwingHost<Host>(),
    planStore: planStoreShell(context),
    scripts: scripts as FinishContext['scripts'],
    trees: treesGit(context),
    scriptDir: SCRIPT_DIR,
    caller: 'person',
    tagWaitMs: 0,
    pollMs: 1,
    sleep: noWait,
    retryWait: noWait,
  };
};

const finish = async (repo: string, version: string) => {
  const out: string[] = [];
  const outcome = await finishReleaseVersion(finishContext(repo), version, (s) => out.push(s), (s) => out.push(s));
  return { outcome, out: out.join('') };
};

const slugsOf = (answer: unknown): readonly string[] =>
  typeof answer === 'object' && answer !== null ? (answer as { plans: readonly string[] }).plans : [];

describe('the tag arm through the finish and both unbooked readers', () => {
  it('answers the same slugs from every reader, with no host call', async () => {
    const { repo } = tagEstate(roots);
    const own = await ownUnbookedRead({ repoRoot: repo, scriptsDir: SCRIPT_DIR } as BuildBoardOptions);
    const entry = await readUnbooked({ repoRoot: repo, scriptDir: SCRIPT_DIR }, 'main');
    const { outcome, out } = await finish(repo, '1.1.0');

    expect(slugsOf(own)).toEqual(V110_BOOKED);
    expect(slugsOf(entry.answer)).toEqual(V110_BOOKED);
    expect(outcome).toMatchObject({ outcome: 'booked', version: 'v1.1.0', booked: V110_BOOKED });
    expect(out).toContain('booked: g (changeset), a (tag), d (tag), h (tag), k (tag).');
    expect(out).toContain('in the tag and not booked: b (slice-after-tag)');
    expect(out).toContain('c (no-merge-subject)');
    expect(out).toContain('f (no-merge-subject)');
    expect(out).toContain('not in the tag, not booked: e.');
  });

  it('books the plan whose second slice merged after v1.1.0 in v1.2.0', async () => {
    const estate = tagEstate(roots);
    expect((await finish(estate.repo, '1.1.0')).outcome).toMatchObject({ outcome: 'booked' });
    estate.shipNext();

    const { outcome } = await finish(estate.repo, '1.2.0');

    expect(outcome).toMatchObject({ outcome: 'booked', version: 'v1.2.0', booked: ['b'] });
  });
});
