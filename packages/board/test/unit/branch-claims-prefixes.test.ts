// The callers of `branchClaims` pass the repository's `Branch prefixes`:
// `plot-deliver --release` (deliver.ts), `plot-slice-claims.mjs`,
// `plot-release-chain.mjs release` and the sprint-member writer.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { answered, type Host, type PrIndexStore } from '@plot-pm/domain';
import { runRelease, type Args, type Context } from '../../src/server/entry/deliver.js';
import { resolvePlanRelease, type ReleasePorts } from '../../src/server/entry/release-chain.js';
import { run as sliceClaims } from '../../src/server/entry/slice-claims.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const slices = (...lines: string[]): string =>
  ['# P', '', '## Status', '', '- **State:** Delivered', '- **Type:** bug', '', '## Slices', '', '### One', '', ...lines, '', '### Tests', '', '- `skills/plot-fleet/SKILL.md`', ''].join('\n');

describe('plot-slice-claims', () => {
  it('reads a list line under the prefixes it is given and ignores a file path', () => {
    let out = '';
    sliceClaims(slices('- `zz/x` — work → #7'), (s) => (out += s), ['zz']);
    expect(out).toBe('#7\tzz/x\n');
  });

  it('reads the default prefixes when none are given', () => {
    let out = '';
    sliceClaims(slices('- `bug/x` — work → #7', '- `zz/y` — work → #8'), (s) => (out += s));
    expect(out).toBe('#7\tbug/x\n');
  });
});

describe('plot-release-chain release', () => {
  const planFor = (text: string): ReleasePorts => {
    const asked: number[] = [];
    return {
      planStore: { readPlan: async () => ({ ok: false }), readText: async () => answered(text) },
      host: {
        prState: async (n: number) => {
          asked.push(n);
          return { ok: false };
        },
        prMergeDests: async () => ({ ok: false }),
        lastRefusal: () => null,
      },
      refs: { contains: async () => answered('unknown' as const), tagsContaining: async () => ({ ok: false }) },
    } as unknown as ReleasePorts;
  };
  const input = { planFile: 'p.md', defaultBranch: 'main', prSource: '', noFetch: true };

  it('answers none for a plan whose only list line is a file path', async () => {
    expect(await resolvePlanRelease(input, planFor(slices()), () => {})).toBe('none');
  });

  it('reads claims under the prefixes it is given', async () => {
    const text = slices('- `zz/x` — work → #7');
    expect(await resolvePlanRelease(input, planFor(text), () => {})).toBe('none');
    expect(await resolvePlanRelease({ ...input, branchPrefixes: ['zz'] }, planFor(text), () => {})).not.toBe('none');
  });
});

describe('plot-deliver --release', () => {
  const roots: string[] = [];
  let previousUnattended: string | undefined;
  beforeEach(() => {
    previousUnattended = process.env.PLOT_UNATTENDED;
    delete process.env.PLOT_UNATTENDED;
  });
  afterEach(() => {
    if (previousUnattended === undefined) delete process.env.PLOT_UNATTENDED;
    else process.env.PLOT_UNATTENDED = previousUnattended;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const release = async (config: string, claim: string): Promise<{ code: number; out: string }> => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-claim-prefixes-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 't@t');
    mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
    writeFileSync(path.join(repo, 'CLAUDE.md'), `# R\n\n## Plot Config\n\n${config}`);
    writeFileSync(path.join(repo, 'docs/plans/2026-10-01-solo.md'), slices(claim));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    const headSha = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'tag', 'v2.0.0', headSha);
    const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
    const realScripts = scriptsShell(context);
    const scripts = {
      ...realScripts,
      awaited: async (script: string, args: readonly string[], options?: unknown) =>
        script === 'plot-issue-status.sh' || script === 'plot-plan-state.sh'
          ? { stdout: 'summary: tracker=none\n', stderr: '', code: 0 }
          : realScripts.awaited(script, args, options as never),
    };
    const ctx: Context = {
      repoRoot: repo,
      scriptDir: SCRIPT_DIR,
      refs: refsGit(context),
      host: { prState: async () => answered({ mergeCommit: headSha }) } as unknown as Host,
      planStore: planStoreShell(context),
      scripts: scripts as Context['scripts'],
      trees: treesGit(context),
      prIndex: {} as unknown as PrIndexStore,
    };
    const out: string[] = [];
    const args: Args = { dryRun: false, who: 'jw', releaseVersion: 'v2.0.0', slug: 'solo' };
    const code = await runRelease(ctx, args, 'docs/plans/2026-10-01-solo.md', (s) => out.push(s), (s) => out.push(s));
    return { code, out: out.join('') };
  };

  it('does not read a file-list line as a branch', async () => {
    const { code, out } = await release('', '- `bug/solo` — the fix → #201');
    expect(out).not.toMatch(/names no/);
    expect(code, out).toBe(0);
  }, 60_000);

  it('reads the configured Branch prefixes', async () => {
    const claim = '- `zz/solo` — the fix → #201';
    const configured = await release('- **Branch prefixes:** zz/\n', claim);
    expect(configured.code, configured.out).toBe(0);
    await expect(release('', claim)).rejects.toThrow(/names no/);
  }, 120_000);
});
