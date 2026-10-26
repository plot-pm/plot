import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { gatherReadingsAndRelease } from '../../src/shared/release-claim-reader.js';

// A REPO WITH NO MATCHING BRANCH AND NO MANIFEST: `releaseClaim` answers
// `hadClaim: false` and returns before `claimReleaseShell` ever runs, so the
// only host calls in play are `prReading`'s own `prState`/`prMerged` — the
// ones `tally` is being checked against here.
const repoWithStubbedHost = (prStateBody: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'release-claim-reader-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(
    join(dir, 'plot-host.sh'),
    `#!/usr/bin/env bash\ncase "$1" in\n  pr-state) ${prStateBody} ;;\n  pr-merged) echo not-merged; exit 0 ;;\nesac\n`,
  );
  chmodSync(join(dir, 'plot-host.sh'), 0o755);
  return dir;
};

describe('gatherReadingsAndRelease counts the host calls prReading makes', () => {
  it('adds 2 to tally when prState answers — one for prState, one for the prMerged it then asks', async () => {
    const dir = repoWithStubbedHost('echo \'{"state":"NONE"}\'; exit 0');
    try {
      const tally = { calls: 0 };
      await gatherReadingsAndRelease('feature/untracked', { repoRoot: dir, scriptDir: dir }, tally);
      expect(tally.calls).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds 1 to tally when prState does not answer, asking prMerged nothing', async () => {
    const dir = repoWithStubbedHost('exit 1');
    try {
      const tally = { calls: 0 };
      await gatherReadingsAndRelease('feature/untracked', { repoRoot: dir, scriptDir: dir }, tally);
      expect(tally.calls).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults to a no-op tally where the caller tracks none, the board\'s own callers', async () => {
    const dir = repoWithStubbedHost('echo \'{"state":"NONE"}\'; exit 0');
    try {
      const { result } = await gatherReadingsAndRelease('feature/untracked', { repoRoot: dir, scriptDir: dir });
      expect(result.released).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
