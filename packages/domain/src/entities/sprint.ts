import { z } from 'zod';

/** Where a sprint sits in its life. No gate stands on any of these. */
// plot-state: lifecycle sprint — a timebox is opened, committed to, run and
//                                closed, in that order and once each. NO RULE
//                                YET: it is counted as debt by
//                                scripts/check-state-declarations.sh, which is
//                                what keeps the number from growing.
export const SprintStateSchema = z.enum(['Planning', 'Committed', 'Active', 'Closed']);
export type SprintState = z.infer<typeof SprintStateSchema>;

/**
 * The commitment's shape.
 *
 * Only `must` is a promise: the release gate refuses on an open Must, prompts
 * on an open Should, and reports a Could without blocking. A timebox with one
 * priority level is a queue with a date on it.
 */
// plot-state: classification — a priority. A Could becoming a Must is a
//                              re-prioritisation a person makes, not a
//                              transition, and every tier is reachable from
//                              every other at any moment.
export const MoscowTierSchema = z.enum(['must', 'should', 'could', 'deferred']);
export type MoscowTier = z.infer<typeof MoscowTierSchema>;

/**
 * How an item's checkbox and its plan compare.
 *
 * `done`       the work landed.
 * `open`       it has not.
 * `disputed`   the checkbox says it did and the plan estate says it did not.
 * `withdrawn`  somebody decided the plan will not deliver.
 *
 * `withdrawn` is not a fourth degree of unfinished. The other three compare
 * two records; this one reports a decision the plan itself carries, which is
 * why the checkbox cannot change it.
 */
// plot-state: classification — how a checkbox and a plan COMPARE, recomputed
//                              on every read. 'disputed' is a disagreement
//                              between two sources rather than a stage the item
//                              reached, and 'withdrawn' is a decision one of
//                              them records.
export const ItemStatusSchema = z.enum(['done', 'open', 'disputed', 'withdrawn']);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

/** One MoSCoW item: a commitment naming a plan. */
export interface SprintItem {
  /** Which commitment tier it sits in. */
  tier: MoscowTier;
  /** Whether the sprint file's checkbox is ticked. */
  checked: boolean;
  /** The slug of the plan it names; `''` when the line names no plan. */
  plan: string;
  /** The sprint's own wording of the item. */
  text: string;
}

/** The MoSCoW heading a member line sits under → the tier it carries. */
const TIER_HEADINGS: ReadonlyArray<readonly [RegExp, MoscowTier]> = [
  [/^### Must Have\b/, 'must'],
  [/^### Should Have\b/, 'should'],
  [/^### Could Have\b/, 'could'],
  [/^### Deferred\b/, 'deferred'],
];

/**
 * A member line: `- [ ] …` or `- [x] …`, with or without a `[slug]` reference.
 *
 * **THE CHECKBOX MAKES THE ITEM AND THE LINK IS OPTIONAL METADATA** — the rule
 * `plot-sprint-release.sh:234` has always applied, and `skills/plot-sprint/
 * SKILL.md:240` documents the bare form. The second bracket was mandatory until
 * 2026-09-25, so `- [ ] rename the deploy step` did not match at all: `itemsFrom`
 * skipped it, the sprint reached `setSprintState` with no items, and
 * `commitment-empty` refused a sprint whose Must Haves the release gate counted
 * as two open items. One file, two readers, opposite answers.
 *
 * **A REFERENCE IS A PLAN SLUG, AND IT MAY BE STRUCK THROUGH.** The group is
 * `(?:~~)?\[([a-z0-9][a-z0-9-]*)\]`, which is `plot-sprint-release.sh:249`'s
 * own rule ported rather than a fourth reading of the format. It replaced
 * `\[([^\]]+)\]` on 2026-09-29: that bracket was any text, so `~~[slug]~~` read
 * as no reference here while the shell resolved the slug, and the board counted
 * W40's withdrawn Should as `open` where the release gate counted it
 * `withdrawn`. One file, opposite answers again.
 *
 * Only the OPENING `~~` is required, matching the shell: the estate writes both
 * `~~[slug]~~` and `~~[slug](../plans/x.md)~~`, and anchoring on the closing
 * `~~` would read the second as unstruck.
 *
 * **A NON-SLUG BRACKET IS TEXT, NOT A REFERENCE.** `- [ ] [#966](…) …` names an
 * issue and no plan, so it reads as an item with no reference — the same answer
 * the shell has always given it. The narrowing drops no line from either
 * reader: measured 2026-09-29 across all 16 sprint files, every leading bracket
 * on an item line is slug-shaped or struck.
 */
const MEMBER_LINE = /^- \[( |x)\] (?:(?:~~)?\[([a-z0-9][a-z0-9-]*)\]\s*)?(.*)$/;

/**
 * A `## Status` field: `- **Name:** value`.
 *
 * @param body - the `## Status` block.
 * @param name - the field's name, as the file spells it.
 * @returns the trimmed value, or `''` where the block names no such field.
 */
const field = (body: string, name: string): string =>
  body.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, 'm'))?.[1].trim() ?? '';

/**
 * Read a sprint file's MoSCoW items.
 *
 * **The tier is the heading the line sits under**, so a checkbox in the goal or
 * the notes is not an item. Deduped by slug with the first occurrence winning:
 * the sections run Must → Should → Could → Deferred, so a plan listed twice
 * keeps its strongest tier — the same rule `parseSprintMembers` applies, and
 * `commitment-empty` is decided from the answer.
 *
 * **A BARE ITEM IS NEVER DEDUPED AGAINST ANOTHER.** Dedup exists because a plan
 * sliced across slices lists its slug once per slice and the sprint contains it
 * once; a line naming no plan makes no such claim. Keying those on the captured
 * plan would key them all on `''` — measured by the panel, three lines with two
 * bare keep 2 of 3, and eight bare Musts keep 1 of 8, so the bracket alone
 * improves the number without fixing it. The key is the slug where there is one
 * and the line's own position otherwise. **Never the item text**: two identical
 * bare lines are two items, and keying on text reproduces this defect in
 * miniature.
 *
 * @param content - the whole sprint file.
 * @returns its items, in file order.
 */
export const itemsFrom = (content: string): SprintItem[] => {
  const items: SprintItem[] = [];
  const seen = new Set<string>();
  let tier: MoscowTier | null = null;
  let index = 0;
  for (const line of content.split('\n')) {
    index += 1;
    if (line.startsWith('### ') || line.startsWith('## ')) {
      tier = TIER_HEADINGS.find(([re]) => re.test(line))?.[1] ?? null;
      continue;
    }
    if (!tier) continue;
    const m = line.match(MEMBER_LINE);
    if (!m) continue;
    const plan = (m[2] ?? '').trim();
    // `line:` cannot collide with a slug: a slug carries no colon, and the
    // prefix is what keeps the two key spaces apart rather than a bare number.
    const key = plan === '' ? `line:${index}` : plan;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ tier, checked: m[1] === 'x', plan, text: m[3].trim() });
  }
  return items;
};

/**
 * A timebox committing to a set of plans against a release.
 *
 * Identity: a slug — the filename without extension, which carries its own
 * week and fails by collision. State: stated in the file, so it can be wrong.
 */
export interface Sprint {
  /** The filename without extension — the identity; carries its own week. */
  slug: string;
  /** The `# Sprint: …` heading. */
  title: string;
  /** Where the sprint sits in its life. */
  state: SprintState;
  /** When it starts, ISO-8601. */
  start: string;
  /** When it was planned to end, ISO-8601. */
  plannedEnd: string;
  /** When it actually ended, ISO-8601; null while it has not. */
  actualEnd: string | null;
  /** The release this sprint targets — the gate's key. */
  release: string;
  /** The `## Sprint Goal` prose. */
  goal: string;
  /** The MoSCoW items. */
  items: readonly SprintItem[];
}

/**
 * What the plan estate says about the plan an item names.
 *
 * `true`            the plan it names has been delivered.
 * `false`           it has not.
 * `'no-plan-named'` the line names no plan, so nothing was looked up.
 * `'withdrawn'`     the plan is `Rejected` or `Superseded`.
 *
 * The third value is not "unknown". An item naming no plan is a lightweight
 * task with one source of truth, and that is a stated limit rather than a
 * failed lookup — a plan that could not be read would be a different reading
 * with a different answer.
 *
 * `Rejected` and `Superseded` arrive as ONE reading. They differ in why, which
 * the plan's own `Rejected:` or `Superseded:` record states; the sprint's
 * question is only whether the item is still owed, and neither is.
 */
export type PlanDelivery = boolean | 'no-plan-named' | 'withdrawn';

/**
 * Scores one item against what the plan estate says actually happened.
 *
 * The estate outranks the checkbox in ONE direction only: a checked box over an
 * undelivered plan is `disputed`, while an unchecked box over a delivered one
 * is `done`, because delivering a plan moves it and nobody re-ticks the box.
 *
 * A WITHDRAWN plan outranks the checkbox in BOTH directions, and that is the
 * same rule rather than a second one: the estate is the stronger record, and
 * here it carries a decision no box can contradict. Ticked or unticked, the
 * work is not going to happen. It is not `done` — nothing shipped — and it is
 * not `disputed`, because the box and the plan do not disagree about anything.
 *
 * An item naming NO plan has only its checkbox, so it is taken at face value
 * and can never be `disputed`: a dispute is a disagreement between two sources
 * and such an item has one.
 *
 * @param item - the sprint item to score.
 * @param delivered - what the estate says about the plan it names.
 * @returns the item's status.
 */
export const scoreItem = (item: SprintItem, delivered: PlanDelivery): ItemStatus => {
  if (delivered === 'withdrawn') return 'withdrawn';
  if (delivered === 'no-plan-named') return item.checked ? 'done' : 'open';
  if (delivered) return 'done';
  return item.checked ? 'disputed' : 'open';
};

/**
 * Whether an item is a promise the release gate refuses on.
 *
 * @param item - the item to test.
 * @returns true when the item is a Must.
 */
export const isPromised = (item: SprintItem): boolean => item.tier === 'must';

/**
 * The distinct plans a sprint commits to.
 *
 * Deduplicated by slug: a plan cut into several slices is listed once per
 * slice, so counting lines overstates the membership. Items naming no plan are
 * excluded.
 *
 * @param sprint - the sprint to read.
 * @returns each plan slug once, in the order first named.
 */
export const sprintMembers = (sprint: Sprint): string[] => [
  ...new Set(sprint.items.map((item) => item.plan).filter((slug) => slug !== '')),
];

/** A line that is only a template slot, such as `<sprint goal>`. */
const PLACEHOLDER = /^<[^<>]*>$/;

/** A paragraph opening with one of these is a list, a quote or a table, not prose. */
const NOT_PROSE = /^\s*(?:[-*+]\s|\d+[.)]\s|>|\|)/;

/** A markdown heading of any level. */
const HEADING = /^#{1,6}\s/;

const plainText = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(\S(?:[^*]*?\S)?)\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .trim();

const unlessPlaceholder = (text: string): string => (PLACEHOLDER.test(text) ? '' : text);

const quotedGoal = (lines: readonly string[]): string => {
  const title = lines.findIndex((line) => line.startsWith('# Sprint:'));
  if (title < 0) return '';
  const rest = lines.slice(title + 1);
  const first = rest.findIndex((line) => line.trim() !== '');
  const tail = first < 0 ? [] : rest.slice(first);
  // A bare `>` separates paragraphs of one quote; only the first is the goal.
  const stop = tail.findIndex((line) => !line.startsWith('>') || line.trim() === '>');
  const quoted = (stop < 0 ? tail : tail.slice(0, stop)).map((line) => line.replace(/^>\s?/, ''));
  return unlessPlaceholder(plainText(quoted.join(' ')));
};

/** The prose paragraphs of `## Sprint Goal`, whitespace collapsed, markdown kept. */
const sectionParagraphs = (lines: readonly string[]): string[] => {
  const start = lines.findIndex((line) => /^## Sprint Goal\s*$/.test(line));
  if (start < 0) return [];
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => HEADING.test(line));
  return (end < 0 ? after : after.slice(0, end))
    .join('\n')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .split(/\n\s*\n/)
    .filter((paragraph) => !NOT_PROSE.test(paragraph))
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim());
};

const firstUsable = (candidates: readonly string[]): string =>
  candidates.map(unlessPlaceholder).find((text) => text !== '') ?? '';

const boldGoal = (paragraphs: readonly string[]): string =>
  firstUsable(paragraphs.map((paragraph) => plainText(paragraph.match(/^\*\*(.+?)\*\*/)?.[1] ?? '')));

const proseGoal = (paragraphs: readonly string[]): string =>
  firstUsable(paragraphs.map(plainText));

/**
 * The goal a sprint file states, as plain text.
 *
 * Read in this order:
 * 1. the bold line opening a paragraph under `## Sprint Goal`, whole even when
 *    it wraps — the shape of a hand-written sprint, whose `> ` block under the
 *    title is often motivation rather than the goal;
 * 2. else the `> ` blockquote directly under the `# Sprint:` title, up to its
 *    first bare `>` line — the template's one-line goal, which `/plot-sprint`
 *    fills;
 * 3. else the first prose paragraph under `## Sprint Goal`.
 *
 * `## Sprint Goal` ends at the next heading of any level, and its HTML
 * comments, lists, quotes and tables are skipped. A candidate that is only a
 * `<…>` template slot is never the goal. Bold, emphasis, code spans and links
 * are reduced to their text.
 *
 * @param content - the sprint file's markdown.
 * @returns the goal, or `''` when the file states none.
 */
export const sprintGoal = (content: string): string => {
  const lines = content.split(/\r?\n/);
  const paragraphs = sectionParagraphs(lines);
  return boldGoal(paragraphs) || quotedGoal(lines) || proseGoal(paragraphs);
};

/**
 * Parse a sprint file into the entity the rule judges.
 *
 * **THE STATE IS CARRIED THROUGH UNPARSED, and that is the point.** A file
 * saying `Planned` produces a `Sprint` whose `state` is that word, so
 * `setSprintState` is the thing that recognises it — narrowing here would
 * refuse in this file's words and leave `state-unrecognised` as dead as it was.
 * The cast is what lets the file be wrong: the state "is stated in the file,
 * so it can be wrong".
 *
 * @param content - the whole sprint file.
 * @param slug - the sprint's identity, cut from its filename by the caller.
 * @returns the sprint, exactly as the file states it.
 */
export const sprintFrom = (content: string, slug: string): Sprint => {
  const statusBody = content.match(/## Status\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
  // `State:` is the field a sprint file carries; `Phase:` is what it was called
  // before 2026-09-07. Both are read, for the reason `parseSprintContent`
  // gives: a file may have been written a year ago or copied from elsewhere.
  const stated = field(statusBody, 'State') || field(statusBody, 'Phase');
  const actualEnd = field(statusBody, 'Actual End');
  return {
    slug,
    title: content.match(/^# Sprint: (.+)$/m)?.[1].trim() ?? slug,
    state: stated as Sprint['state'],
    start: field(statusBody, 'Start'),
    plannedEnd: field(statusBody, 'End'),
    actualEnd: actualEnd === '' ? null : actualEnd,
    release: field(statusBody, 'Release'),
    goal: sprintGoal(content),
    items: itemsFrom(content),
  };
};
