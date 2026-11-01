import { memberLineIndex, sprintsListing, type SprintFile } from '../rules/sprint-membership.js';
import { annotateSprintItem } from '../rules/sprint-annotation.js';
import { tickSprintItem } from '../rules/sprint-tick.js';

/**
 * `add`, `defer` and `remove` write a sprint's member line, the plan's
 * `- **Sprint:**` field, and — in a Committed or Active sprint — a dated
 * `### Scope Changes` line, all from the two texts a caller reads off disk.
 *
 * Pure: every function here takes the sprint text, the plan text, the other
 * sprint files' readings and the date, and returns the two new texts or a
 * named refusal. No port import — a caller supplies every reading.
 */

/** A MoSCoW tier `add` may place a member line under. */
export type SprintMemberTier = 'must' | 'should' | 'could';

/** Why a verb refused, named for a caller to branch on. */
export type SprintMemberRefusalReason =
  | 'plan-not-found'
  | 'sprint-not-found'
  | 'sprint-closed'
  | 'listed-elsewhere'
  | 'not-a-member'
  | 'field-record';

/** A refused verb, naming the slug, the sprint and the gate that fired. */
export interface SprintMemberRefusal {
  readonly outcome: 'refused';
  readonly reason: SprintMemberRefusalReason;
  readonly slug: string;
  readonly sprint: string;
  readonly detail: string;
}

/** A verb that wrote nothing because the member line already matched. */
export interface SprintMemberNoop {
  readonly outcome: 'noop';
}

/** A verb that holds: the two new texts to write, plan first. */
export interface SprintMemberWrite {
  readonly outcome: 'write';
  readonly planText: string;
  readonly sprintText: string;
}

export type SprintMemberResult = SprintMemberWrite | SprintMemberNoop | SprintMemberRefusal;

const refuse = (
  reason: SprintMemberRefusalReason,
  slug: string,
  sprint: string,
  detail: string,
): SprintMemberRefusal => ({ outcome: 'refused', reason, slug, sprint, detail });

const TIER_HEADING: Readonly<Record<SprintMemberTier, string>> = {
  must: '### Must Have',
  should: '### Should Have',
  could: '### Could Have',
};

const TIER_LABEL: Readonly<Record<SprintMemberTier, string>> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
};

const ANY_HEADING = /^#{2,3} /;
const MUST_SHOULD_COULD: ReadonlyArray<readonly [RegExp, SprintMemberTier]> = [
  [/^### Must Have\b/, 'must'],
  [/^### Should Have\b/, 'should'],
  [/^### Could Have\b/, 'could'],
];
const DEFERRED_HEADING = /^### Deferred\b/;
const STATE_FIELD = /^- \*\*State:\*\* (.+)$/m;

/** The tier a line sits under, or null when it sits under no MoSCoW heading at all. */
const tierOfLine = (lines: readonly string[], index: number): SprintMemberTier | 'deferred' | null => {
  for (let i = index; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (!ANY_HEADING.test(line)) continue;
    const found = MUST_SHOULD_COULD.find(([re]) => re.test(line));
    if (found) return found[1];
    if (DEFERRED_HEADING.test(line)) return 'deferred';
    return null;
  }
  return null;
};

const sprintState = (sprintText: string): string => sprintText.match(STATE_FIELD)?.[1].trim() ?? '';

/** Whether a sprint logs Scope Changes: a Planning sprint has no commitment yet. */
const logsScopeChanges = (state: string): boolean => state === 'Committed' || state === 'Active';

/**
 * Inserts a dated line under `### Scope Changes`, after its existing lines.
 *
 * @param sprintText - the sprint file's content.
 * @param line - the line to add, without its leading `- `.
 * @returns the new content; unchanged when the sprint has no such heading.
 */
const withScopeChangeLine = (sprintText: string, line: string): string => {
  const lines = sprintText.split('\n');
  const start = lines.findIndex((l) => /^### Scope Changes\b/.test(l));
  if (start === -1) return sprintText;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (ANY_HEADING.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  let insert = start;
  for (let i = start + 1; i < end; i += 1) {
    if (lines[i]!.trim().startsWith('- ')) insert = i;
  }
  const next = [...lines];
  next.splice(insert + 1, 0, `- ${line}`);
  return next.join('\n');
};

/** Matches the plan's `## Status` section's first `- **Sprint:**` line. */
const STATUS_HEADING = /^##[ \t]*[Ss]tatus[ \t]*$/;
const ANY_STATUS_SUB_HEADING = /^##[ \t]/;
const SPRINT_FIELD_LINE = /^([ \t]*[-*][ \t]*\*\*Sprint:\*\*)[ \t]*(.*)$/;
const TYPE_FIELD_LINE = /^[ \t]*[-*][ \t]*\*\*Type:\*\*/;
/**
 * Matches a template placeholder: a comment whose first word is `optional`,
 * as in `<!-- optional -->` and every `<!-- optional, filled when … -->` form
 * the plan templates write.
 */
const PLACEHOLDER = /^<!--[ \t]*optional\b/;

/** Whether a `Sprint:` field's current value is an HTML comment carrying a record of its own. */
const isUnexpectedComment = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith('<!--') && !PLACEHOLDER.test(trimmed);
};

/** The plan's title, from its first `# ` heading. */
const planTitle = (planText: string): string => planText.match(/^# (.+)$/m)?.[1].trim() ?? '';

/** The plan's `## Status` `Issue:` field, as the first number it names, or `''`. */
const planIssue = (planText: string): string => {
  const statusBody = planText.match(/## Status\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
  const value = statusBody.match(/^- \*\*Issue:\*\* (.+)$/m)?.[1] ?? '';
  return value.match(/#(\d+)/)?.[1] ?? '';
};

/** The plan's `## Status` `State:` field. */
const planState = (planText: string): string => {
  const statusBody = planText.match(/## Status\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
  return (statusBody.match(/^- \*\*State:\*\* (.+)$/m)?.[1] ?? '').trim();
};

/** The PR number named by the plan's `Approved:` record, or null. */
const planApprovedPr = (planText: string): number | null => {
  const match = planText.match(/^- \*\*Approved:\*\*.*plan-PR #(\d+)/m);
  return match ? Number(match[1]) : null;
};

/** The first branch named by the plan's `## Slices` section, or `''`. */
const planFirstBranch = (planText: string): string =>
  planText.match(/^- `([^`]+)`/m)?.[1] ?? '';

/** Result of writing (or refusing to write) the plan's `Sprint:` field. */
type FieldWrite = { ok: true; text: string } | { ok: false; current: string };

/**
 * Sets the plan's `- **Sprint:**` field, scoped to the first `## Status`
 * block.
 *
 * Overwrites an empty value or a placeholder comment freely. Refuses any
 * other comment — a record such as `<!-- not a member; the sprint closed
 * 2026-08-26 -->` is not noise, and overwriting it silently would lose it.
 *
 * @param planText - the plan file's content.
 * @param value - the sprint slug to write, or `''` to clear the field.
 * @returns the new text, or the current (refusing) value when it is any
 *   other comment.
 */
const withSprintField = (planText: string, value: string): FieldWrite => {
  const lines = planText.split('\n');
  const start = lines.findIndex((line) => STATUS_HEADING.test(line));
  if (start === -1) return { ok: true, text: planText };

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (ANY_STATUS_SUB_HEADING.test(lines[i]!)) {
      end = i;
      break;
    }
  }

  for (let i = start + 1; i < end; i += 1) {
    const match = lines[i]!.match(SPRINT_FIELD_LINE);
    if (!match) continue;
    const current = match[2]!;
    if (isUnexpectedComment(current)) {
      return { ok: false, current: current.trim() };
    }
    const next = [...lines];
    next[i] = `${match[1]} ${value}`;
    return { ok: true, text: next.join('\n') };
  }

  // No `Sprint:` line exists: insert one after `Type:`, or after the heading.
  let insertAfter = start;
  for (let i = start + 1; i < end; i += 1) {
    insertAfter = i;
    if (TYPE_FIELD_LINE.test(lines[i]!)) break;
  }
  const next = [...lines];
  next.splice(insertAfter + 1, 0, `- **Sprint:** ${value}`);
  return { ok: true, text: next.join('\n') };
};

/** Whether the plan is Approved or further along the lifecycle. */
const isApprovedOrLater = (state: string): boolean =>
  ['Approved', 'Delivered', 'Released'].includes(state);

/** Whether the plan is Delivered or further along the lifecycle. */
const isDeliveredOrLater = (state: string): boolean => ['Delivered', 'Released'].includes(state);

/**
 * Applies the annotation and tick a plan's own state owes its member line,
 * the same inputs `/plot-approve` and `/plot-deliver` use.
 */
const withOwedAnnotation = (sprintText: string, slug: string, planText: string): string => {
  const state = planState(planText);
  let text = sprintText;
  if (isApprovedOrLater(state)) {
    const pr = planApprovedPr(planText);
    if (pr !== null) {
      text = annotateSprintItem(text, slug, pr, planFirstBranch(planText)).content;
    }
  }
  if (isDeliveredOrLater(state)) {
    text = tickSprintItem(text, slug).content;
  }
  return text;
};

/** Builds the member line text for a tier: `- [ ] [<slug>] <title> (#<issue>)`. */
const memberLineFor = (slug: string, planText: string): string => {
  const title = planTitle(planText);
  const issue = planIssue(planText);
  const suffix = issue !== '' ? ` (#${issue})` : '';
  return `- [ ] [${slug}]${title !== '' ? ` ${title}` : ''}${suffix}`;
};

/** Finds the index right after a tier heading's own run of existing member lines. */
const tierInsertionPoint = (lines: readonly string[], heading: RegExp): number => {
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return -1;
  let insert = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (ANY_HEADING.test(line)) break;
    if (line.trim().startsWith('- ')) insert = i;
  }
  return insert;
};

/** Removes the line at `index`, returning the new lines. */
const withoutLine = (lines: readonly string[], index: number): string[] => [
  ...lines.slice(0, index),
  ...lines.slice(index + 1),
];

/** The other open sprints (not `exceptFile`) that list `slug`, as a human-readable name. */
const otherOpenListing = (
  slug: string,
  exceptFile: string,
  others: readonly SprintFile[],
): { sprint: string; file: string } | null => {
  const listing = sprintsListing(slug, others).filter(
    (entry) => entry.file !== exceptFile && entry.state !== 'Closed',
  );
  return listing.length > 0 ? { sprint: listing[0]!.sprint, file: listing[0]!.file } : null;
};

/** What every verb needs beyond the sprint and plan text. */
export interface SprintMemberContext {
  /** The sprint's slug, as its filename names it. */
  sprint: string;
  /** The plan's slug. */
  slug: string;
  /** Every OTHER dated sprint file — never including the one being written. */
  otherSprints: readonly SprintFile[];
  /** Today's date, ISO-8601 — stamps a `### Scope Changes` line. */
  date: string;
  /** Freeform note appended to a logged line, or `''` to omit it. */
  reason?: string;
}

/**
 * Adds a plan to a sprint under a MoSCoW tier, or moves it there.
 *
 * Writes the member line (new, or moved from another tier), the plan's
 * `Sprint:` field, a dated `Added` or `Reprioritized` line when the sprint is
 * Committed or Active, and the annotation/tick the plan's own state already
 * owes — the same inputs `/plot-approve` and `/plot-deliver` use.
 *
 * A re-run with the same arguments is a no-op: the member line already sits
 * in the requested tier and the field already holds this sprint.
 *
 * @param sprintText - the sprint file's content.
 * @param planText - the plan file's content.
 * @param tier - the tier to place the member line under.
 * @param ctx - the sprint and plan identity, other sprints' readings, the
 *   date and an optional reason.
 * @returns the new texts, a no-op, or a named refusal.
 */
export const addSprintMember = (
  sprintText: string,
  planText: string,
  tier: SprintMemberTier,
  ctx: SprintMemberContext,
): SprintMemberResult => {
  const state = sprintState(sprintText);
  if (state === '') return refuse('sprint-not-found', ctx.slug, ctx.sprint, `sprint '${ctx.sprint}' names no 'State:' field.`);
  if (state === 'Closed') {
    return refuse('sprint-closed', ctx.slug, ctx.sprint, `sprint '${ctx.sprint}' is closed — membership is history and is never rewritten.`);
  }

  const elsewhere = otherOpenListing(ctx.slug, '', ctx.otherSprints);
  if (elsewhere && elsewhere.sprint !== ctx.sprint) {
    return refuse(
      'listed-elsewhere',
      ctx.slug,
      ctx.sprint,
      `'${ctx.slug}' is already listed by the open sprint '${elsewhere.sprint}' — defer or remove it there first.`,
    );
  }

  const lines = sprintText.split('\n');
  const existingIndex = memberLineIndex(sprintText, ctx.slug);
  const currentTier = existingIndex === -1 ? null : tierOfLine(lines, existingIndex);

  let nextLines = [...lines];
  let changed = false;
  let logLine: string | null = null;

  if (existingIndex !== -1 && currentTier === tier) {
    // Already in place — the member line needs no edit.
  } else if (existingIndex !== -1) {
    const oldLine = lines[existingIndex]!;
    nextLines = withoutLine(nextLines, existingIndex);
    const insertAt = tierInsertionPoint(nextLines, new RegExp(`^${TIER_HEADING[tier].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
    const movedLine = oldLine.replace(MEMBER_LINE_PREFIX_KEEP, '$1');
    nextLines.splice(insertAt + 1, 0, movedLine);
    changed = true;
    if (currentTier && currentTier !== 'deferred') {
      logLine = `${ctx.date}: Reprioritized [${ctx.slug}] ${TIER_LABEL[currentTier]} → ${TIER_LABEL[tier]}${reasonSuffix(ctx.reason)}`;
    } else {
      logLine = `${ctx.date}: Added [${ctx.slug}] to ${TIER_LABEL[tier]}${reasonSuffix(ctx.reason)}`;
    }
  } else {
    const insertAt = tierInsertionPoint(nextLines, new RegExp(`^${TIER_HEADING[tier].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
    if (insertAt === -1) {
      return refuse('sprint-not-found', ctx.slug, ctx.sprint, `sprint '${ctx.sprint}' has no '${TIER_HEADING[tier]}' section.`);
    }
    nextLines.splice(insertAt + 1, 0, memberLineFor(ctx.slug, planText));
    changed = true;
    logLine = `${ctx.date}: Added [${ctx.slug}] to ${TIER_LABEL[tier]}${reasonSuffix(ctx.reason)}`;
  }

  let nextSprintText = nextLines.join('\n');
  if (changed && logLine && logsScopeChanges(state)) {
    nextSprintText = withScopeChangeLine(nextSprintText, logLine);
  }
  nextSprintText = withOwedAnnotation(nextSprintText, ctx.slug, planText);

  const field = withSprintField(planText, ctx.sprint);
  if (!field.ok) {
    return refuse(
      'field-record',
      ctx.slug,
      ctx.sprint,
      `plan '${ctx.slug}' already carries a 'Sprint:' comment ('${field.current}') — that record is not overwritten silently.`,
    );
  }

  const fieldUnchanged = field.text === planText;
  if (!changed && fieldUnchanged) return { outcome: 'noop' };

  return { outcome: 'write', planText: field.text, sprintText: nextSprintText };
};

/** Keeps the checkbox and the `[slug]` reference, dropping any strike-through. */
const MEMBER_LINE_PREFIX_KEEP = /^(- \[( |x)\] (?:~~)?\[[a-z0-9][a-z0-9-]*\]~~?)(.*)$/;

const reasonSuffix = (reason?: string): string => (reason && reason.trim() !== '' ? ` — ${reason.trim()}` : '');

/**
 * Moves a plan's member line to `### Deferred`, keeping the plan's `Sprint:`
 * field.
 *
 * Writes a dated `Deferred` line when the sprint is Committed or Active. A
 * re-run with the same arguments is a no-op once the line already sits under
 * `### Deferred`.
 *
 * @param sprintText - the sprint file's content.
 * @param planText - the plan file's content.
 * @param ctx - the sprint and plan identity, other sprints' readings, the
 *   date and an optional reason.
 * @returns the new texts, a no-op, or a named refusal.
 */
export const deferSprintMember = (
  sprintText: string,
  planText: string,
  ctx: SprintMemberContext,
): SprintMemberResult => {
  const state = sprintState(sprintText);
  if (state === '') return refuse('sprint-not-found', ctx.slug, ctx.sprint, `sprint '${ctx.sprint}' names no 'State:' field.`);
  if (state === 'Closed') {
    return refuse('sprint-closed', ctx.slug, ctx.sprint, `sprint '${ctx.sprint}' is closed — membership is history and is never rewritten.`);
  }

  const lines = sprintText.split('\n');
  const existingIndex = memberLineIndex(sprintText, ctx.slug);
  if (existingIndex === -1) {
    return refuse('not-a-member', ctx.slug, ctx.sprint, `'${ctx.slug}' is not on a Must, Should or Could line of '${ctx.sprint}'.`);
  }
  const foundTier = tierOfLine(lines, existingIndex);
  if (foundTier === 'deferred' || foundTier === null) return { outcome: 'noop' };
  const currentTier = foundTier;

  const oldLine = lines[existingIndex]!;
  const movedLine = oldLine.replace(MEMBER_LINE_PREFIX_KEEP, '$1');
  let nextLines = withoutLine(lines, existingIndex);
  const insertAt = tierInsertionPoint(nextLines, DEFERRED_HEADING);
  if (insertAt === -1) {
    return refuse('sprint-not-found', ctx.slug, ctx.sprint, `sprint '${ctx.sprint}' has no '### Deferred' section.`);
  }
  nextLines.splice(insertAt + 1, 0, movedLine);

  let nextSprintText = nextLines.join('\n');
  if (logsScopeChanges(state)) {
    const logLine = `${ctx.date}: Deferred [${ctx.slug}] from ${TIER_LABEL[currentTier]}${reasonSuffix(ctx.reason)}`;
    nextSprintText = withScopeChangeLine(nextSprintText, logLine);
  }

  return { outcome: 'write', planText, sprintText: nextSprintText };
};

/**
 * Removes a plan from a sprint's membership.
 *
 * In a Planning sprint the member line is deleted outright — nothing has
 * been committed to yet. In a Committed or Active sprint the reference is
 * struck (`~~[slug]~~`), the form the sprint template documents for an item
 * that left, and a dated `Removed` line is logged.
 *
 * Clears the plan's `Sprint:` field unless another open sprint still lists
 * it, in which case the field is set to that sprint's slug.
 *
 * A re-run with the same arguments is a no-op once the plan carries no
 * live (unstruck) member line in this sprint.
 *
 * @param sprintText - the sprint file's content.
 * @param planText - the plan file's content.
 * @param ctx - the sprint and plan identity, other sprints' readings, the
 *   date and an optional reason.
 * @returns the new texts, a no-op, or a named refusal.
 */
export const removeSprintMember = (
  sprintText: string,
  planText: string,
  ctx: SprintMemberContext,
): SprintMemberResult => {
  const state = sprintState(sprintText);
  if (state === '') return refuse('sprint-not-found', ctx.slug, ctx.sprint, `sprint '${ctx.sprint}' names no 'State:' field.`);
  if (state === 'Closed') {
    return refuse('sprint-closed', ctx.slug, ctx.sprint, `sprint '${ctx.sprint}' is closed — membership is history and is never rewritten.`);
  }

  const lines = sprintText.split('\n');
  const existingIndex = memberLineIndex(sprintText, ctx.slug);
  if (existingIndex === -1) {
    return refuse('not-a-member', ctx.slug, ctx.sprint, `'${ctx.slug}' is not on a Must, Should or Could line of '${ctx.sprint}'.`);
  }
  const currentTier = tierOfLine(lines, existingIndex);

  let nextLines: string[];
  if (state === 'Planning') {
    nextLines = withoutLine(lines, existingIndex);
  } else {
    const oldLine = lines[existingIndex]!;
    nextLines = [...lines];
    nextLines[existingIndex] = oldLine.replace(
      /^(- \[( |x)\] )\[([a-z0-9][a-z0-9-]*)\]/,
      '$1~~[$3]~~',
    );
  }

  let nextSprintText = nextLines.join('\n');
  if (logsScopeChanges(state) && currentTier && currentTier !== 'deferred') {
    const logLine = `${ctx.date}: Removed [${ctx.slug}] from ${TIER_LABEL[currentTier]}${reasonSuffix(ctx.reason)}`;
    nextSprintText = withScopeChangeLine(nextSprintText, logLine);
  }

  const elsewhere = otherOpenListing(ctx.slug, '', ctx.otherSprints);
  const fieldValue = elsewhere ? elsewhere.sprint : '';
  const field = withSprintField(planText, fieldValue);
  if (!field.ok) {
    return refuse(
      'field-record',
      ctx.slug,
      ctx.sprint,
      `plan '${ctx.slug}' already carries a 'Sprint:' comment ('${field.current}') — that record is not overwritten silently.`,
    );
  }

  return { outcome: 'write', planText: field.text, sprintText: nextSprintText };
};
