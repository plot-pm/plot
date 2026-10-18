// `plot-deliver.mjs`'s plan-state write against a real repository. The scripts
// are COPIED, never linked, and `plot-plan-state.sh` and `plot-issue-status.sh`
// are replaced by stubs in the copy: a `>` onto a symlink would write through
// into the real script, and the tracker is the one thing this test does not reach.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/server/entry/deliver.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const PLAN = 'docs/plans/2026-10-17-p.md';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

describe('a delivery reports its plan-state write', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /**
   * Delivers one plan through a copied script set whose `plot-plan-state.sh`
   * records its arguments and the plan's `State:` line, then answers as `stub` says.
   */
  const deliver = async (stub: string): Promise<{ code: number; said: string; calls: string[]; repo: string }> => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-deliver-plan-state-')));
    roots.push(root);
    const scripts = path.join(root, 'scripts');
    const marker = path.join(root, 'plan-state.calls');
    cpSync(SCRIPT_DIR, scripts, { recursive: true, dereference: true });
    const planState = path.join(scripts, 'plot-plan-state.sh');
    writeFileSync(
      planState,
      ['#!/usr/bin/env bash', `{ printf '%s\\n' "$*"; grep -m1 'State:' "$1"; } >> '${marker}'`, stub, ''].join('\n'),
    );
    chmodSync(planState, 0o755);
    const issueStatus = path.join(scripts, 'plot-issue-status.sh');
    writeFileSync(issueStatus, '#!/usr/bin/env bash\necho "summary: tracker=none"\n');
    chmodSync(issueStatus, 0o755);

    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
    writeFileSync(path.join(repo, PLAN), '# P\n\n## Status\n\n- **State:** Approved\n- **Approved:** 2026-10-17 by jw\n- **Issue:** #7\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');

    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['--who', 'jw', 'p'], repo, scripts, (s) => out.push(s), (s) => err.push(s));
    const calls = existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n') : [];
    return { code, said: `${out.join('')}\n--- stderr ---\n${err.join('')}`, calls, repo };
  };

  it('hands the write the delivered plan and the plan path, and reports written', async () => {
    const r = await deliver(`printf '#7\\twritten\\tdelivered\\nsummary: tracker=written\\n'`);
    expect(r.code, r.said).toBe(0);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]).toMatch(new RegExp(` --phase delivered --plan-link ${PLAN}$`));
    expect(r.calls[1]).toBe('- **State:** Delivered');
    expect(r.said).toContain('  plan-state: #7\twritten\tdelivered\n');
    expect(r.said).toMatch(/ push=clean plan-state=written tracker=none\n/);
  }, 60_000);

  it('reports a write that exits 2 as failed, with its reason, and the delivery stands', async () => {
    const r = await deliver(`echo "plot-plan-state: cannot parse it" >&2; echo "summary: tracker=failed"; exit 2`);
    expect(r.code, r.said).toBe(0);
    expect(r.said).toContain('  plan-state: plot-plan-state: cannot parse it\n');
    expect(r.said).toMatch(/ push=clean plan-state=failed tracker=none\n/);
    git(r.repo, 'fetch', '-q', 'origin', 'main');
    expect(git(r.repo, 'show', `origin/main:${PLAN}`)).toContain('- **State:** Delivered');
  }, 60_000);
});
