import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { refsFixture } from '@plot-pm/domain/adapters';
import type { TreeBlob } from '@plot-pm/domain/ports/refs';

import { buildBoard } from '../../src/server/board.js';
import { type Card } from '../../src/contract/schema.js';
import { rmTree } from '../helpers.mjs';

/**
 * THE BRANCH-PLAN CACHE TRACKS THE DEFAULT BRANCH, NOT ONLY THE PREFIXED
 * BRANCHES' TIPS (#2410).
 *
 * `collectBranchPlans` keys its cache on the prefixed branches' `branch@sha`
 * pairs. A merge that lands a plan file on the default branch moves none of
 * those tips — the idea branch's tip is untouched — so the OLD key kept
 * matching after the merge, and the cache went on serving the list computed
 * while that file was still absent from `origin/<default>`. The default-branch
 * reader then supplied the same path a second time: two cards, one slug.
 *
 * Each case here builds its board with a REAL `CLAUDE.md` on disk (so
 * `readConfigAsync` reads genuine config) and a fixture `Refs` (so the git
 * answers — tips, trees, blobs, ancestry — come from a table instead of a
 * subprocess). `repoRoot` is passed to the fixture too: `prefixedBranches`
 * refuses to use a reader that cannot confirm it is reading the SAME
 * repository the board was pointed at, comparing `fs.realpathSync` on both.
 *
 * The last case is a MEASUREMENT rather than a regression test — see its own
 * comment for the brief's Open Question 3 (a plan renamed between the idea
 * branch and main).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');

const CLAUDE_MD = '# Fixture\n\n## Plot Config\n\n'
  + '- **Branch prefixes:** idea/\n'
  + '- **Plan directory:** docs/plans/\n'
  + '- **Main branch:** main\n';

const plan = (title: string, slug: string, branch: string): string => [
  `# ${title}`,
  '',
  '## Status',
  '- **Phase:** Draft',
  '- **Type:** bug',
  '',
  '## Branches',
  '',
  `- \`${branch}\` — ${slug}`,
  '',
].join('\n');

const PLAN_PATH = 'docs/plans/2026-10-23-the-fix.md';
const PLAN_CONTENT = plan('The fix', 'the-fix', 'idea/the-fix');
const IDEA_TIP = 'a'.repeat(40);
const MAIN_TIP_BEFORE = 'b'.repeat(40);
const MAIN_TIP_AFTER = 'c'.repeat(40);

const made: string[] = [];
const estate = (): { repoRoot: string; scriptsDir: string } => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-plan-cache-'));
  made.push(repoRoot);
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'CLAUDE.md'), CLAUDE_MD, 'utf8');
  return { repoRoot, scriptsDir: SCRIPTS_DIR };
};

const savedRoot = process.env.PLOT_REPO_ROOT;
afterEach(() => {
  if (savedRoot === undefined) delete process.env.PLOT_REPO_ROOT;
  else process.env.PLOT_REPO_ROOT = savedRoot;
  for (const dir of made.splice(0)) rmTree(dir);
});

const blob = (path: string, sha: string): TreeBlob => ({ mode: '100644', sha, path });

const cardsOf = (board: { columns: readonly { cards: readonly Card[] }[] }): readonly Card[] =>
  board.columns.flatMap((c) => c.cards);

describe('the branch-plan cache keys on the default branch tip, not only the idea branches\'', () => {
  it('a merge that adds the plan to main is not hidden by a cache warmed before it (#2410)', async () => {
    const opts = estate();
    process.env.PLOT_REPO_ROOT = opts.repoRoot;

    // BEFORE the merge: main carries nothing, idea/the-fix carries the plan.
    // Warming the cache here is the point — the bug only shows on the SECOND
    // read, against a cache the first read already filled.
    const before = await buildBoard({
      ...opts,
      refs: refsFixture({
        repoRoot: opts.repoRoot,
        shas: { 'origin/main^{commit}': MAIN_TIP_BEFORE, 'origin/main': MAIN_TIP_BEFORE },
        tips: { 'idea/the-fix': IDEA_TIP },
        trees: {
          'origin/main': [],
          'origin/idea/the-fix': [blob(PLAN_PATH, 'sha-plan')],
        },
        blobs: { 'sha-plan': PLAN_CONTENT },
        files: { [`origin/idea/the-fix:${PLAN_PATH}`]: PLAN_CONTENT },
        ancestry: { 'origin/idea/the-fix origin/main': 'no' },
      }),
    });
    expect(cardsOf(before).filter((c) => c.slug === 'the-fix')).toHaveLength(1);

    // AFTER the merge: main now carries the plan file too (new tip), while
    // idea/the-fix keeps the SAME tip — a merge commit advances main; it does
    // not touch the branch it merged. The unfixed cache key, built only from
    // `idea/the-fix`'s tip, would be unchanged and would keep serving the
    // pre-merge list, so the default-branch reader's copy would join it as a
    // second card for the same path.
    const after = await buildBoard({
      ...opts,
      refs: refsFixture({
        repoRoot: opts.repoRoot,
        shas: { 'origin/main^{commit}': MAIN_TIP_AFTER, 'origin/main': MAIN_TIP_AFTER },
        tips: { 'idea/the-fix': IDEA_TIP },
        trees: {
          'origin/main': [blob(PLAN_PATH, 'sha-plan')],
          'origin/idea/the-fix': [blob(PLAN_PATH, 'sha-plan')],
        },
        blobs: { 'sha-plan': PLAN_CONTENT },
        files: {
          [`origin/main:${PLAN_PATH}`]: PLAN_CONTENT,
          [`origin/idea/the-fix:${PLAN_PATH}`]: PLAN_CONTENT,
        },
        ancestry: { 'origin/idea/the-fix origin/main': 'no' },
      }),
    });
    expect(cardsOf(after).filter((c) => c.slug === 'the-fix')).toHaveLength(1);
  });

  it('a branch still ahead of main — not merged, not contained — still shows one card', async () => {
    const opts = estate();
    process.env.PLOT_REPO_ROOT = opts.repoRoot;

    const board = await buildBoard({
      ...opts,
      refs: refsFixture({
        repoRoot: opts.repoRoot,
        shas: { 'origin/main^{commit}': MAIN_TIP_BEFORE, 'origin/main': MAIN_TIP_BEFORE },
        tips: { 'idea/the-fix': IDEA_TIP },
        trees: {
          'origin/main': [],
          'origin/idea/the-fix': [blob(PLAN_PATH, 'sha-plan')],
        },
        blobs: { 'sha-plan': PLAN_CONTENT },
        files: { [`origin/idea/the-fix:${PLAN_PATH}`]: PLAN_CONTENT },
        // Still open: `contains` answers `no`, and the path rule is what must
        // keep the card rather than a prefilter that assumes every open
        // branch is irrelevant.
        ancestry: { 'origin/idea/the-fix origin/main': 'no' },
      }),
    });
    expect(cardsOf(board).filter((c) => c.slug === 'the-fix')).toHaveLength(1);
  });

  it('a squash-merged branch — path already on main, tip never contained — still shows one card', async () => {
    const opts = estate();
    process.env.PLOT_REPO_ROOT = opts.repoRoot;

    const board = await buildBoard({
      ...opts,
      refs: refsFixture({
        repoRoot: opts.repoRoot,
        shas: { 'origin/main^{commit}': MAIN_TIP_AFTER, 'origin/main': MAIN_TIP_AFTER },
        tips: { 'idea/the-fix': IDEA_TIP },
        trees: {
          // The squash commit carries the file on main; the source branch's
          // tip is not an ancestor of main and never becomes one.
          'origin/main': [blob(PLAN_PATH, 'sha-plan')],
          'origin/idea/the-fix': [blob(PLAN_PATH, 'sha-plan')],
        },
        blobs: { 'sha-plan': PLAN_CONTENT },
        files: {
          [`origin/main:${PLAN_PATH}`]: PLAN_CONTENT,
          [`origin/idea/the-fix:${PLAN_PATH}`]: PLAN_CONTENT,
        },
        // A squash rewrites the commit, so ancestry stays `no` forever even
        // though the branch's work landed — this is exactly why the path rule
        // (`onDefault`), not ancestry, is what must drop the second copy.
        ancestry: { 'origin/idea/the-fix origin/main': 'no' },
      }),
    });
    expect(cardsOf(board).filter((c) => c.slug === 'the-fix')).toHaveLength(1);
  });

  it('`unknown` containment keeps the branch — an ancestry failure must not read as merged', async () => {
    const opts = estate();
    process.env.PLOT_REPO_ROOT = opts.repoRoot;

    const board = await buildBoard({
      ...opts,
      refs: refsFixture({
        repoRoot: opts.repoRoot,
        shas: { 'origin/main^{commit}': MAIN_TIP_BEFORE, 'origin/main': MAIN_TIP_BEFORE },
        tips: { 'idea/the-fix': IDEA_TIP },
        trees: {
          'origin/main': [],
          'origin/idea/the-fix': [blob(PLAN_PATH, 'sha-plan')],
        },
        blobs: { 'sha-plan': PLAN_CONTENT },
        files: { [`origin/idea/the-fix:${PLAN_PATH}`]: PLAN_CONTENT },
        // No entry for this pair: the fixture's `ancestry` table reads
        // `unknown` for anything absent, matching a real `merge-base` call
        // that could not resolve one of the two revisions.
        ancestry: {},
      }),
    });
    expect(cardsOf(board).filter((c) => c.slug === 'the-fix')).toHaveLength(1);
  });

  // MEASUREMENT, NOT A REGRESSION TEST — the brief's Open Question 3: can a
  // rename between the idea branch and main produce two cards for one plan?
  // Both de-dup guards (`readBranchPlans`'s `onDefault`, and `planSourcePaths`
  // in `buildBoard`) key on PATH, with no fallback to any other identity.
  // `planSlug` ALSO reads the filename (`YYYY-MM-DD-<slug>.md`), so a rename
  // changes the slug too — this is not "one slug rendered twice" but its
  // precondition: two cards for one plan, under two DIFFERENT slugs, neither
  // guard able to see they are the same content. Recorded here rather than
  // assumed: a slug key keyed on the FILENAME would not have caught this
  // either, since the filenames genuinely differ. Fixing the renamed case
  // would need an in-content identity (e.g. the plan's own `## Branches`
  // heading), which is new scope — recorded in the plan's Open Questions
  // rather than implemented on this branch.
  it('[measurement] a plan renamed between the idea branch and main renders as two cards', async () => {
    const opts = estate();
    process.env.PLOT_REPO_ROOT = opts.repoRoot;

    const oldPath = 'docs/plans/2026-10-20-the-fix.md';
    const newPath = 'docs/plans/2026-10-20-the-fix-renamed.md';
    const content = plan('The fix', 'the-fix', 'idea/the-fix');

    const board = await buildBoard({
      ...opts,
      refs: refsFixture({
        repoRoot: opts.repoRoot,
        shas: { 'origin/main^{commit}': MAIN_TIP_AFTER, 'origin/main': MAIN_TIP_AFTER },
        tips: { 'idea/the-fix': IDEA_TIP },
        trees: {
          // Main has the RENAMED path (the merge commit renamed the file);
          // the idea branch still carries its OWN, pre-rename path — exactly
          // what a `git mv` folded into the merge commit produces.
          'origin/main': [blob(newPath, 'sha-new')],
          'origin/idea/the-fix': [blob(oldPath, 'sha-old')],
        },
        blobs: { 'sha-new': content, 'sha-old': content },
        files: {
          [`origin/main:${newPath}`]: content,
          [`origin/idea/the-fix:${oldPath}`]: content,
        },
        // Squash or ordinary merge, either way ancestry stays `no` — matching
        // the squash-merge case above; the rename, not the merge shape, is
        // what this probes.
        ancestry: { 'origin/idea/the-fix origin/main': 'no' },
      }),
    });
    // `planSlug` cuts the slug from the FILENAME (`YYYY-MM-DD-<slug>.md`), so
    // renaming the file changes the slug too — "the-fix" becomes
    // "the-fix-renamed". The measurement is therefore not "one slug, two
    // cards" but THE PRECONDITION FOR IT: nothing here reads the plan's OWN
    // `## Branches` heading or any in-content identity to recognise the two
    // paths as the same plan, so two cards render under two different slugs
    // for what is, by content, one plan.
    expect(cardsOf(board).map((c) => c.path).sort()).toEqual([
      'docs/plans/2026-10-20-the-fix-renamed.md',
      'docs/plans/2026-10-20-the-fix.md',
    ]);
  });
});
