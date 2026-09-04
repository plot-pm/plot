// ONE DECLARATION PER BRANCH, NOT ONE PER WORKER — asserted by making a real
// worker hop and reading what it declared on each side of the hop.
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
// fixture agent lands its slice, which is what makes the second one legitimate
// to hand over. Nothing here reads the loop's source.
//
// THE HAND-OVER IS THE REGISTRY'S, AND THE FIXTURE PLAYS IT. Since
// `the-registry-queues-a-brief` the agent asks for nothing — it reads the
// branch the registry wrote into its manifest. The scripts directory is copied
// and `plot-fleet-scan.sh` wrapped in a shim that writes that field once, at
// the moment the loop reaches its wait, which is where a daemon tick would find
// this agent free. The hop that follows is the proof the assignment was taken.
//
// THE EVIDENCE MOVED WHEN THE DESK STOPPED MOVING. Until
// `an-agent-decides-create-or-reset`, a hop cut a second worktree and the two
// declarations sat in two directories, so counting files proved the property.
// The agent now RESETS the desk it holds, so there is one directory and the
// window in which each declaration is readable is the one between its own seal
// and the next reset. A file count cannot see that; what this test asserts
// instead is the two facts a shared desk could break.
//
// FIRST, THE DESK IS REUSED. `plot-wt-feature-api` must not exist: the loop
// worked the second slice in the desk it already held. That is the whole
// deliverable, and the per-branch marker files the fixture agent writes are
// what prove both slices ran.
//
// SECOND, THE SECOND SLICE INHERITS NOTHING. `seal_declaration` merges into
// whatever file it finds — deliberately, so an agent's own `pr`, `artifacts`
// and `summary` survive Plot's write — so a desk still carrying the seam's
// declaration would hand `feature/api` the seam's PR number and call it its
// own. `reset_desk` removes the file as it takes the desk over; the fixture
// agent records what it finds at the START of each slice, and finding nothing
// on the second is what holds that removal in place.
//
// THAT A FINISHED BRANCH DECLARES AT ALL is asserted where it is not about
// hopping — `worker-loop: a finished branch leaves a declaration naming it` in
// workerloop.test.mjs. Repeating it here would need the reset suppressed, which
// is the behaviour under test.
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
const scan = path.join(scripts, 'plot-fleet-scan.sh');

/**
 * The scripts directory, copied, with `plot-fleet-scan.sh` wrapped in a shim
 * that hands over the next slice ONCE.
 *
 * IT IS THE REGISTRY, ACTING WHERE THE REGISTRY ACTS — the loop reaches this
 * script exactly once per free window, asking `--why-nothing` on the way into a
 * wait. Writing `branch` there is the whole of `agent-assign`: one field, no
 * second file.
 *
 * ONCE, because handing the same slice out twice is what `matchQueue` makes
 * unreachable and a fixture must not model a broken registry.
 *
 * THE COPY IS THE WHOLE DIRECTORY because `script_dir` is the loop's own
 * location and every helper resolves from it.
 */
function shimmedScripts(root, manifest, handOver) {
  const dir = path.join(root, 'scripts');
  fs.cpSync(scripts, dir, { recursive: true });
  const real = path.join(dir, 'plot-fleet-scan.real.sh');
  fs.renameSync(path.join(dir, 'plot-fleet-scan.sh'), real);
  const once = path.join(root, 'handed-over');
  fs.writeFileSync(path.join(dir, 'plot-fleet-scan.sh'), `#!/usr/bin/env bash
if [ -f ${JSON.stringify(manifest)} ] && [ ! -f ${JSON.stringify(once)} ]; then
  touch ${JSON.stringify(once)}
  node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    m.branch = process.argv[2];
    fs.writeFileSync(process.argv[1], JSON.stringify(m, null, 2) + "\\n");
  ' ${JSON.stringify(manifest)} ${JSON.stringify(handOver)}
fi
exec bash ${JSON.stringify(real)} "\$@"
`, { mode: 0o755 });
  return dir;
}

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
 * It declares nothing itself, so what appears on the desk is the loop's own
 * write and not an echo of the prompt.
 *
 * IT COPIES THE DECLARATION IT FINDS to `$log`, outside the desk, BEFORE doing
 * anything else. That copy is how the first slice's declaration survives the
 * second slice overwriting it, and it is taken from outside the worktree so the
 * desk it reads stays exactly the desk the loop manages. An empty copy on the
 * first slice is the honest answer: nothing had declared yet.
 */
const prompt = (work, log) => `set -e
if [ -f "$PLOT_WORKTREE/.plot-worker.envelope.json" ]; then
  cp "$PLOT_WORKTREE/.plot-worker.envelope.json" "${log}/seen-\${PLOT_BRANCH##*/}.json"
fi
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
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });

    // PRECONDITION, and the trap this fixture exists to avoid: wave 2 must be
    // blocked, or the hop is over work that was never gated.
    const before = execFileSync('bash', [scan, '--offline', 'hopdecl'],
      { encoding: 'utf8', cwd: sb.work });
    assert.match(before, /Implementation — blocked/,
      'precondition: the second wave must be blocked, or the hop proves nothing');

    fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'), prompt(sb.work, log));

    // THE MANIFEST IS THE CHANNEL THE HAND-OVER TRAVELS, so this fixture needs
    // one where it used to pass `PLOT_MANIFEST_FILE: ''`. An agent with no
    // manifest can be handed nothing and never hops.
    const manifestDir = path.join(sb.work, '.plot', 'agents');
    fs.mkdirSync(manifestDir, { recursive: true });
    const manifest = path.join(manifestDir, 'sess-hopdecl.json');
    fs.writeFileSync(manifest, JSON.stringify({
      session: 'sess-hopdecl',
      resumeId: 'sess-hopdecl',
      branch: 'feature/seam',
      worktree: wt,
      command: 'plot-worker-loop.sh',
      pid: '4242',
      wrapperPid: '4241',
      attempts: 0,
      startedAt: '2026-09-03T09:00:00Z',
    }, null, 2) + '\n');
    const dir = shimmedScripts(sb.root, manifest, 'feature/api');

    // THE LOOP ENDS ON ITS BOUND, NOT ON SILENCE. Since
    // `an-agent-waits-for-work` an agent handed nothing WAITS rather than
    // exits, so this fixture — whose plan has exactly two slices and both of
    // them done once the hop completes — would never return. The wait is
    // bounded here, and the loop then exits 124 the way a real one does when
    // `Worker bound` runs out while it is free. `execFileSync` throws on that,
    // so it is caught: the exit code is not what any assertion below is about.
    try {
      execFileSync('bash', [path.join(dir, 'plot-worker-loop.sh')], {
        cwd: wt,
        encoding: 'utf8',
        timeout: 120000,
        env: {
          ...process.env,
          PLOT_BRANCH: 'feature/seam',
          PLOT_WORKTREE: wt,
          PLOT_SLUG: 'hopdecl',
          PLOT_MANIFEST_FILE: manifest,
          PLOT_WAIT_POLL_SECONDS: '1',
          PLOT_WAIT_BUDGET_SECONDS: '6',
        },
      });
    } catch (err) {
      assert.equal(err.status, 124,
        'the loop may only end on its own bound here, never on any other failure');
    }

    // THE HOP HAPPENED, and it happened WITHOUT a second desk. The prompt ran
    // once per branch, so its per-branch marker files are the count; the
    // absence of `plot-wt-feature-api` is what says the desk was reset rather
    // than duplicated.
    assert.ok(fs.existsSync(path.join(wt, 'work-api.txt')),
      'the worker took the slice the registry handed it, or there is nothing to assert');
    assert.equal(fs.existsSync(path.join(wtRoot, 'plot-wt-feature-api')), false,
      'the hop must reset the desk it holds, not cut a second one');

    // NOTHING WAS CARRIED OVER. The second slice found no declaration on the
    // desk, so it could not have inherited the seam's `pr` or `artifacts`; the
    // absent copy is the reading. `seen-seam.json` is absent for the same
    // reason one step earlier — the desk was fresh when the seam started.
    assert.equal(fs.existsSync(path.join(log, 'seen-api.json')), false,
      'the second slice must start on a desk carrying no declaration from the first');
    assert.equal(fs.existsSync(path.join(log, 'seen-seam.json')), false,
      'the first slice must start on a desk carrying no declaration');

    // AND THE DESK DECLARES THE BRANCH IT NOW HOLDS. A declaration naming
    // `feature/seam` here would mean the seal after the hop never ran, or ran
    // against a stale branch — the failure a per-worker write produces.
    const later = JSON.parse(fs.readFileSync(path.join(wt, DECLARATION), 'utf8'));
    assert.equal(later.branch, 'feature/api', 'the desk declares the branch it now holds');
    assert.equal(later.status, 'ok');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
