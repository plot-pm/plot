// Contract test for a pinned verification run: `plot-verify.mjs` prepares two
// trees, folds juror files into verdicts, and books the record onto the default
// branch.
//
// THE SANDBOX CARRIES ITS OWN COPY OF THE SCRIPTS, committed, because `prepare`
// takes its tools from `origin/<main>` and finds them at the same path the
// running bundle lives under. The delivery commit holds a stub
// `plot-local-checks.mjs` that ignores `--files`; the commit after it replaces
// the stub with the real bundle. A run that used the pin's own code would check
// nothing and report success, and the first test fails on exactly that.
//
// NO MODEL RUNS HERE. The test writes the juror files, the host is a stub that
// names one merge commit, and `pnpm` is a stub that exits with a chosen code.
// Where `PLOT_STUB_REMOTE` is set, the host stub also opens a PR and merges it
// by moving the bare origin's `main` to the PR's branch.
//
// Needs `plot-verify.mjs` and `plot-local-checks.mjs` built under
// `skills/plot/scripts/board/` (`pnpm build:board`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.resolve(here, '../../skills/plot/scripts');
const SLUG = 'the-plan';
const PLAN = 'docs/plans/2026-10-01-the-plan.md';
const SCRIPTS_REL = 'skills/plot/scripts';

const g = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

const commit = (dir, message) => {
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return g(dir, 'rev-parse', 'HEAD');
};

const STUB_LOCAL_CHECKS = '#!/usr/bin/env node\n// an older bundle: reads no arguments\n';
const STUB_HOST = `#!/usr/bin/env bash
case "$1" in
  default-branch) echo main ;;
  pr-merge-commit) printf '%s\\n' "\${PLOT_STUB_MERGE_SHA:-}" ;;
  pr-create)
    [ -n "\${PLOT_STUB_REMOTE:-}" ] || exit 3
    while [ $# -gt 0 ]; do [ "$1" = --head ] && printf '%s' "$2" > "$PLOT_STUB_REMOTE/stub-pr-head"; shift; done
    echo https://example.test/pull/7 ;;
  pr-merge)
    [ -n "\${PLOT_STUB_REMOTE:-}" ] && [ "$2" = 7 ] || exit 3
    head=$(cat "$PLOT_STUB_REMOTE/stub-pr-head")
    git --git-dir="$PLOT_STUB_REMOTE" update-ref refs/heads/main "refs/heads/$head"
    git --git-dir="$PLOT_STUB_REMOTE" update-ref -d "refs/heads/$head" ;;
  *) exit 3 ;;
esac
`;
// Rejects the first `$PLOT_STUB_PUSH_REJECTS` calls, counted in the file
// `$PLOT_STUB_PUSH_COUNT`, then hands every later call to the real script.
const STUB_PUSH_REJECTS = `#!/usr/bin/env bash
n=$(cat "$PLOT_STUB_PUSH_COUNT" 2>/dev/null || echo 0)
echo $((n + 1)) > "$PLOT_STUB_PUSH_COUNT"
if [ "$n" -lt "\${PLOT_STUB_PUSH_REJECTS:-0}" ]; then echo "push: rejected"; exit 1; fi
exec "$(dirname "$0")/plot-push-main.real.sh" "$@"
`;
const STUB_PNPM = '#!/usr/bin/env bash\nexit "${STUB_PNPM_EXIT:-0}"\n';

const planText = (delivered) => `# The plan

## Status

- **State:** Delivered
- **Type:** feature
- **Review:** pr
- **Approved:** 2026-10-01, T
- **Delivered:** ${delivered}

## Changelog

- First change.
- Second change.

## Acceptance

- Acceptance one.

## Slices

### Slice one

- \`feature/slice-one\`

## Notes
`;

/**
 * A repository with a bare origin, one plan and a delivery commit.
 *
 * @param options.delivered whether the plan's `Delivered:` is ever filled.
 * @param options.toolsCommitted whether `origin/main` carries the real bundles.
 * @param options.pushRejects whether `plot-push-main.sh` on `origin/main` is the counting stub; how many pushes it rejects is `PLOT_STUB_PUSH_REJECTS` at run time.
 * @returns the paths and commits a test asserts on, and `cleanup`.
 */
const sandbox = ({ delivered = true, toolsCommitted = true, pushRejects = false } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-verify-run-'));
  const dir = path.join(root, 'work');
  const remote = path.join(root, 'origin.git');
  const bin = path.join(root, 'bin');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  g(dir, 'config', 'user.email', 't@example.com');
  g(dir, 'config', 'user.name', 'T');
  g(dir, 'remote', 'add', 'origin', remote);

  write(dir, 'CLAUDE.md',
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n'
    + '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n'
    + '- **Local checks:** docs/plans/*.md = echo check-plan {changed}\n');
  for (const name of fs.readdirSync(scripts).filter((n) => n.endsWith('.sh'))) {
    write(dir, `${SCRIPTS_REL}/${name}`, fs.readFileSync(path.join(scripts, name), 'utf8'));
    fs.chmodSync(path.join(dir, SCRIPTS_REL, name), 0o755);
  }
  write(dir, `${SCRIPTS_REL}/plot-host.sh`, STUB_HOST);
  if (pushRejects) {
    write(dir, `${SCRIPTS_REL}/plot-push-main.real.sh`, fs.readFileSync(path.join(scripts, 'plot-push-main.sh'), 'utf8'));
    fs.chmodSync(path.join(dir, SCRIPTS_REL, 'plot-push-main.real.sh'), 0o755);
    write(dir, `${SCRIPTS_REL}/plot-push-main.sh`, STUB_PUSH_REJECTS);
  }
  write(dir, `${SCRIPTS_REL}/board/plot-local-checks.mjs`, STUB_LOCAL_CHECKS);
  write(dir, PLAN, planText(''));
  commit(dir, 'base');
  write(dir, 'src/a.js', 'export const a = 1;\n');
  const mergeSha = commit(dir, 'slice one');

  let deliverySha = '';
  if (delivered) {
    write(dir, PLAN, planText('2026-10-05, T'));
    deliverySha = commit(dir, 'plot: deliver the-plan');
    write(dir, PLAN, `${planText('2026-10-05, T')}\nA later note.\n`);
  }
  const driftSha = commit(dir, 'a later edit');

  const real = (name) => fs.readFileSync(path.join(scripts, 'board', name), 'utf8');
  for (const name of ['plot-local-checks.mjs', 'plot-verify.mjs']) {
    if (name === 'plot-local-checks.mjs' && !toolsCommitted) continue;
    write(dir, `${SCRIPTS_REL}/board/${name}`, real(name));
  }
  if (toolsCommitted) {
    commit(dir, 'build the bundles');
  } else {
    // The running bundle must exist on disk; origin/main never holds it.
    g(dir, 'push', '-q', 'origin', 'main');
    g(dir, 'fetch', '-q', 'origin');
  }
  g(dir, 'push', '-q', 'origin', 'main');
  g(dir, 'fetch', '-q', 'origin');
  fs.chmodSync(path.join(dir, SCRIPTS_REL, 'board', 'plot-verify.mjs'), 0o755);

  write(bin, 'pnpm', STUB_PNPM);
  fs.chmodSync(path.join(bin, 'pnpm'), 0o755);

  return {
    dir,
    remote,
    bin,
    mergeSha,
    deliverySha,
    driftSha,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

/** Runs the sandbox's own `plot-verify.mjs`. */
const verify = (box, args, env = {}) => {
  const run = spawnSync('node', [path.join(box.dir, SCRIPTS_REL, 'board', 'plot-verify.mjs'), ...args], {
    cwd: box.dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${box.bin}:${process.env.PATH}`,
      PLOT_STUB_MERGE_SHA: box.mergeSha,
      PLOT_REPO_ROOT: '',
      PLOT_UNATTENDED: '',
      ...env,
    },
  });
  return { code: run.status, out: run.stdout, err: run.stderr };
};

const runDir = (box) => path.join(box.dir, '.plot/state/verify', SLUG);

/** Runs the tools tree's `plot-verify.mjs` with `pin/` as its working directory. */
const verifyFromTools = (box, args, env = {}) => {
  const run = spawnSync('node', [path.join(runDir(box), 'tools', SCRIPTS_REL, 'board', 'plot-verify.mjs'), ...args], {
    cwd: path.join(runDir(box), 'pin'),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${box.bin}:${process.env.PATH}`,
      PLOT_STUB_MERGE_SHA: box.mergeSha,
      PLOT_REPO_ROOT: '',
      PLOT_UNATTENDED: '',
      ...env,
    },
  });
  return { code: run.status, out: run.stdout, err: run.stderr };
};

const verifyTrees = (box) =>
  g(box.dir, 'worktree', 'list').split('\n').filter((l) => /state\/verify|plot\/verify-/.test(l)).length;

const jurors = (box, files) => {
  for (const [lens, text] of Object.entries(files)) {
    write(box.dir, `.plot/panels/${SLUG}/verify-${lens}.md`, text);
  }
};

const SUPPORTED = 'Claim-1: supported\nClaim-2: supported\nClaim-3: supported\n';

const onMain = (box, rel) => {
  g(box.dir, 'fetch', '-q', 'origin');
  return g(box.dir, 'show', `origin/main:${rel}`);
};

const count = (text, re) => (text.match(re) ?? []).length;

test('the tools tree reads --files at the delivery commit and the pin\'s own bundle reads nothing', () => {
  const box = sandbox();
  try {
    const prepared = verify(box, ['prepare', SLUG]);
    assert.equal(prepared.code, 0, prepared.err);
    const list = path.join(box.dir, 'list.txt');
    fs.writeFileSync(list, `${PLAN}\n`);
    const pin = path.join(runDir(box), 'pin');
    const tools = path.join(runDir(box), 'tools');
    const viaTools = spawnSync('node', [path.join(tools, SCRIPTS_REL, 'board/plot-local-checks.mjs'), '--files', list], {
      cwd: pin, encoding: 'utf8',
    });
    const viaPin = spawnSync('node', [path.join(pin, SCRIPTS_REL, 'board/plot-local-checks.mjs'), '--files', list], {
      cwd: pin, encoding: 'utf8',
    });
    assert.match(viaTools.stdout, /echo check-plan .*2026-10-01-the-plan\.md/);
    assert.equal(viaPin.stdout, '');
    assert.equal(g(pin, 'rev-parse', 'HEAD'), box.deliverySha);
    assert.equal(g(tools, 'rev-parse', 'HEAD'), g(box.dir, 'rev-parse', 'origin/main'));
    assert.equal(g(pin, 'status', '--porcelain'), '', 'the pid marker is excluded from the pin tree');
    assert.ok(fs.existsSync(path.join(pin, '.plot-verify.pid')));
  } finally {
    box.cleanup();
  }
});

test('prepare pins the commit that added Delivered, not a later edit of the plan', () => {
  const box = sandbox();
  try {
    assert.notEqual(box.deliverySha, box.driftSha);
    const prepared = verify(box, ['prepare', SLUG]);
    assert.equal(prepared.code, 0, prepared.err);
    assert.match(prepared.out, new RegExp(`summary: pin=${box.deliverySha} delivery=${box.deliverySha} `));
    const files = fs.readFileSync(path.join(runDir(box), 'files.txt'), 'utf8').trim().split('\n');
    assert.deepEqual(files, ['src/a.js']);
  } finally {
    box.cleanup();
  }
});

test('claims prints a numbered list and no line a juror could paste as a commitment', () => {
  const box = sandbox();
  try {
    const claims = verify(box, ['claims', SLUG, box.deliverySha]);
    assert.equal(claims.code, 0, claims.err);
    const lines = claims.out.trimEnd().split('\n');
    assert.deepEqual(lines, ['1. First change.', '2. Second change.', '3. Acceptance one.']);
    assert.equal(lines.filter((l) => /^Claim-[0-9]+:/.test(l)).length, 0);
  } finally {
    box.cleanup();
  }
});

test('fold names one verdict per claim and refuses an incomplete juror file', () => {
  const box = sandbox();
  try {
    assert.equal(verify(box, ['prepare', SLUG]).code, 0);

    jurors(box, { a: SUPPORTED, b: SUPPORTED, c: SUPPORTED });
    const agreed = verify(box, ['fold', SLUG]);
    assert.equal(agreed.code, 0, agreed.err);
    const lines = agreed.out.trimEnd().split('\n');
    assert.equal(lines.length, 3);
    lines.forEach((line, i) => assert.match(line, new RegExp(`^- Claim-${i + 1} supported .* 3 of 3 \\(a, b, c\\)$`)));

    jurors(box, { b: 'Claim-1: supported\nClaim-2: refuted\nClaim-3: supported\n' });
    const split = verify(box, ['fold', SLUG]);
    assert.equal(split.code, 0, split.err);
    assert.match(split.out, /Claim-2 refuted .* b refuted; a, c supported/);
    assert.equal(count(split.out, /refuted/g), 2, 'the refuted line names its lens once and the verdict once');

    jurors(box, { b: 'Claim-1: supported\nClaim-3: supported\n' });
    const missing = verify(box, ['fold', SLUG]);
    assert.notEqual(missing.code, 0);
    assert.equal(missing.out, '');
    assert.match(missing.err, /Claim-2 by b/);
  } finally {
    box.cleanup();
  }
});

test('a second prepare moves the earlier run\'s juror files aside, and fold reads only this run\'s', () => {
  const box = sandbox();
  try {
    assert.equal(verify(box, ['prepare', SLUG]).code, 0);
    jurors(box, { stale: SUPPORTED, kept: SUPPORTED });
    assert.equal(verify(box, ['prepare', SLUG]).code, 0);
    const panels = path.join(box.dir, '.plot/panels', SLUG);
    assert.deepEqual(fs.readdirSync(panels).sort(), ['verify-1-kept.md', 'verify-1-stale.md']);
    jurors(box, { kept: 'Claim-1: supported\nClaim-2: refuted\nClaim-3: supported\n' });
    const folded = verify(box, ['fold', SLUG]);
    assert.equal(folded.code, 0, folded.err);
    assert.match(folded.out, /Claim-1 supported .* 1 of 1 \(kept\)$/m);
    assert.equal(folded.out.includes('stale'), false, 'the earlier run\'s juror is not folded');
    assert.equal(verify(box, ['prepare', SLUG]).code, 0);
    assert.deepEqual(fs.readdirSync(panels).sort(), ['verify-1-kept.md', 'verify-1-stale.md', 'verify-2-kept.md']);
  } finally {
    box.cleanup();
  }
});

test('record books one commit and a second run leaves exactly one record', () => {
  const box = sandbox();
  try {
    assert.equal(verify(box, ['prepare', SLUG]).code, 0);
    jurors(box, { a: SUPPORTED, b: SUPPORTED, c: SUPPORTED });
    const first = verify(box, ['record', SLUG], { PLOT_VERIFY_WHO: 'Verifier' });
    assert.equal(first.code, 0, first.err + first.out);
    assert.equal(g(box.dir, 'log', '-1', '--format=%s', 'origin/main'), 'plot: verify the-plan');
    let plan = onMain(box, PLAN);
    assert.equal(count(plan, /^- \*\*Verified:\*\*/gm), 1);
    assert.equal(count(plan, /^## Verification$/gm), 1);
    const toolsSha = g(box.dir, 'rev-parse', '--short=7', 'origin/main~1');
    assert.match(plan, new RegExp(`delivery 2026-10-05 at ${box.deliverySha.slice(0, 7)}, judged at ${box.deliverySha.slice(0, 7)} with tools at ${toolsSha}, 3 supported, 0 refuted`));
    assert.match(plan, /- Claim-1 supported — First change\./);

    assert.equal(verify(box, ['prepare', SLUG]).code, 0);
    jurors(box, { b: 'Claim-1: supported\nClaim-2: refuted\nClaim-3: supported\n' });
    const second = verify(box, ['record', SLUG]);
    assert.equal(second.code, 0, second.err + second.out);
    plan = onMain(box, PLAN);
    assert.equal(count(plan, /^- \*\*Verified:\*\*/gm), 1);
    assert.equal(count(plan, /^## Verification$/gm), 1);
    assert.match(plan, /2 supported, 1 refuted/);
    assert.match(plan, /- Claim-2 refuted — Second change\./);
    assert.equal(plan.includes('A later note.'), true, 'the booking starts from origin/main and keeps a later edit');
  } finally {
    box.cleanup();
  }
});

test('a refused fold writes no record', () => {
  const box = sandbox();
  try {
    assert.equal(verify(box, ['prepare', SLUG]).code, 0);
    const before = g(box.dir, 'rev-parse', 'origin/main');
    jurors(box, { a: SUPPORTED, b: 'Claim-1: supported\n' });
    const recorded = verify(box, ['record', SLUG]);
    assert.notEqual(recorded.code, 0);
    assert.match(recorded.err, /Claim-2 by b/);
    g(box.dir, 'fetch', '-q', 'origin');
    assert.equal(g(box.dir, 'rev-parse', 'origin/main'), before);
  } finally {
    box.cleanup();
  }
});

test('record leaves no tree, no booking branch and no worktree', () => {
  const box = sandbox();
  try {
    assert.equal(verify(box, ['prepare', SLUG]).code, 0);
    jurors(box, { a: SUPPORTED, b: SUPPORTED });
    const recorded = verify(box, ['record', SLUG]);
    assert.equal(recorded.code, 0, recorded.err + recorded.out);
    assert.equal(fs.existsSync(runDir(box)), false);
    assert.equal(g(box.dir, 'branch', '--list', 'plot/verify-*'), '');
    assert.equal(g(box.dir, 'worktree', 'list').split('\n').filter((l) => /state\/verify|plot\/verify-/.test(l)).length, 0);
  } finally {
    box.cleanup();
  }
});

/** The environment that makes the stubbed push script reject `rejects` calls, with no wait between attempts. */
const pushEnv = (box, rejects) => ({
  PLOT_STUB_PUSH_REJECTS: String(rejects),
  PLOT_STUB_PUSH_COUNT: path.join(box.bin, 'push-count'),
  PLOT_PUSH_RETRY_WAIT_MS: '0',
});

const pushCalls = (box) => Number(fs.readFileSync(path.join(box.bin, 'push-count'), 'utf8'));

test('a push rejected once is retried and lands the record with no micro-PR', () => {
  const box = sandbox({ pushRejects: true });
  try {
    assert.equal(verify(box, ['prepare', SLUG]).code, 0);
    jurors(box, { a: SUPPORTED, b: SUPPORTED, c: SUPPORTED });
    const before = g(box.dir, 'rev-parse', 'origin/main');
    const recorded = verify(box, ['record', SLUG], pushEnv(box, 1));
    assert.equal(recorded.code, 0, recorded.err + recorded.out);
    assert.match(recorded.out, /step: push rejected — retrying \(attempt 1 of 5\)/);
    assert.doesNotMatch(recorded.out, /micro-PR/);
    assert.match(recorded.out, /summary: push=clean /);
    assert.equal(pushCalls(box), 2);
    g(box.dir, 'fetch', '-q', '--prune', 'origin');
    assert.equal(g(box.dir, 'rev-list', '--count', `${before}..origin/main`), '1');
    assert.equal(g(box.dir, 'log', '-1', '--format=%s', 'origin/main'), 'plot: verify the-plan');
    const plan = onMain(box, PLAN);
    assert.equal(count(plan, /^- \*\*Verified:\*\*/gm), 1);
    assert.equal(count(plan, /^## Verification$/gm), 1);
    assert.equal(fs.existsSync(runDir(box)), false);
    assert.equal(g(box.dir, 'branch', '--list', 'plot/verify-*'), '');
    assert.equal(g(box.dir, 'ls-remote', '--heads', 'origin', 'plot/verify-*'), '');
    assert.equal(verifyTrees(box), 0);
  } finally {
    box.cleanup();
  }
});

test('a push rejected on every attempt is refused by name and lands nothing', () => {
  const box = sandbox({ pushRejects: true });
  try {
    assert.equal(verify(box, ['prepare', SLUG]).code, 0);
    jurors(box, { a: SUPPORTED, b: SUPPORTED, c: SUPPORTED });
    const before = g(box.dir, 'rev-parse', 'origin/main');
    const recorded = verify(box, ['record', SLUG], pushEnv(box, 99));
    assert.notEqual(recorded.code, 0);
    assert.match(recorded.out, /step: push rejected — retrying \(attempt 4 of 5\)/);
    assert.match(recorded.out, /step: push rejected after 5 attempts/);
    assert.match(recorded.out, /summary: push=rejected/);
    assert.match(recorded.err, /the verification is committed on 'plot\/verify-[^']*' but could not reach main/);
    assert.doesNotMatch(recorded.out + recorded.err, /micro-PR/);
    assert.equal(pushCalls(box), 5);
    g(box.dir, 'fetch', '-q', '--prune', 'origin');
    assert.equal(g(box.dir, 'rev-parse', 'origin/main'), before);
    assert.equal(g(box.dir, 'ls-remote', '--heads', 'origin', 'plot/verify-*'), '');
  } finally {
    box.cleanup();
  }
});

test('every command after prepare runs in the tools tree, and the tools copy runs from pin/', () => {
  const box = sandbox();
  try {
    const prepared = verify(box, ['prepare', SLUG]);
    assert.equal(prepared.code, 0, prepared.err);
    const handOver = /^plot-verify: hand over to \/.*\/work\/\.plot\/state\/verify\/the-plan\/tools\/skills\/plot\/scripts\/board\/plot-verify\.mjs$/m;
    assert.match(prepared.err, handOver);
    assert.ok(fs.existsSync(path.join(runDir(box), 'run.json')), 'run.json lies under the main checkout');

    jurors(box, { a: SUPPORTED, b: SUPPORTED, c: SUPPORTED });
    const handed = verify(box, ['fold', SLUG]);
    assert.equal(handed.code, 0, handed.err);
    assert.match(handed.err, handOver);
    assert.equal(handed.out.trimEnd().split('\n').length, 3, 'stdout carries the tools copy\'s output alone');

    const folded = verifyFromTools(box, ['fold', SLUG]);
    assert.equal(folded.code, 0, folded.err);
    assert.doesNotMatch(folded.err, /hand over/, 'the tools copy hands over to nobody');
    assert.equal(folded.out.trimEnd().split('\n').length, 3);

    const recorded = verifyFromTools(box, ['record', SLUG]);
    assert.equal(recorded.code, 0, recorded.err + recorded.out);
    assert.equal(g(box.dir, 'log', '-1', '--format=%s', 'origin/main'), 'plot: verify the-plan');
    assert.equal(fs.existsSync(runDir(box)), false);
    assert.equal(fs.existsSync(path.join(box.dir, '.plot/panels', SLUG, 'verify-a.md')), true, 'the juror files stay with the main checkout');
    assert.equal(verifyTrees(box), 0);
  } finally {
    box.cleanup();
  }
});

test('prepare --at judges at the named commit and keeps the delivery commit and date', () => {
  const box = sandbox();
  try {
    const prepared = verify(box, ['prepare', SLUG, '--at', box.driftSha]);
    assert.equal(prepared.code, 0, prepared.err);
    assert.match(prepared.out, new RegExp(`summary: pin=${box.driftSha} delivery=${box.deliverySha} `));
    assert.equal(g(path.join(runDir(box), 'pin'), 'rev-parse', 'HEAD'), box.driftSha);
    jurors(box, { a: SUPPORTED, b: SUPPORTED, c: SUPPORTED });
    const recorded = verify(box, ['record', SLUG]);
    assert.equal(recorded.code, 0, recorded.err + recorded.out);
    assert.match(onMain(box, PLAN), new RegExp(`delivery 2026-10-05 at ${box.deliverySha.slice(0, 7)}, judged at ${box.driftSha.slice(0, 7)} with tools`));
  } finally {
    box.cleanup();
  }
});

test('prepare refuses fetch-failed where origin cannot be fetched', () => {
  const box = sandbox();
  try {
    g(box.dir, 'remote', 'set-url', 'origin', path.join(box.dir, '..', 'no-such-origin.git'));
    const prepared = verify(box, ['prepare', SLUG]);
    assert.notEqual(prepared.code, 0);
    assert.match(prepared.err, /fetch-failed: git fetch origin main exited/);
    assert.equal(fs.existsSync(runDir(box)), false);
    assert.equal(verifyTrees(box), 0);
  } finally {
    box.cleanup();
  }
});

test('prepare refuses tools-unavailable where origin/main holds no plot-verify.mjs', () => {
  const box = sandbox({ toolsCommitted: false });
  try {
    const prepared = verify(box, ['prepare', SLUG]);
    assert.notEqual(prepared.code, 0);
    assert.match(prepared.err, /tools-unavailable: .*plot-verify\.mjs/);
    assert.equal(fs.existsSync(runDir(box)), false);
    assert.equal(g(box.dir, 'worktree', 'list').split('\n').filter((l) => /state\/verify|plot\/verify-/.test(l)).length, 0);
  } finally {
    box.cleanup();
  }
});

test('prepare refuses pin-not-found where Delivered is never filled', () => {
  const box = sandbox({ delivered: false });
  try {
    const prepared = verify(box, ['prepare', SLUG]);
    assert.notEqual(prepared.code, 0);
    assert.match(prepared.err, /pin-not-found/);
    assert.equal(fs.existsSync(runDir(box)), false);
  } finally {
    box.cleanup();
  }
});

test('prepare refuses install-failed on a non-zero install and removes its trees', () => {
  const box = sandbox();
  try {
    const prepared = verify(box, ['prepare', SLUG], { STUB_PNPM_EXIT: '1' });
    assert.notEqual(prepared.code, 0);
    assert.match(prepared.err, /install-failed/);
    assert.equal(fs.existsSync(runDir(box)), false);
    assert.equal(g(box.dir, 'worktree', 'list').split('\n').filter((l) => /state\/verify|plot\/verify-/.test(l)).length, 0);
    assert.equal(onMain(box, PLAN).includes('Verified'), false);
  } finally {
    box.cleanup();
  }
});

test('status prints the fleet\'s verification block, and nothing where the fleet recorded nothing', () => {
  const box = sandbox();
  try {
    const empty = verify(box, ['status']);
    assert.equal(empty.code, 0, empty.err);
    assert.equal(empty.out, '');
    write(box.dir, '.plot/state/auto-verify-in-flight.json', JSON.stringify({
      failures: {}, failedAt: [1, 2, 3], lastSuccessAt: 0, running: {}, refusals: { 'the-plan': 'halted' }, rows: [], last: {},
    }));
    const halted = verify(box, ['status']);
    assert.equal(halted.code, 0, halted.err);
    assert.equal(halted.out, 'verification: halted, 0 running, 1 refused\n  the-plan  refused: halted\n');
  } finally {
    box.cleanup();
  }
});

test('plot-local-checks.mjs exits 2 on an argument it does not know', () => {
  const bundle = path.join(scripts, 'board/plot-local-checks.mjs');
  const unknown = spawnSync('node', [bundle, '--bogus'], { cwd: here, encoding: 'utf8' });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown argument --bogus/);
  const bare = spawnSync('node', [bundle, '--files'], { cwd: here, encoding: 'utf8' });
  assert.equal(bare.status, 2);
});
