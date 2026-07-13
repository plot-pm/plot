import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  PlanMetaSchema,
  toBoardPhase,
  BOARD_PHASES,
  type Board,
  type Card,
  type Column,
  type SprintCard,
  type StoryCard,
} from '../contract/schema.js';

/**
 * Where to look. `repoRoot` is the adopting project (source of plans / sprints
 * / stories — the CWD in normal use). `scriptsDir` is where Plot's helper
 * scripts live (next to the shipped artifact); it is NOT assumed equal to
 * `repoRoot`, because the board artifact ships inside the plot plugin and reads
 * a different repo's plans.
 */
export interface BuildBoardOptions {
  repoRoot: string;
  scriptsDir: string;
}

/** Read one `## Plot Config` key via the shared helper (with a default). */
function readConfig(opts: BuildBoardOptions, key: string, fallback: string): string {
  try {
    const out = execFileSync(
      'bash',
      [path.join(opts.scriptsDir, 'plot-config.sh'), 'get', key, fallback],
      { cwd: opts.repoRoot, encoding: 'utf8' },
    );
    return out.trim() || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Collect plan files, de-duplicated by real path. Walk order (active/ →
 * delivered/ → the plans root) mirrors the previous walker so a plan symlinked
 * from active/ is counted once, under its canonical docs/plans/ path.
 */
function collectPlanFiles(repoRoot: string, planDir: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  const root = path.join(repoRoot, planDir);
  const dirs = [path.join(root, 'active'), path.join(root, 'delivered'), root];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.md')) continue;
      let resolved: string;
      try {
        resolved = fs.realpathSync(path.join(dir, entry));
      } catch {
        continue; // broken symlink or unreadable
      }
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      files.push(resolved);
    }
  }
  return files;
}

/** slug from a date-prefixed plan filename (YYYY-MM-DD-<slug>.md). */
function planSlug(file: string): string {
  const base = path.basename(file, '.md');
  const m = base.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return m ? m[1] : base;
}

/** Run the plan-format helper once over all plan files → validated records. */
function readPlanMeta(scriptsDir: string, files: string[]) {
  if (files.length === 0) return [];
  const out = execFileSync('bash', [path.join(scriptsDir, 'plot-plan-meta.sh'), ...files], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => PlanMetaSchema.parse(JSON.parse(l)));
}

/**
 * Sprint files are not plan files, so they are read here rather than via
 * plot-plan-meta.sh (which owns the plan format only). Minimal, faithful port
 * of the previous walker's parseSprint.
 */
function parseSprintFile(absPath: string): SprintCard | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  const titleMatch = content.match(/^# Sprint: (.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(absPath, '.md');
  const slugMatch = path.basename(absPath).match(/^\d{4}-W\d{2}-(.+)\.md$/);
  const slug = slugMatch ? slugMatch[1] : path.basename(absPath, '.md');
  const statusMatch = content.match(/## Status\s*\n([\s\S]*?)(?=\n## |$)/);
  const phaseMatch = (statusMatch ? statusMatch[1] : '').match(/^- \*\*Phase:\*\* (.+)$/m);
  const phase = phaseMatch ? phaseMatch[1].trim() : '';
  if (!phase) return null;
  return { slug, title, phase };
}

function collectSprints(repoRoot: string, sprintDir: string): SprintCard[] {
  const dir = path.join(repoRoot, sprintDir, 'active');
  if (!fs.existsSync(dir)) return [];
  const sprints: SprintCard[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.md')) continue;
    let resolved: string;
    try {
      resolved = fs.realpathSync(path.join(dir, entry));
    } catch {
      continue;
    }
    const sprint = parseSprintFile(resolved);
    if (sprint) sprints.push(sprint);
  }
  return sprints;
}

/** Story files use story-tracking's YAML front matter (title + status). */
function parseStoryFile(absPath: string, slug: string): StoryCard | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  let title = '';
  let status = '';
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const t = fm[1].match(/^title:\s*(.+)$/m);
    if (t) title = t[1].trim();
    const s = fm[1].match(/^status:\s*(.+)$/m);
    if (s) status = s[1].trim();
  }
  if (!title) {
    const h1 = content.match(/^# (.+)$/m);
    title = h1 ? h1[1].trim() : slug;
  }
  return { slug, title, status };
}

/**
 * Discover stories under docs/stories/<slug>/STORY-<slug>.md. The glob depth
 * (one directory down) naturally excludes docs/stories/archived/<slug>/…, so
 * archived stories never populate the filter list.
 */
function collectStories(repoRoot: string, storyDir: string): StoryCard[] {
  const root = path.join(repoRoot, storyDir);
  if (!fs.existsSync(root)) return [];
  const stories: StoryCard[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'archived') continue;
    const dir = path.join(root, entry.name);
    let storyFile: string | undefined;
    try {
      storyFile = fs.readdirSync(dir).find((f) => /^STORY-.*\.md$/.test(f));
    } catch {
      continue;
    }
    if (!storyFile) continue;
    const m = storyFile.match(/^STORY-(.+)\.md$/);
    const slug = m ? m[1] : entry.name;
    const card = parseStoryFile(path.join(dir, storyFile), slug);
    if (card) stories.push(card);
  }
  return stories;
}

/**
 * Build the board JSON: plans (via the plan-format helper) grouped into the
 * four phase columns, plus discovered sprints and stories for the filters.
 * Plans whose phase is not a board phase (rejected / superseded / legacy) are
 * omitted, matching the previous walker.
 */
export function buildBoard(opts: BuildBoardOptions): Board {
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const sprintDir = readConfig(opts, 'Sprint directory', 'docs/sprints/');
  const storyDir = readConfig(opts, 'Story directory', 'docs/stories/');

  const files = collectPlanFiles(opts.repoRoot, planDir);
  const cards: Card[] = [];
  for (const meta of readPlanMeta(opts.scriptsDir, files)) {
    const phase = toBoardPhase(meta.phase);
    if (!phase) continue;
    const slug = planSlug(meta.file);
    const card: Card = {
      slug,
      title: meta.title || slug,
      type: meta.type || 'unknown',
      phase,
      path: path.relative(opts.repoRoot, meta.file),
    };
    if (meta.sprint) card.sprint = meta.sprint;
    if (meta.story) card.story = meta.story;
    if (meta.assignee) card.assignee = meta.assignee;
    cards.push(card);
  }

  const columns: Column[] = BOARD_PHASES.map((phase) => ({
    phase,
    cards: cards.filter((c) => c.phase === phase),
  }));

  return {
    generatedAt: new Date().toISOString(),
    columns,
    sprints: collectSprints(opts.repoRoot, sprintDir),
    stories: collectStories(opts.repoRoot, storyDir),
  };
}
