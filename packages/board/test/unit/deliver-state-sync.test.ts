// `plot-deliver.mjs`'s sync PR call against a real repository. The scripts
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

describe('a delivery asks for the sync PR as the command caller', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** Delivers one plan through a copied script set whose `board/plot-state-sync.mjs` records its arguments and exits as `stub` says. */
  const deliver = async (stubBody: string): Promise<{ code: number; out: string; err: string; calls: string[] }> => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-deliver-sync-')));
    roots.push(root);
    const scripts = path.join(root, 'scripts');
    const marker = path.join(root, 'sync.calls');
    cpSync(SCRIPT_DIR, scripts, { recursive: true, dereference: true });
    for (const name of ['plot-plan-state.sh', 'plot-issue-status.sh']) {
      const file = path.join(scripts, name);
      writeFileSync(file, '#!/usr/bin/env bash\necho "summary: tracker=none"\n');
      chmodSync(file, 0o755);
    }
    // Where `build.mjs` ships the bundle: `skills/plot/scripts/board/`.
    const sync = path.join(scripts, 'board', 'plot-state-sync.mjs');
    mkdirSync(path.dirname(sync), { recursive: true });
    rmSync(sync, { force: true });
    writeFileSync(sync, `import { appendFileSync } from 'node:fs';\nappendFileSync('${marker}', process.argv.slice(2).join(' ') + '\\n');\n${stubBody}\n`);

    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 't');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'commit.gpgsign', 'false');
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
    return { code, out: out.join(''), err: err.join(''), calls };
  };

  it('calls the entry once with --pr --caller command and prints what it said', async () => {
    const r = await deliver(`process.stdout.write('{"done":"opened","url":"https://host/pr/9"}\\n');`);
    expect(r.code, r.err).toBe(0);
    expect(r.calls).toEqual(['--pr --caller command']);
    expect(r.out).toContain('  state-sync: {"done":"opened","url":"https://host/pr/9"}\n');
  }, 60_000);

  it('prints nothing where no key is declared (exit 4)', async () => {
    const r = await deliver('process.exit(4);');
    expect(r.code, r.err).toBe(0);
    expect(r.out).not.toContain('state-sync');
    expect(r.err).not.toContain('state-sync');
  }, 60_000);

  it('warns on a failed pass and the delivery stands', async () => {
    const r = await deliver(`process.stderr.write('boom\\n'); process.exit(1);`);
    expect(r.code, r.err).toBe(0);
    expect(r.err).toContain('state-sync did not complete (exit 1): boom');
    expect(r.out).toMatch(/ push=clean /);
  }, 60_000);
});
