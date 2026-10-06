import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Estate } from './production.js';

/**
 * A sandbox estate for the corpus files that build the shape they test instead
 * of reading this repository.
 */

const REPO = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

/** One plan to write: its slug, its `State:` word and its one branch. */
export type SandboxPlan = readonly [slug: string, state: string, branch: string];

/** A sandbox checkout and the bare repository it pushes to. */
export interface Sandbox extends Estate {
  /** The bare repository `origin` points at. */
  upstream: string;
  /** The temporary directory holding both; remove it to clean up. */
  dir: string;
}

/**
 * Renders one plan file with one slice on one branch.
 *
 * @param slug - the plan's slug, also its title.
 * @param state - the `State:` word.
 * @param branch - the slice's branch.
 * @returns the file's text.
 */
export const planText = (slug: string, state: string, branch: string): string =>
  `# ${slug}\n\n## Status\n\n- **State:** ${state}\n- **Type:** feature\n- **Review:** pr\n`
  + `- **Impl:** own branches\n\n## Slices\n\n### The slice (Branch: ${branch})\n\n**Done when** merged.\n`;

/** The path a plan's file has, relative to the checkout. */
export const planPath = (slug: string): string => join('docs', 'plans', `2026-09-01-${slug}.md`);

/**
 * Runs git quietly and returns its stdout.
 *
 * @param cwd - the repository to run in.
 * @param args - the git arguments.
 * @returns stdout.
 */
export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * Builds a checkout carrying exactly the plans named, pushed to a bare
 * `origin` with `origin/HEAD` set to `main`.
 *
 * The checkout carries a copy of this repository's `skills/plot/scripts`,
 * because `production.ts` runs the estate's own scripts.
 *
 * @param plans - the plans to write.
 * @param prefix - the temporary directory's name prefix.
 * @returns the checkout, its upstream and the directory holding both.
 */
export const sandboxWith = (plans: ReadonlyArray<SandboxPlan>, prefix: string): Sandbox => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const upstream = join(dir, 'upstream');
  const work = join(dir, 'work');
  mkdirSync(upstream);
  mkdirSync(work);

  git(upstream, 'init', '-q', '--bare', '.');
  git(work, 'init', '-q', '.');
  git(work, 'remote', 'add', 'origin', upstream);
  git(work, 'config', 'user.email', 'corpus@example.invalid');
  git(work, 'config', 'user.name', 'Corpus');

  mkdirSync(join(work, 'docs', 'plans'), { recursive: true });
  cpSync(join(REPO, 'skills', 'plot', 'scripts'), join(work, 'skills', 'plot', 'scripts'), { recursive: true });
  writeFileSync(join(work, 'CLAUDE.md'),
    '# Sandbox\n\n## Plot Config\n\n- **Branch prefixes:** feature/\n- **Plan directory:** docs/plans/\n');
  for (const [slug, state, branch] of plans) {
    writeFileSync(join(work, planPath(slug)), planText(slug, state, branch));
  }
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'sandbox');
  git(work, 'branch', '-M', 'main');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  try {
    git(work, 'remote', 'set-head', 'origin', 'main');
  } catch {
    git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  }
  return { root: work, upstream, dir };
};
