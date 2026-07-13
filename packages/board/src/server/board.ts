import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
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

/**
 * Resolve `repoRoot` through symlinks. Plan files are reported as real paths, so
 * the root must be resolved the same way for `path.relative` to come out
 * repo-relative (and for the /plan allowlist basenames to match card.path).
 */
function resolvedRepoRoot(opts: BuildBoardOptions): string {
  try {
    return fs.realpathSync(opts.repoRoot);
  } catch {
    return opts.repoRoot;
  }
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
        // A directory named "foo.md" passes the extension check; skip it so
        // plot-plan-meta.sh is never handed a directory (awk: "Is a directory").
        if (!fs.statSync(resolved).isFile()) continue;
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

  const repoRoot = resolvedRepoRoot(opts);
  const files = collectPlanFiles(repoRoot, planDir);
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
      path: path.relative(repoRoot, meta.file),
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
    sprints: collectSprints(repoRoot, sprintDir),
    stories: collectStories(repoRoot, storyDir),
  };
}

// ─── Plan viewer: render a single plan file to HTML ──────────────────────────

/** Strip a leading YAML front-matter block so it isn't rendered as markdown. */
function stripFrontMatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

/** Escape text interpolated into the page shell (the `<title>`). */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/**
 * Resolve a plan file *basename* to its absolute path, restricted to the plans
 * the board itself collects. The candidates come from `collectPlanFiles`, which
 * only walks the configured plan dir — so a request can never name a file
 * outside it. Path traversal is blocked structurally, not by string sanitizing;
 * the leading basename check just rejects any separators up front. Returns null
 * for anything not in the allowlist (→ 404).
 */
function resolvePlanFile(opts: BuildBoardOptions, filename: string): string | null {
  if (!filename || filename !== path.basename(filename) || !filename.endsWith('.md')) return null;
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  for (const file of collectPlanFiles(resolvedRepoRoot(opts), planDir)) {
    if (path.basename(file) === filename) return file;
  }
  return null;
}

/** Minimal, theme-aware page CSS — readable plan prose, no external assets. */
const PLAN_PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1e293b; background: #ffffff;
  }
  .plan-titlebar {
    position: sticky; top: 0; z-index: 1;
    padding: 0.7rem 1rem; border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }
  .plan-back { color: #2563eb; text-decoration: none; font-weight: 500; font-size: 0.9rem; }
  .plan-back:hover { text-decoration: underline; }
  main { max-width: 52rem; margin: 0 auto; padding: 2rem 1rem; }
  h1, h2, h3 { line-height: 1.25; margin: 1.6em 0 0.5em; }
  h1 { font-size: 1.7rem; } h2 { font-size: 1.3rem; } h3 { font-size: 1.1rem; }
  a { color: #2563eb; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em;
    background: #f1f5f9; padding: 0.1em 0.35em; border-radius: 4px; }
  pre { background: #f1f5f9; padding: 0.9rem 1rem; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding-left: 1rem; border-left: 3px solid #cbd5e1; color: #475569; }
  table { border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 0.4rem 0.7rem; }
  img { max-width: 100%; }
  @media (prefers-color-scheme: dark) {
    body { color: #e2e8f0; background: #0f172a; }
    a, .plan-back { color: #60a5fa; }
    code, pre { background: #1e293b; }
    blockquote { border-left-color: #475569; color: #94a3b8; }
    th, td { border-color: #334155; }
    .plan-titlebar { border-bottom-color: #1e293b; background: #0b1220; }
  }
`;

export interface RenderPlanOptions {
  /**
   * When true, omit the "back to board" titlebar. The in-board modal injects
   * `?embed=1` so its embedded view is chrome-free; the standalone new-tab /
   * direct-URL view (no param) keeps the titlebar for navigation.
   */
  embed?: boolean;
}

/**
 * Render a plan file to a standalone, theme-aware HTML page — or null if the
 * name doesn't resolve to a board plan (→ 404). One response serves both the
 * new-tab route (with a back-to-board titlebar) and the modal's fetched srcdoc
 * (embed=1, no titlebar).
 */
export function renderPlanPage(
  opts: BuildBoardOptions,
  filename: string,
  { embed = false }: RenderPlanOptions = {},
): string | null {
  const file = resolvePlanFile(opts, filename);
  if (!file) return null;
  const md = fs.readFileSync(file, 'utf8');
  const body = marked.parse(stripFrontMatter(md), { async: false });
  const heading = md.match(/^#\s+(.+)$/m);
  const title = heading ? heading[1].trim() : filename;
  const titlebar = embed
    ? ''
    : '<header class="plan-titlebar"><a class="plan-back" href="/">← Board</a></header>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PLAN_PAGE_STYLE}</style>
</head>
<body>${titlebar}<main>${body}</main></body>
</html>`;
}
