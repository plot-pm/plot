import type { SprintMemberRecord, SprintRecord } from '../entities/board-readings.js';
import { SprintStateSchema, sprintGoal, type MoscowTier } from '../entities/sprint.js';

/** What the parsers report for a state their schema does not admit. */
export const UNADMITTED_STATE = 'UNKNOWN';

/** The MoSCoW heading a member line sits under, and the tier it carries. */
const SPRINT_TIER_HEADINGS: ReadonlyArray<readonly [RegExp, MoscowTier]> = [
  [/^### Must Have\b/, 'must'],
  [/^### Should Have\b/, 'should'],
  [/^### Could Have\b/, 'could'],
  [/^### Deferred\b/, 'deferred'],
];

/** A member line: `- [ ] …` or `- [x] …`, with an optional, optionally struck-through `[slug]`. */
const SPRINT_MEMBER_LINE = /^- \[( |x)\] (?:(?:~~)?\[([a-z0-9][a-z0-9-]*)\]\s*)?(.*)$/;

/** The last path segment of `name`. */
const baseOf = (name: string): string => name.slice(name.lastIndexOf('/') + 1);

/**
 * Reads a sprint file's member lines.
 *
 * A checkbox line under a Must, Should, Could or Deferred heading is a member.
 * A slug listed twice is kept once, at its first line; a bare item is never
 * merged with another.
 *
 * @param content - the sprint file's text.
 * @returns the members in file order.
 */
export const sprintMembersOf = (content: string): SprintMemberRecord[] => {
  const members: SprintMemberRecord[] = [];
  const seen = new Set<string>();
  let tier: MoscowTier | null = null;
  let index = 0;
  for (const line of content.split('\n')) {
    index += 1;
    if (line.startsWith('### ') || line.startsWith('## ')) {
      tier = SPRINT_TIER_HEADINGS.find(([re]) => re.test(line))?.[1] ?? null;
      continue;
    }
    if (tier === null) continue;
    const m = SPRINT_MEMBER_LINE.exec(line);
    if (m === null) continue;
    const slug = (m[2] ?? '').trim();
    const key = slug === '' ? `line:${index}` : slug;
    if (seen.has(key)) continue;
    seen.add(key);
    members.push({ slug, text: m[3]!.trim(), tier, checked: m[1] === 'x' });
  }
  return members;
};

/**
 * Parses one sprint file.
 *
 * @param content - the sprint file's text.
 * @param name - the file's path or basename; the slug and the fallback title are cut from its basename.
 * @returns the sprint, or null where `## Status` states no `State:` (or legacy `Phase:`) line.
 *   A state `SprintStateSchema` does not admit reads as {@link UNADMITTED_STATE}.
 */
export const sprintRecordOf = (content: string, name: string): SprintRecord | null => {
  const base = baseOf(name);
  const stem = base.replace(/\.md$/, '');
  const title = /^# Sprint: (.+)$/m.exec(content)?.[1]?.trim() ?? stem;
  const slug = /^\d{4}-W\d{2}-(.+)\.md$/.exec(base)?.[1] ?? stem;
  const statusBody = /## Status\s*\n([\s\S]*?)(?=\n## |$)/.exec(content)?.[1] ?? '';
  const field = (re: RegExp): string => re.exec(statusBody)?.[1]?.trim() ?? '';
  const stated = field(/^- \*\*(?:State|Phase):\*\* (.+)$/m);
  if (stated === '') return null;
  return {
    slug,
    title,
    phase: SprintStateSchema.safeParse(stated).success ? stated : UNADMITTED_STATE,
    release: field(/^- \*\*Release:\*\* (.+)$/m),
    goal: sprintGoal(content),
    start: field(/^- \*\*Start:\*\* (.+)$/m),
    end: field(/^- \*\*End:\*\* (.+)$/m),
    members: sprintMembersOf(content),
  };
};
