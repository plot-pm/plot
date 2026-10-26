// Reproduction for #2158: a plan repository whose `Git host` is Bitbucket,
// declaring `Impl: other repo`, with slice lines `→ owner/repo#N` naming
// merged PRs in a GitHub repository.
//
// THE CAUSE, MEASURED NOT GUESSED (plan `## Motivation`, brief). `plot-host.sh`
// selects ONE backend per checkout (`$PLOT_HOST`, else the `Git host` key).
// `plot-impl-status.sh:320` asks `plot-host.sh pr-state "$NUM" --repo "$REPO"`
// for a cross-repo annotation, but `--repo` only ever reaches the backend the
// checkout already committed to: `-R <repo>` for the `gh` arm, the repository
// argument for the `bb` arm. A GitHub reference on a Bitbucket checkout
// therefore reaches `bb`, which finds no such PR, and the call degrades to
// `state NONE`. `plot-deliver.sh` carries the same blindness one layer down:
// its merge check falls through to `host.prMerged(branch)` — no `--repo` at
// all — which asks the SAME fixed backend for a branch that, under
// `Impl: other repo`, never lived in this checkout to begin with.
//
// WHY BOTH `gh` AND `bb` ARE STUBBED, AND WHY THEY MUST DISAGREE (brief,
// "Settled decisions"). The `bb` stub answers *no such PR* for the reference;
// the `gh` stub answers *merged*. A fixture where both arms agree would pass
// with the bug in place — see the memory *Mutation fixtures must make the
// arms disagree*. Only `plot-host.sh` is left unstubbed: stubbing it would
// hide the very backend-selection defect under test, and
// `scripts/check-host-cli-callers.sh` keeps `gh`/`bb` calls out of every other
// script, so these two binaries are the only legitimate seam.
//
// THE TEST PINS BEHAVIOUR, NOT THE MECHANISM. The fix may add a `## Plot
// Config` key or a `host:` prefix on the reference (plan `## Design`, Open
// Questions) — this file names neither. It writes a plain `Git host:
// bitbucket` checkout with an ordinary `→ owner/repo#N` annotation and asserts
// only the observable outcome.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const implStatus = path.join(root, 'skills', 'plot', 'scripts', 'plot-impl-status.sh');
const deliver = path.join(root, 'skills', 'plot', 'scripts', 'plot-deliver.sh');

const ctx = [];
after(() => { for (const t of ctx) fs.rmSync(t, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const REMOTE_REPO = 'quatico/the-github-side';
const PR_NUMBER = 4711;
const REF = `${REMOTE_REPO}#${PR_NUMBER}`;

// The `gh` arm: the reference names a real, merged PR on GitHub. Answers both
// `pr view <N>` (the number form `pr-state` uses) and `--version`, which the
// capability probe some code paths run before the real call.
function stubGh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-xhost-gh-'));
  ctx.push(dir);
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
if [[ "$*" == *"--version"* ]]; then echo "gh version 2.0.0"; exit 0; fi
if [[ "$*" == *"pr view"* ]]; then
  printf '{"number":${PR_NUMBER},"state":"MERGED","isDraft":false,"url":"https://github.test/pr/${PR_NUMBER}","mergeCommit":{"oid":"abc1234"}}'
  exit 0
fi
if [[ "$*" == *"pr list"* ]]; then printf '[]'; exit 0; fi
printf '{}'
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return dir;
}

// The `bb` arm: the SAME reference, asked of Bitbucket — which genuinely holds
// no such PR, because under `Impl: other repo` the branch never lived here.
// `pr view <N>` fails exactly as the real CLI does on a miss: non-zero, with
// the stderr wording `is_lookup_miss` (plot-host.sh:2012) recognises as "no
// such PR" rather than "transport failure". `pr list`/`api` answer empty for
// the same reason — this repo has no PR by this number or by any branch head.
function stubBb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-xhost-bb-'));
  ctx.push(dir);
  fs.writeFileSync(path.join(dir, 'bb'), `#!/usr/bin/env bash
if [[ "$*" == *"--version"* ]]; then echo "bb version 1.9.0"; exit 0; fi
if [[ "$*" == *"pr list --help"* ]]; then echo '--json'; exit 0; fi
if [ "$1" = "api" ]; then printf '{"values":[]}'; exit 0; fi
if [[ "$*" == *"pr view"* ]]; then echo "no pull requests found for ${PR_NUMBER}" >&2; exit 1; fi
if [[ "$*" == *"pr list"* ]]; then printf '[]'; exit 0; fi
printf '{}'
`);
  fs.chmodSync(path.join(dir, 'bb'), 0o755);
  return dir;
}

/**
 * A Bitbucket plan repository, `Impl: other repo`, whose one slice names a
 * merged GitHub PR by `→ owner/repo#N`. Real origin, because
 * `plot-impl-status.sh` reads the plan from `origin/<default>` on purpose.
 */
function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-xhost-repo-'));
  ctx.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), [
    '# Fixture', '', '## Plot Config', '',
    '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/',
    '- **Plan directory:** docs/plans/',
    '- **Active index:** docs/plans/active/',
    '- **Delivered index:** docs/plans/delivered/',
    '- **Git host:** bitbucket', '',
  ].join('\n'));
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  const rel = path.join('docs', 'plans', '2026-10-24-a-split-home-plan.md');
  fs.writeFileSync(path.join(repo, rel), [
    '# A split-home plan', '',
    '## Status', '',
    '- **Phase:** Approved',
    '- **Type:** bug',
    '- **Impl:** other repo',
    '- **Approved:** 2026-10-24, Jan Wloka, plan-PR #1 merged', '',
    '## Branches', '',
    `- \`feature/lives-on-github\` — the implementation → ${REF}`, '',
  ].join('\n'));
  fs.symlinkSync(
    path.join('..', path.basename(rel)),
    path.join(repo, 'docs', 'plans', 'active', 'a-split-home-plan.md'),
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  return repo;
}

function runScript(script, args, { cwd, path: binPath }) {
  const env = { ...process.env, PATH: `${binPath}:${process.env.PATH}` };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-xhost-tmp-'));
  env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-xhost-home-'));
  env.PLOT_PR_INDEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-xhost-prindex-'));
  // Skips `bb pr list --help --json` capability probing against the stub —
  // the probe is about a REAL bb's flag support, not this test's reference
  // resolution, and host.test.mjs's own bitbucket fixtures skip it the same way.
  env.PLOT_BB_SKIP_CAP_CHECK = '1';
  ctx.push(env.TMPDIR, env.HOME, env.PLOT_PR_INDEX_HOME);
  return execFileSync('bash', [script, ...args], { encoding: 'utf8', cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
}

test(
  'plot-impl-status.sh lists a GitHub PR a cross-repo reference names, on a Bitbucket checkout',
  () => {
    const repo = makeRepo();
    const gh = stubGh();
    const bb = stubBb();
    const binPath = `${gh}:${bb}`;

    const out = runScript(implStatus, ['a-split-home-plan'], { cwd: repo, path: binPath });
    const json = JSON.parse(out);

    assert.equal(
      json.prs?.length,
      1,
      `expected the GitHub PR ${REF} to be listed, got ${out} — the reference was sent to Bitbucket instead of GitHub`,
    );
    assert.equal(json.prs?.[0]?.number, PR_NUMBER);
    assert.equal(json.prs?.[0]?.state, 'MERGED');
  },
);

test(
  'plot-deliver.sh accepts a slice whose cross-repo reference names a merged GitHub PR, on a Bitbucket checkout',
  () => {
    const repo = makeRepo();
    const gh = stubGh();
    const bb = stubBb();
    const binPath = `${gh}:${bb}`;

    let failed = false;
    let output = '';
    try {
      output = runScript(deliver, ['a-split-home-plan'], { cwd: repo, path: binPath });
    } catch (e) {
      failed = true;
      output = `${e.stdout || ''}${e.stderr || ''}`;
    }

    assert.equal(
      failed,
      false,
      `expected delivery to accept the merged slice, got a refusal naming the branch as unmerged: ${output}`,
    );
  },
);

// VALIDATED DURING AUTHORING, NOT COMMITTED HERE: with `bb` routed to agree
// with `gh` (both answering MERGED, by the same Bitbucket-shaped JSON
// `plot-host.sh`'s bb arm actually parses), both cases above pass — proving
// the fixture tests the diagnosed cause rather than an unrelated mistake. See
// the brief's "Done when": restore the stub from git after confirming this,
// rather than leaving the masking fixture in the committed test.
