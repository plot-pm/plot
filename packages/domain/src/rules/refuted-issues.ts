/**
 * Which refuted claims of a verification open a tracker issue, and what the
 * issue state file records for each.
 *
 * The state file is `.plot/state/verify/<slug>.json`:
 *
 * ```json
 * { "issues": { "<claim text>": { "issue": "1712" } } }
 * ```
 *
 * An entry is one of `{ "issue": "<id>" }`, `{ "pending": true }` or
 * `{ "mayExist": "<reason>" }`. A bare string is read as `{ "issue": <string> }`.
 */

import type { RefutedClaim } from './verification-record.js';
import type { ClaimVerdict, IssueNote } from './verification.js';

/**
 * The prefix of an issue-open refusal where the tracker may have opened the issue.
 *
 * A refusal that starts with it means the request may have reached the tracker:
 * the run ended at its time bound or by a signal, or the tracker answered with
 * no identifier the connector could read. A refusal without it means the
 * tracker refused the request or was not reached.
 */
export const ISSUE_MAY_EXIST = 'the issue may exist: ';

/** The reason a `pending` entry renders: an open started and no answer was recorded. */
export const PENDING_REASON = `${ISSUE_MAY_EXIST}an earlier run asked the tracker to open it and recorded no answer`;

/** One claim's entry in the issue state file. */
export type IssueEntry =
  | { readonly issue: string }
  | { readonly pending: true }
  | { readonly mayExist: string };

/** The issue state file's entries, keyed by claim text. */
export type IssueState = Readonly<Record<string, IssueEntry>>;

/** What to do for one refuted claim text. */
export type IssueStep =
  | { readonly step: 'note'; readonly claim: string; readonly note: IssueNote }
  | { readonly step: 'open'; readonly claim: string; readonly verdict: ClaimVerdict };

/** What one `issueOpen` call answered: the new id, or the refusal text (`null` for none). */
export type OpenAnswer = { readonly opened: string } | { readonly refused: string | null };

/**
 * Reads one state file entry.
 *
 * @param value - the JSON value under the claim's key.
 * @returns the entry, or `null` for a value of no known shape.
 */
const entryOf = (value: unknown): IssueEntry | null => {
  if (typeof value === 'string') return { issue: value };
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.issue === 'string') return { issue: v.issue };
  if (v.pending === true) return { pending: true };
  if (typeof v.mayExist === 'string') return { mayExist: v.mayExist };
  return null;
};

/**
 * Parses the issue state file.
 *
 * @param text - the file's contents.
 * @returns the entries; `null` where the text is not JSON, has no `issues`
 *   object, or holds an entry of no known shape.
 */
export const parseIssueState = (text: string): IssueState | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const issues = typeof parsed === 'object' && parsed !== null ? (parsed as { issues?: unknown }).issues : undefined;
  if (typeof issues !== 'object' || issues === null || Array.isArray(issues)) return null;
  const state: Record<string, IssueEntry> = {};
  for (const [claim, value] of Object.entries(issues)) {
    const entry = entryOf(value);
    if (entry === null) return null;
    state[claim] = entry;
  }
  return state;
};

/**
 * Renders the issue state file.
 *
 * @param state - the entries.
 * @returns the file's contents, ending in a newline.
 */
export const renderIssueState = (state: IssueState): string => `${JSON.stringify({ issues: state }, null, 2)}\n`;

/**
 * Decides, per refuted claim text, whether to open an issue or to render a note.
 *
 * Claims match by text, never by number, because `--at` can read a Changelog
 * in another order. For each distinct refuted claim text, in verdict order:
 *
 * 1. a state entry `{ issue }` renders that id;
 * 2. else a refuted line of the plan's `## Verification` on the default
 *    branch that names an id renders that id;
 * 3. else a state entry `{ pending }` renders `no issue: ` {@link PENDING_REASON};
 * 4. else a state entry `{ mayExist }` renders `no issue: <its reason>`;
 * 5. else a plan line whose `no issue:` reason starts with
 *    {@link ISSUE_MAY_EXIST} renders that reason again;
 * 6. else the claim opens an issue.
 *
 * Steps 3 to 5 hold a claim whose issue may exist, on this machine or on the
 * machine that wrote the plan line. A person clears the hold: once the issue
 * is found, by writing `{ "issue": "<id>" }` as the claim's entry in
 * `.plot/state/verify/<slug>.json`; where no issue exists, by removing the
 * entry, and, for step 5, the plan line's ` — no issue: …` tail.
 *
 * A run opens at most one issue per distinct refuted claim text, so the plan's
 * claim count bounds it; there is no other per-run cap.
 *
 * @param verdicts - what the fold answered.
 * @param recorded - what `refutedClaims` read from the plan on the default branch.
 * @param state - the state file's entries.
 * @returns one step per distinct refuted claim text.
 */
export const issueSteps = (
  verdicts: readonly ClaimVerdict[],
  recorded: readonly RefutedClaim[],
  state: IssueState,
): readonly IssueStep[] => {
  const steps: IssueStep[] = [];
  const seen = new Set<string>();
  for (const verdict of verdicts) {
    const claim = verdict.claim;
    if (verdict.verdict !== 'refuted' || seen.has(claim)) continue;
    seen.add(claim);
    const entry = state[claim];
    const lines = recorded.filter((r) => r.claim === claim);
    const named = lines.find((r) => r.issue !== null)?.issue ?? null;
    const held = lines.find((r) => r.noIssue?.startsWith(ISSUE_MAY_EXIST) === true)?.noIssue ?? null;
    if (entry !== undefined && 'issue' in entry) steps.push({ step: 'note', claim, note: { issue: entry.issue } });
    else if (named !== null) steps.push({ step: 'note', claim, note: { issue: named } });
    else if (entry !== undefined && 'pending' in entry) steps.push({ step: 'note', claim, note: { noIssue: PENDING_REASON } });
    else if (entry !== undefined) steps.push({ step: 'note', claim, note: { noIssue: entry.mayExist } });
    else if (held !== null) steps.push({ step: 'note', claim, note: { noIssue: held } });
    else steps.push({ step: 'open', claim, verdict });
  }
  return steps;
};

/**
 * Settles one `issueOpen` answer into a state entry and a note.
 *
 * `opened` keeps the id. A refusal that starts with {@link ISSUE_MAY_EXIST}
 * keeps `{ mayExist }`, so no later run opens the claim again. Any other
 * refusal keeps no entry, so a later run opens the claim again. A refusal with
 * no text renders `<tracker> refused with no reason`.
 *
 * @param answer - what the call answered.
 * @param tracker - the tracker's scheme, for a refusal with no text.
 * @returns the entry to keep (`null` to remove the claim's entry) and the note to render.
 */
export const settleOpen = (
  answer: OpenAnswer,
  tracker: string,
): { readonly entry: IssueEntry | null; readonly note: IssueNote } => {
  if ('opened' in answer) return { entry: { issue: answer.opened }, note: { issue: answer.opened } };
  const reason = answer.refused ?? `${tracker} refused with no reason`;
  if (reason.startsWith(ISSUE_MAY_EXIST)) return { entry: { mayExist: reason }, note: { noIssue: reason } };
  return { entry: null, note: { noIssue: reason } };
};
