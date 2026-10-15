// The retry loop against a real repository: a bare `origin`, a clone holding
// the booking worktree, and a second clone that moves `main` while the first
// push is under way. Real `treesGit`, real `plot-push-main.sh`, real
// `plot-plan-meta.sh` — the push is rejected by git, not by a stub.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { Scripts } from '@plot-pm/domain';
import { commitAndPush, Refused, type LadderContext } from '../../src/server/entry/ladder.js';
import { bookDelivery, bookRelease, type DeliveryBooking } from '../../src/server/entry/deliver.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const PLAN = 'docs/plans/2026-10-01-p.md';
const noWait = async (): Promise<void> => {};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const planText = (status: string): string =>
  `# P\n\n## Status\n\n${status}\n\n## Notes\n\n- one\n`;

describe('commitAndPush against a real remote that moves during the first push', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /**
   * A repository whose `origin` holds `main` with the plan, a booking worktree
   * on `book` cut from `origin/main`, and a `move` that pushes a commit from a
   * second clone. `scripts` runs the real `plot-push-main.sh`, and calls
   * `move` before the first push so that push is rejected.
   */
  const estate = (status: string, move: (other: string) => void) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-ladder-real-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    const other = path.join(root, 'other');
    const wt = path.join(root, 'wt');
    const hooks = path.join(root, 'hooks');
    mkdirSync(hooks);
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'core.hooksPath', hooks);
    git(repo, 'config', 'user.email', 't@t');
    mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
    writeFileSync(path.join(repo, PLAN), planText(status));
    symlinkSync('../2026-10-01-p.md', path.join(repo, 'docs/plans/active/p.md'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    git(root, 'clone', '-q', origin, other);
    git(other, 'config', 'core.hooksPath', hooks);

    const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
    const trees = treesGit(context);
    const real = scriptsShell(context);
    let moved = false;
    const scripts: Scripts = {
      ...real,
      awaited: async (script, args, options) => {
        if (script === 'plot-push-main.sh' && !moved) {
          moved = true;
          move(other);
        }
        return real.awaited(script, args, options);
      },
    };
    const ctx: LadderContext & { planStore: ReturnType<typeof planStoreShell> } = {
      repoRoot: repo,
      scripts,
      trees,
      planStore: planStoreShell(context),
    };
    return { repo, origin, other, wt, ctx };
  };

  /** Appends a line under `## Notes` on `main` from the second clone. */
  const appendNote = (other: string): void => {
    const file = path.join(other, PLAN);
    writeFileSync(file, `${readFileSync(file, 'utf8')}- moved on main\n`);
    git(other, 'commit', '-q', '-am', 'move main');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
  };

  const onMain = (repo: string, file: string): string => git(repo, 'show', `origin/main:${file}`);

  it('re-cuts the booking branch in place and lands the write on the second attempt', async () => {
    const { repo, wt, ctx } = estate('- **State:** Approved', appendNote);
    expect((await ctx.trees.addBranch(wt, 'book', 'origin/main')).ok).toBe(true);
    const reapply = async (at: string): Promise<void> => {
      writeFileSync(path.join(at, 'ours.md'), `${git(at, 'rev-parse', 'HEAD').trim()}\n`);
      await ctx.trees.stage(at, ['ours.md']);
    };
    await reapply(wt);
    const lines: string[] = [];

    const result = await commitAndPush(ctx, wt, 'book', 'main', 'jw', 'plot: test', 'delivery', 'nothing', reapply, (s) => lines.push(s), 5, noWait);

    expect(result).toEqual({ pushed: 'clean' });
    const out = lines.join('');
    expect(out).toContain('push: rejected');
    expect(out).toContain('step: push rejected — retrying (attempt 1 of 5)');
    expect(out).not.toContain('retry stopped');
    git(repo, 'fetch', '-q', 'origin', 'main');
    expect(onMain(repo, PLAN)).toContain('- moved on main\n');
    // The write was re-applied on the moved base: `ours.md` names the commit
    // the retry was cut from, which is main's moved tip, not the first base.
    expect(onMain(repo, 'ours.md').trim()).toBe(git(repo, 'rev-parse', 'origin/main~1').trim());
    expect(git(repo, 'log', '-1', '--format=%s%n%an', 'origin/main')).toBe('plot: test\njw\n');
  });

  it('delivers from the plan text main holds after the move: the retried commit keeps the flip, the record and the moved line', async () => {
    const { repo, wt, ctx } = estate('- **State:** Approved\n- **Approved:** 2026-10-01 by jw', appendNote);
    expect((await ctx.trees.addBranch(wt, 'plot/deliver-p', 'origin/main')).ok).toBe(true);
    const booking: DeliveryBooking = {
      rel: PLAN,
      slug: 'p',
      today: '2026-10-15',
      activeDir: 'docs/plans/active/',
      deliveredDir: 'docs/plans/delivered/',
      sprintDir: 'docs/sprints/',
      sprint: '',
    };
    const first = await bookDelivery(ctx, wt, booking);
    expect(first).toEqual({ phase: 'flipped', record: 'written', index: 'moved', sprint: 'none' });
    let report = first;
    const reapply = async (at: string): Promise<void> => {
      const again = await bookDelivery(ctx, at, booking);
      if ('refused' in again) throw new Refused(again.refused);
      report = again;
    };
    const lines: string[] = [];

    const result = await commitAndPush(ctx, wt, 'plot/deliver-p', 'main', 'jw', 'plot: deliver p', 'delivery', 'nothing', reapply, (s) => lines.push(s), 5, noWait);

    expect(result).toEqual({ pushed: 'clean' });
    expect(lines.join('')).toContain('step: push rejected — retrying (attempt 1 of 5)');
    expect(report).toEqual({ phase: 'flipped', record: 'written', index: 'moved', sprint: 'none' });
    git(repo, 'fetch', '-q', 'origin', 'main');
    const landed = onMain(repo, PLAN);
    expect(landed).toContain('- **State:** Delivered\n');
    expect(landed).toMatch(/- \*\*Delivered:\*\* 2026-10-15/);
    expect(landed).toContain('- moved on main\n');
    expect(git(repo, 'ls-tree', '--name-only', 'origin/main', 'docs/plans/delivered/p.md').trim()).toBe('docs/plans/delivered/p.md');
    expect(git(repo, 'ls-tree', '--name-only', 'origin/main', 'docs/plans/active/p.md').trim()).toBe('');
  });

  it('releases from the plan text main holds after the move', async () => {
    const { repo, wt, ctx } = estate('- **State:** Delivered\n- **Delivered:** 2026-10-02', appendNote);
    expect((await ctx.trees.addBranch(wt, 'plot/release-p', 'origin/main')).ok).toBe(true);
    const booking = { rel: PLAN, slug: 'p', tagDate: '2026-10-10', tag: 'v1.2.3' };
    const first = await bookRelease(ctx, wt, booking);
    expect(first).toEqual({ phase: 'flipped', record: 'written' });
    const reapply = async (at: string): Promise<void> => {
      const again = await bookRelease(ctx, at, booking);
      if ('refused' in again) throw new Refused(again.refused);
    };

    const result = await commitAndPush(ctx, wt, 'plot/release-p', 'main', 'jw', 'plot: release p (v1.2.3)', 'release', 'nothing', reapply, () => {}, 5, noWait);

    expect(result).toEqual({ pushed: 'clean' });
    git(repo, 'fetch', '-q', 'origin', 'main');
    const landed = onMain(repo, PLAN);
    expect(landed).toContain('- **State:** Released\n');
    expect(landed).toMatch(/- \*\*Released:\*\* 2026-10-10, v1\.2\.3/);
    expect(landed).toContain('- moved on main\n');
  });

  it('answers nothing-to-commit where main delivered the plan in between', async () => {
    const deliverOnMain = (other: string): void => {
      const file = path.join(other, PLAN);
      writeFileSync(file, readFileSync(file, 'utf8').replace('- **State:** Approved', '- **State:** Delivered\n- **Delivered:** 2026-10-14'));
      mkdirSync(path.join(other, 'docs/plans/delivered'), { recursive: true });
      symlinkSync('../2026-10-01-p.md', path.join(other, 'docs/plans/delivered/p.md'));
      git(other, 'rm', '-q', 'docs/plans/active/p.md');
      git(other, 'add', '-A');
      git(other, 'commit', '-q', '-m', 'delivered elsewhere');
      git(other, 'push', '-q', 'origin', 'HEAD:main');
    };
    const { wt, ctx } = estate('- **State:** Approved\n- **Approved:** 2026-10-01 by jw', deliverOnMain);
    expect((await ctx.trees.addBranch(wt, 'plot/deliver-p', 'origin/main')).ok).toBe(true);
    const booking: DeliveryBooking = {
      rel: PLAN,
      slug: 'p',
      today: '2026-10-15',
      activeDir: 'docs/plans/active/',
      deliveredDir: 'docs/plans/delivered/',
      sprintDir: 'docs/sprints/',
      sprint: '',
    };
    await bookDelivery(ctx, wt, booking);
    let report: unknown;
    const reapply = async (at: string): Promise<void> => {
      report = await bookDelivery(ctx, at, booking);
    };
    const lines: string[] = [];

    const result = await commitAndPush(ctx, wt, 'plot/deliver-p', 'main', 'jw', 'plot: deliver p', 'delivery', 'already delivered', reapply, (s) => lines.push(s), 5, noWait);

    expect(result).toEqual({ pushed: 'nothing-to-commit' });
    expect(report).toEqual({ phase: 'already', record: 'already', index: 'already', sprint: 'none' });
    expect(lines.join('')).toContain('step: already delivered\n');
  });

  it('names the step and propagates the refusal where the re-fetched plan cannot be delivered', async () => {
    const releaseOnMain = (other: string): void => {
      const file = path.join(other, PLAN);
      writeFileSync(file, readFileSync(file, 'utf8').replace('- **State:** Approved', '- **State:** Released'));
      git(other, 'commit', '-q', '-am', 'released elsewhere');
      git(other, 'push', '-q', 'origin', 'HEAD:main');
    };
    const { wt, ctx } = estate('- **State:** Approved\n- **Approved:** 2026-10-01 by jw', releaseOnMain);
    expect((await ctx.trees.addBranch(wt, 'plot/deliver-p', 'origin/main')).ok).toBe(true);
    const booking: DeliveryBooking = {
      rel: PLAN,
      slug: 'p',
      today: '2026-10-15',
      activeDir: 'docs/plans/active/',
      deliveredDir: 'docs/plans/delivered/',
      sprintDir: 'docs/sprints/',
      sprint: '',
    };
    await bookDelivery(ctx, wt, booking);
    const reapply = async (at: string): Promise<void> => {
      const again = await bookDelivery(ctx, at, booking);
      if ('refused' in again) throw new Refused(again.refused);
    };
    const lines: string[] = [];

    await expect(
      commitAndPush(ctx, wt, 'plot/deliver-p', 'main', 'jw', 'plot: deliver p', 'delivery', 'nothing', reapply, (s) => lines.push(s), 5, noWait),
    ).rejects.toThrow(/already released/);
    expect(lines.join('')).toContain('step: retry stopped — re-applying the delivery to origin/main failed\n');
  });
});
