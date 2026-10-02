import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';
import { refreshPrs, freshCacheEntry, type CacheEntry } from '../../src/server/fleet.js';
import { prIndexFile } from '@plot-pm/domain/adapters';
import { foldPrIndex } from '@plot-pm/domain';

// THE SUBJECT: `fleet.ts` used to hold ONE module-level PR store, built with no
// `cwd`, so every repository a process read shared the store of wherever the
// process started — `packages/board` in this suite's own case. A fleet entry
// now resolves its store from its OWN `repoRoot`, through `prStoreFor`.
//
// Every fixture here is a REAL repository (`git init`), because the subject is
// which file `prIndexFile({ cwd })` resolves to, and that resolution shells out
// to `git rev-parse --git-common-dir`. A bare directory answers nothing.

const temps: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of temps.splice(0)) rmTree(d);
});

/**
 * A fake `plot-host.sh` that REFUSES the `pr-list` call.
 *
 * Not a quiet exit-0 success: an empty answer is a WHOLE read of zero rows,
 * which would overwrite the seeded map the same way a real empty estate does.
 * The assertion here is about the SEED landing before any host call completes,
 * so the host must refuse rather than answer, exactly as `pr-store.test.ts`'s
 * `seeds a restarted process with the stored author` does.
 */
const refusingScripts = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-pr-repo-scripts-'));
  fs.writeFileSync(
    path.join(dir, 'plot-host.sh'),
    '#!/usr/bin/env bash\nprintf \'%s\\n\' "the host is unreachable" >&2\nexit 3\n',
  );
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  temps.push(dir);
  return dir;
};

/** A real repository, so `--git-common-dir` resolves inside it rather than failing. */
const fixtureRepo = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-pr-repo-'));
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  temps.push(dir);
  return dir;
};

/** Writes one OPEN row into `repoRoot`'s own store, in the v2 (current) format. */
const seedStore = async (repoRoot: string, row: { number: number; head: string }): Promise<void> => {
  const store = prIndexFile({ cwd: repoRoot });
  const folded = foldPrIndex(null, {
    connector: 'github',
    rows: [{
      number: row.number, head: row.head, state: 'OPEN', draft: false,
      checks: 'green', review: '', url: '',
    }],
    kind: 'whole',
    at: new Date().toISOString(),
  });
  await store.write('github', folded);
};

const refresh = async (repoRoot: string, scriptsDir: string): Promise<CacheEntry> => {
  const entry = freshCacheEntry();
  entry.backend = 'github';
  await refreshPrs({ repoRoot, scriptsDir }, entry);
  return entry;
};

describe('a fleet entry reads its own repository\'s PR store', () => {
  it('seeds the fleet\'s PR map from the fixture repository\'s own store', async () => {
    // `PLOT_PR_INDEX_HOME` REMOVED, deliberately: the done-when's point is that
    // the repository is resolved from `repoRoot` rather than from the
    // environment seam `pr-store.test.ts` uses everywhere else.
    vi.stubEnv('PLOT_PR_INDEX_HOME', '');
    const repo = fixtureRepo();
    await seedStore(repo, { number: 1, head: 'feature/one' });

    const entry = await refresh(repo, refusingScripts());
    expect(entry.prsByNumber?.get(1)?.head).toBe('feature/one');
  });

  it('keeps PLOT_PR_INDEX_HOME in priority over the fixture\'s own store', async () => {
    const repo = fixtureRepo();
    await seedStore(repo, { number: 1, head: 'feature/one' });

    // A DIFFERENT store, named by the environment variable, holding a
    // DIFFERENT row. If the fixture's own store won, the map would hold
    // number 1; if the seam still wins as documented, it holds number 2.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-pr-repo-home-'));
    temps.push(home);
    vi.stubEnv('PLOT_PR_INDEX_HOME', home);
    await seedStore(home, { number: 2, head: 'feature/two' });

    const entry = await refresh(repo, refusingScripts());
    expect(entry.prsByNumber?.get(2)?.head).toBe('feature/two');
    expect(entry.prsByNumber?.has(1)).toBe(false);
  });

  it('gives two repositories in one process two separate maps', async () => {
    // THE DONE-WHEN THAT A SINGLE-REPOSITORY CASE CANNOT CATCH: a module-level
    // store keyed wrongly (or not keyed at all) passes the case above and fails
    // this one, because both fleets would share one file.
    vi.stubEnv('PLOT_PR_INDEX_HOME', '');
    const repoA = fixtureRepo();
    const repoB = fixtureRepo();
    await seedStore(repoA, { number: 1, head: 'feature/a' });
    await seedStore(repoB, { number: 2, head: 'feature/b' });

    const scripts = refusingScripts();
    const [entryA, entryB] = await Promise.all([
      refresh(repoA, scripts),
      refresh(repoB, scripts),
    ]);

    expect(entryA.prsByNumber?.get(1)?.head).toBe('feature/a');
    expect(entryA.prsByNumber?.has(2)).toBe(false);
    expect(entryB.prsByNumber?.get(2)?.head).toBe('feature/b');
    expect(entryB.prsByNumber?.has(1)).toBe(false);
  });
});
