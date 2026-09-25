// Contract test for a delivery writing its plan's issue status.
//
// `plot-deliver.sh` calls `plot-issue-status.sh` after the push has a result,
// and reports the outcome as `tracker=` on its summary line. The tracker holds
// a copy of one fact, so no outcome of that call may change the delivery's own
// exit code or undo what landed on `origin/main`.
//
// THE SCRIPTS ARE COPIED, NEVER LINKED. `plot-host.sh` is replaced by a stub in
// the copy; a `>` onto a symlink would write through it into the real script.
// The stub answers `default-branch` and records every `issue-status` call to a
// marker file, so a test can prove a call was or was not made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.resolve(here, '../../skills/plot/scripts');
const meta = path.join(scripts, 'plot-plan-meta.sh');

const STUB_HOST = `#!/usr/bin/env bash
case "$1" in
  default-branch) echo main ;;
  issue-status)
    printf '%s %s\\n' "$2" "$3" >> "$STUB_MARKER"
    [ "\${STUB_RC:-0}" = 0 ] || { echo "stub: the tracker refused" >&2; exit "$STUB_RC"; }
    echo written ;;
  *) exit 4 ;;
esac
`;

/**
 * A whole repo with one plan, delivered for real through a copied script set.
 *
 * @param opts.config extra `## Plot Config` lines.
 * @param opts.status extra `## Status` lines, such as an `Issue:`.
 * @param opts.stubRc what the stub's `issue-status` exits with.
 * @param opts.rejectPush install a remote hook that refuses every push after the seed.
 * @returns the run's output and exit code, the parsed plan on `origin/main`, and
 *   every `issue-status` call the stub saw.
 */
const deliverPlan = ({ config = [], status = [], stubRc = 0, rejectPush = false } = {}) => {
  // REALPATH'D, because `plot-ask.mjs` compares `import.meta.url` with the
  // unresolved `argv[1]` and does nothing, exit 0, where the two differ — as
  // they do under macOS's `/var` → `/private/var` link.
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'plot-deliver-tracker-'));
  const dir = path.join(root, 'repo');
  const remote = path.join(root, 'remote.git');
  const copy = path.join(root, 'scripts');
  const marker = path.join(root, 'issue-status.calls');
  try {
    fs.cpSync(scripts, copy, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(copy, 'plot-host.sh'), STUB_HOST);
    fs.chmodSync(path.join(copy, 'plot-host.sh'), 0o755);

    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
    fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      ['## Plot Config', '', '- **Plan directory:** docs/plans/',
        '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/', ...config, ''].join('\n'));
    const rel = path.join('docs', 'plans', '2026-01-01-told.md');
    fs.writeFileSync(path.join(dir, rel), ['# A plan', '', '## Status', '',
      '- **Phase:** Approved', '- **Approved:** 2026-01-01, T, in-session', ...status,
      '', '## Changelog', '', '- Did a thing.', ''].join('\n'));
    execFileSync('git', ['-C', dir, 'add', '-A']);
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'plan']);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
    execFileSync('git', ['-C', dir, 'push', '-q', 'origin', 'main']);
    execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);
    if (rejectPush) {
      const hook = path.join(remote, 'hooks', 'pre-receive');
      fs.writeFileSync(hook, '#!/bin/sh\necho "protected" >&2\nexit 1\n');
      fs.chmodSync(hook, 0o755);
    }

    let out = '';
    let code = 0;
    try {
      out = execFileSync('bash', [path.join(copy, 'plot-deliver.sh'), 'told'], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, STUB_MARKER: marker, STUB_RC: String(stubRc) },
      });
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      code = e.status ?? 1;
    }

    execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);
    const landed = path.join(root, 'read-back.md');
    fs.writeFileSync(landed,
      execFileSync('git', ['-C', dir, 'show', `origin/main:${rel}`], { encoding: 'utf8' }));
    const parsed = JSON.parse(execFileSync('bash', [meta, landed], { cwd: dir, encoding: 'utf8' }));
    const calls = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim().split('\n') : [];
    const summary = out.split('\n').filter((l) => l.startsWith('summary: ')).pop() ?? '';
    return { out, code, parsed, calls, summary };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const JIRA = ['- **Tracker:** jira https://tracker.invalid', '- **Tracker delivered status:** In Review'];

test('with no tracker declared, the delivery reports unaskable and succeeds', () => {
  const r = deliverPlan({ config: ['- **Tracker delivered status:** In Review'], status: ['- **Issue:** #12'] });

  assert.equal(r.code, 0, r.out);
  assert.equal(r.parsed.phase, 'delivered');
  assert.match(r.summary, / tracker=unaskable$/);
  assert.deepEqual(r.calls, [], 'a repository with no tracker reached the host script');
});

test('a written status is reported, against the issue the plan names', () => {
  const r = deliverPlan({ config: JIRA, status: ['- **Issue:** PROJ-7'] });

  assert.equal(r.code, 0, r.out);
  assert.match(r.summary, / tracker=written$/);
  assert.deepEqual(r.calls, ['PROJ-7 In Review']);
});

test('a failed write reports failed, and the delivery still succeeds and lands', () => {
  // The regression the plan names: the plan is delivered; the tracker is a copy.
  const r = deliverPlan({ config: JIRA, status: ['- **Issue:** PROJ-7'], stubRc: 1 });

  assert.equal(r.code, 0, `a tracker failure must not fail the delivery:\n${r.out}`);
  assert.equal(r.parsed.phase, 'delivered', 'the delivery did not reach origin/main');
  assert.match(r.summary, / tracker=failed$/);
  assert.deepEqual(r.calls, ['PROJ-7 In Review']);
});

test('a plan naming no issue reports none and never asks the tracker', () => {
  const r = deliverPlan({ config: JIRA });

  assert.equal(r.code, 0, r.out);
  assert.match(r.summary, / tracker=none$/);
  assert.deepEqual(r.calls, []);
});

test('a rejected push writes no status and reports skipped', () => {
  const r = deliverPlan({ config: JIRA, status: ['- **Issue:** PROJ-7'], rejectPush: true });

  assert.notEqual(r.code, 0, `a rejected push should fail the delivery:\n${r.out}`);
  assert.equal(r.parsed.phase, 'approved', 'the rejected delivery reached origin/main');
  assert.match(r.summary, / tracker=skipped$/);
  assert.deepEqual(r.calls, [], 'a status was written for a delivery that never landed');
});
