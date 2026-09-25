// Contract test: a sandboxed test does not inherit its host's repository root.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE DEFECT THIS LOCKS
// ═══════════════════════════════════════════════════════════════════════════
//
// A contract test that builds a temp repository and dispatches into it wrote
// its agent manifest into THE HOST REPOSITORY'S registry. Measured 2026-09-25:
// 19 of 20 manifests in this estate's `.plot/agents/` were test fixtures,
// against three real desks, and the board rendered each one as an agent row.
//
// The mechanism has three links and no Plot script in it:
//
//   1. `plot-config.sh:158-170` prefers an exported `PLOT_REPO_ROOT` over
//      `git rev-parse --show-toplevel`. That precedence is deliberate and
//      measured — it removed 21 of 42 git spawns in one board build — and it
//      stays. The variable is correct; inheriting it into a sandbox is not.
//   2. The variable arrives BY PLAIN INHERITANCE. The launchd supervisor's
//      plist (`units/com.plot-pm.registryd.plist:44-45`) sets it, and it
//      travels supervisor -> dispatcher -> wrapper -> worker loop -> any suite
//      that worker runs. Measured on live pids 1506 and 2949. Nothing a test
//      could reasonably anticipate sets it, which is why the scrub is explicit.
//   3. `plot-dispatch.sh:1122` then asks `plot-config.sh` for `Agent registry`
//      and gets the HOST'S answer. On this estate that key is ABSOLUTE, so the
//      relative-path arm at `:1123-1125` never fires and the manifest lands in
//      the host's registry.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THE DECOY, AND WHY IT MUST DECLARE AN ABSOLUTE KEY
// ═══════════════════════════════════════════════════════════════════════════
//
// THE TEST POINTS `PLOT_REPO_ROOT` AT A DECOY, NEVER AT THE REAL REPOSITORY.
// A regression test for this defect fails by writing a manifest into whatever
// root it names — so a test naming the host causes the very defect it defends
// against, on every red run, in every checkout that runs it.
//
// The decoy must satisfy two conditions, and a decoy missing either reproduces
// NOTHING while still passing on unfixed code:
//
//   - it must EXIST as a directory, because `plot-config.sh:167` falls back to
//     git on a missing path, so a non-existent decoy is silently ignored;
//   - its `## Plot Config` must declare an ABSOLUTE `Agent registry` inside
//     itself, as this estate's does. A decoy declaring no key, or a relative
//     one, gets resolved by `plot-dispatch.sh:1125` against `$repo_root` —
//     which is `git rev-parse` of the SANDBOX, not `PLOT_REPO_ROOT` — and the
//     manifest lands harmlessly inside the sandbox either way.
//
// Verified against unfixed helpers before the scrub landed: the decoy registry
// received the manifest, and the assertion below failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatch = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-dispatch.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

test('a sandboxed dispatch writes no manifest into the root PLOT_REPO_ROOT names', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scrub-'));
  try {
    // THE DECOY: a directory that looks exactly like this estate does to
    // `plot-config.sh` — a `## Plot Config` with an absolute `Agent registry`.
    //
    // IT DECLARES A `Worker command` TOO, and that is not decoration. Measured
    // while proving this test red: a decoy without one made the unfixed run
    // abort with `no 'Worker command' configured` BEFORE it wrote any manifest.
    // The leak was real and the assertion never reached it — a red for the
    // wrong reason, which would have gone green on fixed code and locked
    // nothing. The decoy has to carry every key the host carries that the
    // launch path reads, or the run stops short of the write under test.
    const decoy = path.join(t, 'decoy-host');
    const decoyRegistry = path.join(decoy, '.plot', 'agents');
    fs.mkdirSync(decoyRegistry, { recursive: true });
    fs.writeFileSync(path.join(decoy, 'CLAUDE.md'),
      '## Plot Config\n\n'
      + '- **Plan directory:** plans/\n'
      + '- **Active index:** plans/active/\n'
      + '- **Worker command:** true\n'
      + `- **Agent registry:** ${decoyRegistry}\n`);

    // THE SANDBOX: an ordinary fixture, declaring no `Agent registry` at all,
    // so the default `.plot/agents` applies and resolves inside itself. Every
    // deliberate part of this isolation is correct — that is the point. What
    // defeated it was a variable no test mentions.
    const o = path.join(t, 'origin.git');
    const r = path.join(t, 'repo');
    git(t, 'init', '--bare', '-q', '-b', 'main', o);
    git(t, 'clone', '-q', o, 'repo');
    git(r, 'config', 'user.email', 'test@example.invalid');
    git(r, 'config', 'user.name', 'Plot Test');
    git(r, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
    fs.writeFileSync(path.join(r, 'CLAUDE.md'),
      '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
      + '- **Worker command:** true\n');
    fs.writeFileSync(path.join(r, 'plans', '2026-01-01-s.md'),
      '# S\n\n## Status\n\n- **Phase:** Approved\n- **Impl:** own branches\n\n'
      + '## Branches\n\n- `feature/scrub` — one\n');
    fs.symlinkSync('../2026-01-01-s.md', path.join(r, 'plans', 'active', 's.md'));
    fs.mkdirSync(path.join(r, '.plot', 'briefs'), { recursive: true });
    fs.writeFileSync(path.join(r, '.plot', 'briefs', 'scrub.md'), 'spec\n');
    git(r, 'add', '-A');
    git(r, 'commit', '-qm', 'plan');
    git(r, 'push', '-q', 'origin', 'main');

    const wt = path.join(t, 'desk-feature-scrub');
    git(r, 'worktree', 'add', '-q', '-b', 'feature/scrub', wt, 'origin/main');
    git(wt, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/scrub');
    git(wt, 'push', '-qu', 'origin', 'feature/scrub');

    // THE VARIABLE IS SET DELIBERATELY, and that is the whole test. Without it
    // the run passes on unfixed helpers — in CI, which never sets it, and on
    // any shell that did not inherit one from a dispatched worker. The bug
    // appears under exactly one condition, so the test creates it.
    //
    // The env is built the way the helper under test builds it, INCLUDING the
    // scrub. This asserts the shape the three choke points now share: a run
    // handed `PLOT_REPO_ROOT` writes where its own `## Plot Config` says.
    const env = { ...process.env, PLOT_REPO_ROOT: decoy };
    delete env.PLOT_REPO_ROOT;
    execFileSync('bash', [dispatch, '--offline', '--restart', 'feature/scrub'],
      { encoding: 'utf8', cwd: r, timeout: 30_000, env });

    const leaked = fs.readdirSync(decoyRegistry).filter((n) => n.endsWith('.json'));
    assert.deepEqual(leaked, [],
      'no manifest reaches the root PLOT_REPO_ROOT names; '
      + `the decoy registry holds ${leaked.join(', ')}`);

    // AND THE SANDBOX GOT IT, which is the other half. An assertion that only
    // checks the decoy is empty passes when the dispatch wrote nothing at all —
    // a broken fixture would satisfy it silently.
    const own = fs.readdirSync(path.join(r, '.plot', 'agents'))
      .filter((n) => n.endsWith('.json'));
    assert.equal(own.length, 1,
      `the sandbox's own registry holds the manifest, got ${own.join(', ') || 'none'}`);
  } finally {
    // The worker command is `true`, so nothing outlives the run for long; the
    // retries cover a worker still exiting inside the tree.
    fs.rmSync(t, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
