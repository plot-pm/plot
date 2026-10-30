// The `--release` arm's caller gate: `PLOT_UNATTENDED=1` must refuse before
// any host/PR work, mapped to 'unattended' and never to 'fleetd' — the one
// release entrance the brief names that calls the domain `release()` workflow
// directly (`POST /api/release` only spawns this same script).
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/server/entry/deliver.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const PLAN = 'docs/plans/2026-10-01-p.md';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

describe('the release entry maps PLOT_UNATTENDED to the caller', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const repoWithDeliveredPlan = (): string => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-release-unattended-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 't@t');
    mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
    writeFileSync(
      path.join(repo, PLAN),
      '# P\n\n## Status\n\n- **State:** Delivered\n- **Delivered:** 2026-10-02\n\n## Notes\n\n- one\n',
    );
    symlinkSync('../2026-10-01-p.md', path.join(repo, 'docs/plans/active/p.md'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    return repo;
  };

  it('PLOT_UNATTENDED=1 with no caller override refuses as unattended, never as fleetd, before any host call', async () => {
    const repo = repoWithDeliveredPlan();
    const out: string[] = [];
    const err: string[] = [];
    const previous = process.env.PLOT_UNATTENDED;
    process.env.PLOT_UNATTENDED = '1';
    let code: number;
    try {
      code = await run(['--release', '1.0.0', 'p'], repo, SCRIPT_DIR, (s) => out.push(s), (s) => err.push(s));
    } finally {
      if (previous === undefined) delete process.env.PLOT_UNATTENDED;
      else process.env.PLOT_UNATTENDED = previous;
    }
    const said = `${out.join('')}\n--- stderr ---\n${err.join('')}`;
    expect(code, said).toBe(1);
    expect(err.join('')).toContain('plot-deliver: unattended:');
  });
});
