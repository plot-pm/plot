import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FleetReadingSchema } from '@plot-pm/domain/entities/fleet';
import type { FleetReading } from '@plot-pm/domain';
import { restartBranch, type RestartReaders } from '../../src/shared/restart-command.js';
import { deskFromOrigin } from '../../src/shared/origin-desk.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// A restart of a claimed branch whose work exists only on origin: a real bare
// origin, a main checkout cloned from it, and no desk on this machine.

const scriptDir = path.resolve(__dirname, '../../../../skills/plot/scripts');
const monitors = { stop: () => ({ ok: true }) } as never;
const branch = 'feature/origin-only';

const pulseOf = (name: string): FleetReading =>
  FleetReadingSchema.parse({
    main: 'main',
    head: 'abc',
    fetch_failed: false,
    summary: { plans: 1, waves: 1, branches: 1, claimed: 1, eligible: 0, blocked: 0, deferred: 0 },
    plans: [{ file: 'docs/plans/p.md', phase: 'Approved', slices: [{ name: 'S', verdict: 'eligible', branches: [{ branch: name, local_worktree: '', worker: 'elsewhere', worker_pid: '', state: 'wip', deferred: false, claimed: '' }] }] }],
  });

const planText = (sprint: string): string =>
  [
    '# Origin only',
    '',
    '## Status',
    '',
    '- **State:** Approved',
    '- **Type:** feature',
    `- **Sprint:** ${sprint}`,
    '',
    '## Slices',
    '',
    '### Wave 1',
    '',
    `- \`${branch}\` — the slice`,
    '',
  ].join('\n');

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], { encoding: 'utf8' }).trim();

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmTree(d);
});

/**
 * A bare origin, a main checkout cloned from it, and `branch` on origin
 * carrying a claim commit and one commit of work. With `sprint`, the plan
 * lives only on `sprint/<sprint>` and the branch is cut from it.
 */
const fixture = (sprint: string) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-restart-origin-')));
  dirs.push(root);
  const bare = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const repo = path.join(root, 'repo');
  const manifests = path.join(root, 'manifests');
  const desks = path.join(root, 'desks');
  fs.mkdirSync(manifests);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  git(seed, 'remote', 'add', 'origin', bare);
  fs.writeFileSync(path.join(seed, 'README.md'), 'trunk\n');
  fs.mkdirSync(path.join(seed, 'docs/plans'), { recursive: true });
  const plan = 'docs/plans/2026-11-12-origin-only.md';
  if (sprint === '') fs.writeFileSync(path.join(seed, plan), planText(''));
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'trunk');
  git(seed, 'push', '-q', 'origin', 'main');
  let baseRef = 'main';
  if (sprint !== '') {
    git(seed, 'checkout', '-qb', `sprint/${sprint}`);
    fs.writeFileSync(path.join(seed, plan), planText(sprint));
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', `sprint: create ${sprint}`);
    git(seed, 'push', '-q', 'origin', `sprint/${sprint}`);
    baseRef = `sprint/${sprint}`;
  }
  git(seed, 'checkout', '-qb', branch, baseRef);
  git(seed, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
  fs.writeFileSync(path.join(seed, 'work.txt'), 'work\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'plot: the work');
  git(seed, 'push', '-q', 'origin', branch);
  const tip = git(seed, 'rev-parse', 'HEAD');
  execFileSync('git', ['clone', '-q', bare, repo], { stdio: 'ignore' });
  git(repo, 'remote', 'set-head', 'origin', 'main');
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    `## Plot Config\n\n- **Worker command:** true\n- **Agent registry:** ${manifests}\n- **Worktree root:** ${desks}\n- **Plan directory:** docs/plans/\n`,
  );
  return { repo, manifests, desks, tip };
};

const noPr = { prState: async () => ({ ok: true, value: null }), prMerged: async () => ({ ok: true, value: 'not-merged' }) } as never;
const freshDesk: RestartReaders = {
  pr: async () => ({ reachedReview: false, draft: false, number: 0, state: '' }),
  worker: async () => ({ state: 'none', pid: '', exitCode: '', activity: 'idle' }),
};

const restartFromOrigin = (repo: string, host: never = noPr, name = branch) =>
  restartBranch({
    opts: { repoRoot: repo, scriptsDir: scriptDir },
    pulse: pulseOf(name),
    branch: name,
    caller: 'person',
    readers: freshDesk,
    monitors,
    originDesk: (input) => deskFromOrigin({ ...input, host }),
  });

const manifestsIn = (dir: string): Record<string, unknown>[] =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, unknown>);

describe('the restart of a branch whose work exists only on origin', () => {
  it('cuts a desk at the origin tip of a sprint slice and records the sprint base in the manifest', async () => {
    const { repo, manifests, desks, tip } = fixture('s');
    const started = await restartFromOrigin(repo);
    expect(started.kind).toBe('started');
    const [desk] = fs.readdirSync(desks);
    expect(desk).toMatch(/^desk-[0-9a-f]{8}$/);
    const worktree = path.join(desks, desk!);
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(tip);
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(branch);
    expect(git(worktree, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe(`origin/${branch}`);
    const [manifest] = manifestsIn(manifests);
    expect(manifest).toMatchObject({ branch, worktree, base: 'sprint/s' });
  });

  it('records no base for a default-branch slice', async () => {
    const { repo, manifests, desks } = fixture('');
    const started = await restartFromOrigin(repo);
    expect(started.kind).toBe('started');
    expect(fs.readdirSync(desks)).toHaveLength(1);
    const [manifest] = manifestsIn(manifests);
    expect(manifest?.branch).toBe(branch);
    expect(manifest).not.toHaveProperty('base');
  });

  it('attaches an existing local branch that origin already contains', async () => {
    const { repo, desks, tip } = fixture('s');
    git(repo, 'fetch', '-q', 'origin', branch);
    git(repo, 'branch', '-q', '--no-track', branch, `origin/${branch}~1`);
    const started = await restartFromOrigin(repo);
    expect(started.kind).toBe('started');
    const [desk] = fs.readdirSync(desks);
    expect(git(path.join(desks, desk!), 'rev-parse', 'HEAD')).toBe(tip);
  });

  it('refuses local-unpushed where the local branch holds a commit origin lacks, and cuts no desk', async () => {
    const { repo, desks } = fixture('s');
    git(repo, 'fetch', '-q', 'origin', branch);
    git(repo, 'branch', '-q', branch, `origin/${branch}`);
    const side = path.join(path.dirname(repo), 'side');
    git(repo, 'worktree', 'add', '-q', side, branch);
    git(side, 'commit', '-q', '--allow-empty', '-m', 'unpushed');
    git(repo, 'worktree', 'remove', side);
    const out = await restartFromOrigin(repo);
    expect(out).toMatchObject({ kind: 'refused', reason: 'local-unpushed' });
    expect(fs.existsSync(desks)).toBe(false);
  });

  it('refuses reached-review for an open PR and cuts no desk', async () => {
    const { repo, desks } = fixture('s');
    const openPr = { prState: async () => ({ ok: true, value: { number: 4, state: 'OPEN', draft: false } }), prMerged: async () => ({ ok: true, value: 'not-merged' }) } as never;
    const out = await restartFromOrigin(repo, openPr);
    expect(out).toMatchObject({ kind: 'refused', reason: 'reached-review' });
    expect(fs.existsSync(desks)).toBe(false);
  });

  it('refuses pr-unanswerable where the host gives no answer, and cuts no desk', async () => {
    const { repo, desks } = fixture('s');
    const silent = { prState: async () => ({ ok: false, why: 'failed' }), prMerged: async () => ({ ok: true, value: 'unknown' }) } as never;
    const out = await restartFromOrigin(repo, silent);
    expect(out).toMatchObject({ kind: 'refused', reason: 'pr-unanswerable' });
    expect(fs.existsSync(desks)).toBe(false);
  });

  it('refuses no-worktree where origin holds no ref for the branch', async () => {
    const { repo } = fixture('s');
    const out = await restartFromOrigin(repo, noPr, 'feature/nowhere');
    expect(out).toMatchObject({ kind: 'refused', status: 404, reason: 'no-worktree' });
  });

  it('refuses an unattended caller and cuts no desk', async () => {
    const { repo, desks } = fixture('s');
    const out = await restartBranch({
      opts: { repoRoot: repo, scriptsDir: scriptDir },
      pulse: pulseOf(branch),
      branch,
      caller: 'unattended',
      readers: freshDesk,
      monitors,
      originDesk: (input) => deskFromOrigin({ ...input, host: noPr }),
    });
    expect(out).toMatchObject({ kind: 'refused', reason: 'unattended' });
    expect(fs.existsSync(desks)).toBe(false);
  });
});
