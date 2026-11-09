import type { StoryRecord } from '../entities/board-readings.js';
import { StoryStatusSchema } from '../entities/story.js';
import { storyIssueValue } from './story-issue.js';
import { UNADMITTED_STATE } from './sprint-record.js';

/**
 * Strips one matching pair of surrounding quotes from a string. A quote inside
 * the value, and an unmatched edge quote, stay.
 *
 * @param value - a YAML scalar as written.
 * @returns the value without its surrounding quotes.
 */
export const unquoteScalar = (value: string): string => {
  if (value.length >= 2) {
    const q = value[0];
    if ((q === '"' || q === "'") && value[value.length - 1] === q) return value.slice(1, -1);
  }
  return value;
};

/**
 * The body of a level-2 section, trimmed, up to the next level-1 or level-2
 * heading; `''` where the section is absent.
 */
const sectionOf = (content: string, heading: string): string => {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n# |$(?![\\s\\S]))`, 'm');
  return pattern.exec(content)?.[1]?.trim() ?? '';
};

/** `text` cut to about `maxLen` characters at a word boundary, with an ellipsis where it was cut. */
const truncated = (text: string, maxLen: number): string => {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…';
};

/**
 * The `DESIGN-*.md` basenames that sit directly in `dir`, from a listing of
 * repository paths.
 *
 * @param paths - repository-relative file paths.
 * @param dir - the story's directory, relative to the repository root, without a trailing slash.
 * @returns the basenames in name order.
 */
export const designDocsIn = (paths: readonly string[], dir: string): string[] =>
  paths
    .filter((p) => p.startsWith(`${dir}/`))
    .map((p) => p.slice(dir.length + 1))
    .filter((name) => /^DESIGN-[^/]*\.md$/.test(name))
    .sort();

/**
 * Parses one story file's front matter and sections.
 *
 * @param content - the story file's text.
 * @param slug - the story's slug, from its filename.
 * @param relPath - the file's path relative to the repository root.
 * @param designDocs - the `DESIGN-*.md` basenames beside the file.
 * @returns the story. The title falls back to the first `# ` heading, then to
 *   `slug`. A `status:` the domain does not admit reads as `UNKNOWN`.
 */
export const storyRecordOf = (
  content: string,
  slug: string,
  relPath: string,
  designDocs: readonly string[],
): StoryRecord => {
  let title = '';
  let status = '';
  let author = '';
  let created = '';
  let updated = '';
  let issue = '';
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  if (fm !== null) {
    const frontmatter = fm[1]!;
    const line = (key: string): string | undefined => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1]?.trim();
    title = unquoteScalar(line('title') ?? '');
    const stated = line('status') ?? '';
    status = stated === '' ? '' : StoryStatusSchema.safeParse(stated).success ? stated : UNADMITTED_STATE;
    author = line('author') ?? '';
    created = unquoteScalar(line('created') ?? '');
    updated = unquoteScalar(line('updated') ?? '');
    const fieldValue = (key: string): string => {
      const match = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(frontmatter);
      return match === null ? '' : unquoteScalar(match[1]!.replace(/\s+#.*$/, '').trim());
    };
    issue = storyIssueValue(fieldValue('issue'), fieldValue('jira'));
  }
  if (title === '') title = /^# (.+)$/m.exec(content)?.[1]?.trim() ?? slug;
  return {
    slug,
    title,
    status,
    declaredStatus: status,
    issue,
    author,
    created,
    updated,
    objective: truncated(unquoteScalar(sectionOf(content, 'Objective')), 200),
    design: sectionOf(content, 'Design'),
    path: relPath,
    designDocs: [...designDocs],
    hasOpenPoints: /^## Open Points\s*$/m.test(content),
    hasSessionLog: /^## Session Log\s*$/m.test(content),
  };
};
