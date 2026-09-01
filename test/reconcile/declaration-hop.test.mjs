// ONE DECLARATION PER BRANCH, NOT ONE PER WORKER — asserted by making a real
// worker hop and counting the files it left.
//
// This is the case the whole slice turns on, and it is this plan's own failure
// reproduced one level up. A worker HOPS: `plot-worker-loop.sh` asks `--next`
// for another branch of the same plan and *"the `session` and `pid` stay
// fixed"* while `wavesCount` increments, so one worker may finish branches A
// and B before dying on C. A single end-of-life declaration would then be
// ABSENT, and A and B — genuinely finished — would read as incomplete.
//
// SO THE HOP IS PERFORMED, NOT MOCKED. The loop runs against a bare origin and
// a two-wave plan whose second wave is BLOCKED until the first lands; the
// fixture agent lands its slice, which is what makes `--next` answer between
// the two runs. Nothing here reads the loop's source: the evidence is two files
// in two different worktrees, each naming its own branch.
//
// THE LANDING IS A MERGE COMMIT, not a fast-forward. Pushing the branch tip
// straight onto main leaves branch and main at the SAME oid, which the scan
// reads as `open` — deliberately, since "reset to main" and "merged" are
// indistinguishable by ancestry. A fast-forward fixture never opens wave 2, and
// the worker never hops, which reads exactly like the hop being broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const loop = path.join(scripts, 'plot-worker-loop.sh');
const scan = path.join(scripts, 'plot-fleet-scan.sh');

const DECLARATION = '.plot-worker.envelope.json';

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A bare origin, a clone, and an approved two-wave plan: `feature/seam` gates
 * `feature/api`.
 *
 * The gating is the point. `feature/api` is blocked until the seam merges, so
 * the worker's `--next` can only answer once its first slice landed — and a
 * plan whose second branch was eligible from the start would let the worker
 * "hop" onto work that was never gated, proving nothing.
 */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-declhop-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, work);
  git(work, 'config', 'user.email', 'test@example.invalid');
  git(work, 'config', 'user.name', 'Plot Test');
  git(work, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(work, 'CLAUDE.md'), `# Fixture project

## Plot Config

- **Plan directory:** docs/plans/
- **Active index:** docs/plans/active/
- **Worker bound:** 600
`);
  fs.mkdirSync(path.join(work, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(work, 'docs', 'plans', '2026-08-31-hopdecl.md'), `# Hop declaration

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Branches

### Tracer
- \`feature/seam\` — thin slice

### Implementation
- \`feature/api\` — blocked behind the seam
`);
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'plan');
  git(work, 'push', '-q', 'origin', 'main');
  return { root, origin, work };
}

/**
 * Claim the first branch the way the dispatcher does — an empty commit pushed
 * as a ref — and hand the worker a desk to sit at.
 */
function claim(sb, branch) {
  const wtRoot = path.join(sb.root, 'worktrees');
  fs.mkdirSync(wtRoot, { recursive: true });
  const wt = path.join(wtRoot, `plot-wt-${branch.replace(/\//g, '-')}`);
  git(sb.work, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
  git(wt, 'push', '-qu', 'origin', branch);
  return { wt, wtRoot };
}

/**
 * The fixture agent: it commits, pushes, and LANDS its slice as a merge commit
 * — which is what opens the second wave between the loop's two `--next` calls.
 * It declares nothing itself, so what appears on each desk is the loop's own
 * write and not an echo of the prompt.
 */
const prompt = (work) => `set -e
echo "$PLOT_BRANCH" > "$PLOT_WORKTREE/work-\${PLOT_BRANCH##*/}.txt"
git -C "$PLOT_WORKTREE" add -A
git -C "$PLOT_WORKTREE" commit -qm "work on $PLOT_BRANCH"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
git -C ${work} fetch -q origin
git -C ${work} merge -q --no-ff -m "Merge $PLOT_BRANCH" "origin/$PLOT_BRANCH"
git -C ${work} push -q origin main
`;

test('declaration: one hopping worker leaves one declaration per branch', () => {
  const sb = sandbox();
  try {
    const { wt, wtRoot } = claim(sb, 'feature/seam');

    // PRECONDITION, and the trap this fixture exists to avoid: wave 2 must be
    // blocked, or the hop is over work that was never gated.
    const before = execFileSync('bash', [scan, '--offline', 'hopdecl'],
      { encoding: 'utf8', cwd: sb.work });
    assert.match(before, /Implementation — blocked/,
      'precondition: the second wave must be blocked, or the hop proves nothing');

    fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'), prompt(sb.work));

    execFileSync('bash', [loop], {
      cwd: wt,
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        PLOT_BRANCH: 'feature/seam',
        PLOT_WORKTREE: wt,
        PLOT_SLUG: 'hopdecl',
        PLOT_MANIFEST_FILE: '',
      },
    });

    // THE HOP HAPPENED: the second desk exists, and only the hop creates it.
    const second = path.join(wtRoot, 'plot-wt-feature-api');
    assert.ok(fs.existsSync(second),
      'precondition: the worker must have hopped, or there is one desk to count');

    // TWO BRANCHES, TWO DECLARATIONS. A single end-of-life write would leave
    // the first desk silent, and the branch it genuinely finished would read as
    // incomplete — which is the failure this slice exists to fix.
    const first = JSON.parse(fs.readFileSync(path.join(wt, DECLARATION), 'utf8'));
    const later = JSON.parse(fs.readFileSync(path.join(second, DECLARATION), 'utf8'));
    assert.equal(first.branch, 'feature/seam',
      'the first desk declares the branch it finished, not the one the worker moved to');
    assert.equal(later.branch, 'feature/api', 'the second desk declares its own branch');
    assert.equal(first.status, 'ok');
    assert.equal(later.status, 'ok');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
