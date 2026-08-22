// A ROW IS A TUPLE — the six slots every kind of row answers, and the
// projection of each kind into them.
//
// Why this is its own module, and not another function in `AgentList.tsx`: the
// projection is a pure decision about what a row SAYS, and the plan that
// introduced it names the file it would otherwise live in as the reason its
// last three attempts drifted — 5,664 lines, eleven commits on 2026-08-20
// alone, and a conflict on nearly every merge that day.
//
// THAT BET PAID. `Row`, `PlanRow` and `IssueRowView` are gone, and the wave
// that deleted them moved rendering ONLY: not one slot rule changed, because
// they were already landed, tested and stable here. What `AgentList.tsx` keeps
// are three ADAPTERS, each answering what only its call site knows — the marks,
// the menu, the second line a stuck branch takes.
//
// It carries no React, so the unit suite tests it as data — which is the other
// half of why the collapse was cheap: the hard decisions were testable without
// a browser, and the browser only had to confirm a layout.
import type { AgentEntry, AgentRow, IssueRow, RowKind } from '../../contract/schema.js';

/**
 * One linked name in a row — slot 4, of which there may be several.
 *
 * `href` is "" where no honest address exists, and the consumer then renders
 * `label` as PLAIN TEXT rather than as a dead control. That is this board's
 * standing rule, stated at `AgentRow.pr.url` and again at `IssueRow.url`: a
 * fabricated URL is indistinguishable from a real one until it 404s.
 *
 * `what` names what the link POINTS AT — `plan`, `branch`, `pr`, `ticket`. It
 * is what makes a row of three links readable rather than three interchangeable
 * words: the requirement the plan states as *the artifact links are
 * associated*. A reader must know what they are about to open before they click.
 */
export interface TupleLink {
  /**
   * `wave` joined the four on 2026-08-20, and the reason is the defect it fixes.
   *
   * A blocked wave links the wave it waits on, and that link was typed
   * `what: 'plan'` — the nearest true value of the four — so it rendered the
   * checklist glyph and read as a link to the plan. Which is precisely the
   * failure the wave kind exists to end: **a wave rendered as something else
   * because no slot admitted it.** Every value here is a `RowKind`, and the
   * icon comes from `KIND_ICON_PATH[what]`, so a missing value is a wrong glyph
   * rather than a missing one — the kind of error that looks like a design.
   */
  what: 'plan' | 'branch' | 'pr' | 'ticket' | 'wave' | 'worktree';
  label: string;
  href: string;
  /**
   * Whether the address is INTERNAL to the board — a plan file the board serves
   * at `/plan/<file>`, as against a page on the git host.
   *
   * Carried because the two want different anchors: an internal link opens a
   * modal on a plain click and navigates on a modified one, and an external one
   * always opens a new tab. Deriving it from the shape of `href` would be a
   * second parser for something the projection already knows.
   */
  internal?: boolean;
}

/**
 * WHAT THE AGE MEANS — one clock, and the one exception that has to say so.
 *
 * Everything but an agent is aged from its LAST CHANGE, unlabelled, because
 * that is the rule. The schema had already reached half of this and written
 * down the reason: the comment on `AgentRow.waitingDays` argues that
 * *"overloading one field with two meanings is precisely the ambiguity that
 * makes `22d` (no commits for three weeks) unreadable beside `22d` (never
 * begun) — so the row labels it rather than merging it"*.
 *
 * The row did not label it. That is what `label` is for, and it is populated
 * exactly where the single rule does not apply:
 *
 *   - a NOT-STARTED row is aged from its plan's approval, which is not a change
 *     to the branch — nothing has changed, that is the point of the row;
 *   - an AGENT does not change, it ACTS, so there is no "last change" to read.
 *     It carries session age and idle, both labelled, because neither is a
 *     change either.
 *
 * So the label marks the exception rather than decorating the rule — the
 * inverse of the phase column, which was unlabelled *because* its meaning
 * varied.
 */
export interface TupleAge {
  /** The duration as the board says it — `45m`, `3h`, `2d`, `today`. */
  text: string;
  /** What clock it is, where that is not the rule. "" where it is. */
  label: string;
}

/**
 * The six slots, as data. One of these is what a tuple row renders.
 *
 * `[icon, kind, name, links*, status, age]` — and slot 4 is ZERO OR MORE, not
 * one. That is the one place the slot count bends, and it bends on purpose: a
 * branch carries no artifact link and a PR carries two (its plan and its
 * branch), so a fixed second slot would force a PR to drop one and the reader
 * would lose whichever lost. The plan states the requirement that outranks the
 * shape here — *every named thing in a row is a link, and there can be more
 * than two.*
 */
export interface TupleRow {
  kind: RowKind;
  /** Slot 2 — the kind, as a word a reader can see without hovering. */
  kindLabel: string;
  /**
   * Slot 3 — the item's own name, and slot 3 is what the row is DECIDING about.
   *
   * A PR's name is its number and its vehicle is the branch; a branch's name IS
   * the branch and its artifact slot is empty. That settles *subject versus
   * vehicle* by construction rather than as a table of cases per kind.
   */
  name: TupleLink;
  /**
   * A tally rendered BESIDE the name, never inside it — `(3)` for a plan row
   * heading three branches.
   *
   * Its own field rather than text appended to `name.label`, because the label
   * becomes the link's accessible name through `linkLabel`: a screen reader
   * would announce *Plan zucchini-glut (3)* as the destination, and the count is
   * a fact about the group rather than part of where the link goes.
   *
   * The `h3` this replaced kept it in a sibling `<span>` for the same reason.
   * Empty where there is nothing to count — a group of one states its size by
   * being one line.
   */
  tally?: string;
  /** Slot 4 — the related things, each linked and each saying what it is. */
  links: TupleLink[];
  /** Slot 5 — where this stands. One slot, whatever the kind. */
  status: string;
  /** Slot 6 — how long, and which clock where that is not the rule. */
  age: TupleAge;
}

/** The word slot 2 shows for each kind. */
export const KIND_LABEL: Record<RowKind, string> = {
  // `Ticket`, and it said `Story` until 2026-08-20. A story is a Plot artefact —
  // an umbrella over several plans, tracked in `docs/stories` — and this row is
  // an ISSUE on the git host that no plan references yet. Two different things,
  // and the row was labelled with the name of the other one.
  ticket: 'Ticket',
  plan: 'Plan',
  pr: 'PR',
  build: 'Build',
  agent: 'Agent',
  branch: 'Branch',
  release: 'Release',
  wave: 'Wave',
};

/**
 * The glyph slot 1 shows for each kind — a SECOND channel, never the only one.
 *
 * The icon exists so a reader recognises the kind at a glance; slot 2 states it
 * in a word so recognition never DEPENDS on decoding a symbol. Both, because
 * the defect this replaces was a kind stated in a tooltip — one channel, and a
 * hover-only one at that.
 */
/**
 * ONE CHARACTER SET, and the reason is measured. The first version mixed emoji
 * (`🎫 📋 🏷`) with symbol characters (`⇅ ⚙ ⬡ ⑂`), and emoji **render in system
 * colour and ignore CSS** — so three of seven appeared yellow-orange while four
 * were grey, and the emoji brought their own metrics so the leading track changed
 * width by kind. Reported from a screenshot, then reproduced on the mock.
 *
 * These are SVG path data rather than glyphs, so the icon takes its colour from
 * `currentColor` and its size from the markup. Shapes follow Octicons (MIT) —
 * a git host's vocabulary for a git host's objects, which a reader already knows:
 * the fork for a branch, the arrow pair for a pull request, the circle for an
 * issue. Paths are inline because the artifact must stay self-contained; nothing
 * is fetched.
 */
export const KIND_ICON_PATH: Record<RowKind, string> = {
  // issue-opened: a ring with a dot — an open question
  ticket: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z',
  // checklist: a plan is a list of intentions
  plan: 'M2.5 1.75v11.5c0 .138.112.25.25.25h3.17a.75.75 0 0 1 0 1.5H2.75A1.75 1.75 0 0 1 1 13.25V1.75C1 .784 1.784 0 2.75 0h8.5C12.216 0 13 .784 13 1.75v7.736a.75.75 0 0 1-1.5 0V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm3.75 1.5h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Zm0 3h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z',
  // git-pull-request: two branches, one merging back
  pr: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
  // play/workflow: a build is something running
  build: 'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z',
  // person: an agent is a who
  agent: 'M10.561 8.073a6.005 6.005 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6.004 6.004 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z',
  // git-branch: the fork
  branch: 'M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
  // tag: a release is a named point
  release: 'M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.75 1.75 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z',
  // stack: three layered planes — a wave is a LAYER of a plan, and layers stack
  // in order, which is the one thing a wave sequence expresses that a plan's
  // checklist does not. Declined: `versions` (reads as release versions) and
  // `git-merge` (too near the PR icon it would sit beside).
  wave: 'M7.122.392a1.75 1.75 0 0 1 1.756 0l5.003 2.902c.83.481.83 1.68 0 2.162L8.878 8.358a1.75 1.75 0 0 1-1.756 0L2.119 5.456a1.25 1.25 0 0 1 0-2.162ZM8.125 1.69a.25.25 0 0 0-.25 0l-4.63 2.685 4.63 2.685a.25.25 0 0 0 .25 0l4.63-2.685ZM1.601 7.789a.75.75 0 0 1 1.025-.273l5.249 3.044a.25.25 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0L1.874 8.814A.75.75 0 0 1 1.6 7.789Zm0 3.5a.75.75 0 0 1 1.025-.273l5.249 3.044a.25.25 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0l-5.248-3.044a.75.75 0 0 1-.273-1.025Z',
};


/**
 * The glyph a LINK wears for what it points at — slot 4's icons.
 *
 * Mostly `KIND_ICON_PATH`, because most `what` values name a kind and a reader
 * who learns the fork means *branch* should read it in both columns. **`worktree`
 * is the exception, and it is why this table exists**: a worktree is a PLACE on
 * this machine, not a board object, so it has no kind and no entry there. It was
 * the first `what` that broke the coincidence `what ⊆ RowKind`, and TypeScript
 * said so rather than letting a row render a missing icon.
 */
export const LINK_ICON_PATH: Record<TupleLink['what'], string> = {
  plan: KIND_ICON_PATH.plan,
  branch: KIND_ICON_PATH.branch,
  pr: KIND_ICON_PATH.pr,
  ticket: KIND_ICON_PATH.ticket,
  wave: KIND_ICON_PATH.wave,
  // file-directory: a worktree is a directory, which is what it is.
  worktree: 'M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1h6.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.909.513-1.237Zm1.237.237a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H7.75a1.75 1.75 0 0 1-1.4-.7l-.9-1.2a.25.25 0 0 0-.2-.1Z',
};

/**
 * How many characters of a branch name are kept at the TAIL when the slot is
 * too narrow to hold all of it.
 *
 * Twelve, measured against the names this fleet actually carries:
 * `agent-rows-line-up` and `acting-buttons-pin-the-double-click` share the
 * prefix `feature/` and diverge immediately, but the six branches of
 * `feature/opus5-hardening-*` share twenty-four characters and differ only
 * after them — `challenge-budget`, `longhorizon`, and so on. Twelve is enough
 * to separate every pair of those six and short enough that it never eats the
 * head on a slot wide enough to matter.
 */
export const BRANCH_TAIL_CHARS = 12;

/**
 * Split a branch name into the part that may be clipped and the part that must
 * not be.
 *
 * The elision is in the MIDDLE, and that is the whole decision rather than a
 * detail of it. Branch names here share long prefixes and differ at the tail —
 * `feature/opus5-hardening-…` covers six branches — so end-truncation renders
 * all six identically, which reads as SIX DUPLICATE ROWS rather than as
 * truncation. That is worse than no truncation at all, because the reader
 * cannot tell that anything was hidden.
 *
 * Returned as two strings rather than one elided string, because the slot's
 * width changes with the window, and a character budget computed in JavaScript
 * would need a `ResizeObserver` on a view that already repaints every four
 * seconds and would be wrong for one frame on every load. The consumer renders
 * the head with `truncate` (which clips at whatever width the browser gives it,
 * adding its own ellipsis) and the tail with `shrink-0`, so the BROWSER decides
 * where the fold falls and the last twelve characters always survive.
 *
 * A name short enough to fit whole yields an empty tail, so a short branch never
 * gains an ellipsis it did not need.
 *
 * IT LIVES HERE, WITH THE SLOT RULES, since `one-component-renders-every-row`.
 * It was `BranchName`'s in `AgentList.tsx`, and the collapse deleted that
 * component — at which point this function had no caller for the length of one
 * commit, and the middle-elision it exists to provide was silently gone: a long
 * branch clipped at the END, which is the six-duplicate-rows defect its own
 * docstring names. A browser test caught it. The function is not the property;
 * *two names sharing a long prefix stay distinguishable* is, and that property
 * belongs to whatever renders a branch name.
 */
export function splitBranch(
  branch: string,
  tailChars: number = BRANCH_TAIL_CHARS,
): { head: string; tail: string } {
  // Nothing to protect: the whole name is shorter than the tail budget, so it
  // is all head and `truncate` has nothing to do.
  if (branch.length <= tailChars) return { head: branch, tail: '' };
  return {
    head: branch.slice(0, branch.length - tailChars),
    tail: branch.slice(branch.length - tailChars),
  };
}

/** Minutes as the board says them: `45m`, `3h`, `2d`. */
export function tupleAgeText(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Days in the unit that reads: `today`, then days, then months. */
export function tupleWaitText(days: number): string {
  if (days < 1) return 'today';
  if (days < 60) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

/**
 * The colour slot 5 wears for a status, or "" for the ordinary tone.
 *
 * **Restored 2026-08-20** — it was lost in `one-component-renders-every-row`,
 * which replaced three row components with one grid and kept the WORDS while
 * dropping the tones. Reported from a screenshot; measured, `conflicts`, `green`
 * and `no checks` all rendered the identical grey.
 *
 * The palette is the deleted `PrCell`'s, verbatim, and so is its rule: **the
 * state is a WORD and colour only reinforces it**, for the two values a reader
 * acts on. Everything else keeps the ordinary tone — a third and fourth colour
 * would make the column a legend to learn rather than a word to read, and
 * `unknown` renders no word at all for the reason stated at `prStatus`.
 *
 * Keyed on the WORD rather than on `pr.state`, because slot 5 holds one string
 * whatever the kind: a wave's `blocked`, a worker's `failed` and a PR's
 * `conflicts` are all *something is wrong here*, and a reader scanning the
 * column should see one vocabulary. That is the collapse's own argument applied
 * to colour — one grid, one status slot, one tone rule.
 */
export function statusTone(status: string): string {
  // The bad news: a conflict, a failing build, a worker that died, a wave that
  // cannot start. `blocked` is deliberately NOT here — an earlier wave holding
  // this one back is the system working, not a fault, and its note already
  // carries the dimmed `time` tone.
  if (/^(conflicts|checks failing|failed|stalled)/.test(status)) {
    return 'text-rose-700 dark:text-rose-400';
  }
  // The good news, and the only other colour: green checks, finished work.
  if (/^(green|delivered|finished)/.test(status)) {
    return 'text-emerald-700 dark:text-emerald-500';
  }
  return '';
}

/**
 * The status word for a row's PR condition — slot 5's vocabulary for a PR.
 *
 * `unknown` yields "" rather than the word *unknown*: the host could not report
 * it, and a row that prints its own ignorance as a status has said nothing in
 * a slot a reader scans. Absent renders as absent.
 */
export function prStatus(pr: NonNullable<AgentRow['pr']>): string {
  // `draft` IS NOT A STATE, and the collapse is what forced that distinction.
  //
  // This returned `'draft'` before consulting the state, on an argument that was
  // sound while slot 5 was the ONLY place a PR's condition appeared: *is this
  // offered for review* outranks *what is it waiting for* in one slot, because
  // a draft is not yours to look at yet whatever its CI says.
  //
  // The row now has two places. `PrCell` used to render draft and state as two
  // badges — deliberately, and `agents-tab` pins it: *folding draft into the
  // state would rebuild the short-circuit that kept WAITING ON A MACHINE empty
  // for three releases*, since the classifier used to return on every draft
  // before the checks were read. The collapse kept that badge, beside slot 5.
  //
  // So the precedence has nothing left to arbitrate: the draft flag has its own
  // element and slot 5 carries the CHECK STATE, which is the fact no other
  // element on the row states. Two facts, two places — which is what the
  // independence argument asked for all along, and what one slot could not give
  // it.
  switch (pr.state) {
    case 'green': return 'green';
    case 'pending': return 'CI running';
    case 'failing': return 'checks failing';
    case 'none': return 'no checks';
    case 'conflicts': return 'conflicts';
    // ABANDONED, and the word says what happened rather than what the checks
    // said when it stopped. `green` on a closed PR is the row claiming *ready*
    // about work somebody decided against.
    case 'closed': return 'closed';
    default: return '';
  }
}

/**
 * The state a PR object reports, as the wire carries it — `AgentRow.pr.state`.
 *
 * Named so the fold below can take a list of them without spelling the enum
 * twice; `PrStateSchema` in the contract is the one authority for the values.
 */
export type PrState = NonNullable<AgentRow['pr']>['state'];

/**
 * What a FOLDED PLAN says about the PR states beneath it — one worst-case word,
 * with a count where more than one branch carries it.
 *
 * A collapsed plan head shows its phase and nothing about the branches under it,
 * so a folded group gives a reader no reason to open it even when a PR two rows
 * down is red. Reported from the live board as *"Wo ist 304?"* — a failing PR
 * sitting under a plan row that read only `Discovery`. This is that orientation:
 * the plan is canonical and slot 5 keeps its phase; this rides BESIDE it.
 *
 * ## The precedence — `conflicts > failing > pending > (green/quiet)`
 *
 * `conflicts` outranks `failing` for the reason `rowKind` already gives it
 * precedence: no PR resolves a conflict, so the errand is a REBASE and it is the
 * reader's, where a failing check is the machine's report on work already
 * pushed. A plan carrying both should send the reader to the harder errand.
 *
 * `pending` is included — a running build is not an errand, but *a machine is
 * working here* is worth a folded reader knowing. The consumer renders it
 * DIMMER than the two actionable words; this function only reports which word.
 *
 * ## What earns NO word — the quiet states, and why they are one set here
 *
 * `green`, `none`, `unknown` and `closed` all return `null`: nothing to act on.
 * A badge on every plan is a badge nobody reads, and *green plans get no badge*
 * is the decision this enforces. `none`/`unknown` are the host declining to
 * answer — a row printing its own ignorance in a slot a reader scans has said
 * nothing, the rule `prStatus` states for `unknown`. `closed` is abandoned
 * work, not a state a reader chases.
 *
 * A branch with NO PR at all contributes no state — a plan of unstarted
 * branches folds to nothing, which is right: there is no PR errand to hide.
 *
 * ## The WORD, not `pr.state`
 *
 * It returns `prStatus`'s vocabulary (`conflicts`, `checks failing`, `CI
 * running`) rather than the raw enum, so slot 5 reads ONE vocabulary whether the
 * word came from a single branch or a fold of five — the collapse's own argument
 * for `statusTone` being keyed on the word.
 */
export function planPrAggregate(
  states: readonly (PrState | null | undefined)[],
): { word: string; count: number; state: PrState } | null {
  // The order IS the precedence — the first state present in the fold wins, and
  // its count is how many branches carry exactly it. `green`/`none`/`unknown`/
  // `closed` are absent from this list on purpose: they earn no word, so a fold
  // of only those states falls through and returns null.
  const RANKED: PrState[] = ['conflicts', 'failing', 'pending'];
  for (const state of RANKED) {
    const count = states.filter((s) => s === state).length;
    if (count > 0) {
      // The WORD from the same table a single-row plan reads, so the fold and a
      // lone branch say the same thing for the same state. `prStatus` takes a PR
      // object; only `state` decides the word, so a minimal one suffices.
      return { word: prStatus({ number: 0, url: '', draft: false, state }), count, state };
    }
  }
  return null;
}

/**
 * The plan link a row carries, or null where it names no plan.
 *
 * INTERNAL, and the address is the board's own `/plan/<file>` route. `planFile`
 * "" means the plan cannot be resolved to a file — a planless branch, or an
 * idea branch whose plan lives on the branch itself — and the name then travels
 * as text with an empty `href`, by the rule at the top of this file.
 */
function planLink(row: AgentRow): TupleLink | null {
  if (!row.plan) return null;
  return {
    what: 'plan',
    label: row.plan,
    href: row.planFile ? `/plan/${encodeURIComponent(row.planFile)}` : '',
    internal: true,
  };
}

/** The branch link a row carries. `branchUrl` is "" for a merged ref. */
function branchLink(row: AgentRow): TupleLink {
  return { what: 'branch', label: row.branch, href: row.branchUrl };
}

/**
 * Project a server row into its six slots.
 *
 * READS `row.kind`, never re-decides it. The kind is the server's judgement —
 * see `RowKindSchema` for why — and this function's job is to lay out the slots
 * that judgement implies, not to form a second opinion about it. A row arriving
 * with a kind this function does not expect still renders: the `default` arm
 * treats it as a branch, which is what an unrecognised row most nearly is, and
 * it is the same fallback the schema's own default states.
 *
 * The three arms differ in ONE decision — which fact is the item and which are
 * artifacts — and that is the whole content of *subject versus vehicle*:
 *
 *   - a `pr` names the PR and links its plan and its branch (three links);
 *   - a `release` names its version if the row knows one, else its PR, and
 *     links the branch;
 *   - a `branch` names the branch and links its plan.
 */
export function tupleFromRow(row: AgentRow, agent?: AgentEntry | null): TupleRow {
  const age: TupleAge =
    // A NOT-STARTED row is aged from its plan's approval, and it says so. The
    // rule is *since last change*, and nothing has changed here — that is what
    // the row reports. So this is an exception and wears its label, exactly as
    // the agent's two clocks do.
    row.ageMinutes === null && row.waitingDays !== null
      ? { text: tupleWaitText(row.waitingDays), label: 'waiting' }
      : { text: row.ageMinutes === null ? '' : tupleAgeText(row.ageMinutes), label: '' };
  const plan = planLink(row);
  const status = row.pr ? prStatus(row.pr) : stateStatus(row);
  // THE KIND FALLS BACK TOO, and it used to be the only one of the three that
  // did not. `icon` and `kindLabel` each guarded against a kind this projection
  // does not know while `kind` itself passed the raw value through — so a row
  // arriving WITHOUT the field rendered a branch's glyph and a branch's word
  // beside `data-tuple-kind` and `data-kind` attributes that were absent
  // entirely, which is a row that looks right and cannot be found.
  //
  // `RowKindSchema.default('branch')` fills it for every row that comes through
  // the parser, and that is most of them. It is not all of them: a suite that
  // fulfils `/api/fleet` from a literal serves rows the schema never saw, and
  // twelve of this estate's browser tests do exactly that. The fallback belongs
  // where the other two already are — one place that answers *what is this row
  // when the field is missing*, rather than two that answer it and one that
  // does not.
  //
  // `'branch'` because that is the value the contract names, for the reason it
  // names: an unrecognised row most nearly IS a branch. This is emphatically
  // not the renderer-side derivation the contract declines — it does not look
  // at `row.pr`, `row.issue` or `row.planFile`, and it cannot reclassify a row
  // the server DID label. It fills one absent field with the one value the
  // contract says an absent field means.
  const kind: RowKind = row.kind && row.kind in KIND_LABEL ? row.kind : 'branch';
  const base = { kind, 
    kindLabel: KIND_LABEL[kind] ?? KIND_LABEL.branch, status, age };

  if (kind === 'pr' && row.pr) {
    // THREE LINKS, and this is the row the varying slot count exists for. The
    // PR is the item; its plan and its branch are both artifacts, both worth
    // opening, and both already on the row — measured on the live pulse, a PR
    // row carries `plan`, `planFile`, `branch`, `branchUrl` and `pr`. Nothing
    // new is fetched; what was missing is that only some of them rendered, and
    // only one of those was a link.
    return {
      ...base,
      name: prLink(row.pr),
      // AND ITS WAVE, where the branch belongs to one — the same artifact the
      // agent row carries, and present on the row all along as `row.wave`.
      //
      // Not every PR has one: a PR on a planless branch reaches the board
      // through a different loop (`changeset-release/main` and `idea/*` come
      // that way) and carries `wave: ''`. So the slot is zero-or-more here too,
      // and the mock holds one of each.
      //
      // NARROWEST FIRST, CONTAINER LAST — wave → branch → plan.
      //
      // This read plan → wave → branch until 2026-08-22, described as *the
      // chain narrowing*. Both orders are internally coherent; what settled it
      // is which end of the chain the reader is looking for. Slot 4 is read
      // beside a NAME that is already the widest thing on the row, so opening
      // with the plan spends the first position on context the row has given —
      // and the plan is the one artifact every kind shares, so leading with it
      // made the column start the same way on every row.
      //
      // The specific thing first means slot 4 differs where the rows differ,
      // and the plan closes each list as the answer to *and what is this part
      // of*. Applied to every arm, so the column reads one direction throughout.
      links: [
        ...(row.wave ? [{ what: 'wave' as const, label: row.wave, href: '' }] : []),
        branchLink(row),
        ...(plan ? [plan] : []),
      ],
    };
  }

  if (kind === 'release') {
    // A release NAMES ITS VERSION where the row knows one, and its PR number
    // otherwise. The version is the thing a reader is deciding about — *is
    // 2.7.0 ready* — and the PR is how it gets there; where no version has
    // been read, the number is the honest name rather than an invented tag.
    const version = releaseVersion(row);
    return {
      ...base,
      name: version && row.pr
        ? { what: 'pr', label: version, href: row.pr.url }
        : row.pr
          ? { what: 'pr', label: `${row.pr.number}`, href: row.pr.url }
          : { what: 'branch', label: row.branch, href: row.branchUrl },
      // THE PR IS AN ARTIFACT, and this is where it belongs. A release row
      // rendered `no checks 240` — the number inside the STATUS cell, which is
      // the *"you cannot put the links to associated artifacts into the status
      // row"* defect. Where the version names the row the PR is a second
      // destination; where the PR already names it, only the branch is left.
      links: row.pr
        ? (releaseVersion(row) ? [prLink(row.pr), branchLink(row)] : [branchLink(row)])
        : [],
    };
  }

  if (kind === 'plan') {
    // A PLAN AWAITING APPROVAL, on its own `idea/` branch — the one plan row the
    // SERVER emits. Every other plan row is assembled by the client from the
    // branches under it (`tupleFromPlan`); this one exists because an idea
    // branch's PR *is* the plan, and `rowKind` says so.
    //
    // The plan is the subject, so slot 3 names it and the PR and branch are its
    // artifacts — the same split a PR row makes, with the roles exchanged: there
    // the PR is the item and the plan is where it came from; here the plan is the
    // item and the PR is how it gets approved.
    //
    // `planFile` is the branch's own plan, which the plan route can read — so
    // the name links where it resolves and stays text where it does not, by the
    // rule `planLink` states.
    return {
      ...base,
      name: plan ?? branchLink(row),
      // PR THEN BRANCH — narrowest first, container last.
      //
      // Reported from the live board: *"Plan shows PR before Branch, but Wave
      // shows Branch before PR — how do we align that"*, on a screen holding
      // both. `PLAN the-plan-is-the-wave  305  idea/the-plan-is-the-wave` sat
      // four rows above `WAVE Modelled  feature/a-wave-is-a-kind  304`, the
      // same two artifacts in opposite orders.
      //
      // The rule is stated on the `pr` arm — *"ordered plan → wave → branch,
      // which is the chain narrowing: the plan holds the wave, the wave holds
      // the branch"* — and the `wave` arm adds where the PR falls: *"AND ITS
      // PR, last — the destination a reader goes to in order to act"*. Both
      // halves put the container before the thing it contains and the ACTION
      // at the end. This arm was the only one ordered against them, and no
      // argument for it was ever recorded.
      links: [...(row.pr ? [prLink(row.pr)] : []), branchLink(row)],
    };
  }

  if (kind === 'build') {
    // A BUILD IS THE RUN, not the branch it ran on — and its artifacts are
    // *branch and optionally PR*, which is the rule the plan settled.
    //
    // This arm did not exist until 2026-08-20, and `tupleFromBuild` beside it
    // had **no caller**: a build row arrives from the server as an `AgentRow`,
    // so it fell through to the branch fallback below. Measured on the mock, the
    // row read `BUILD  feature/a-build-is-running  | CI is running for PR #283 |
    // CI running 283` — the branch as the subject, a sentence where the
    // artifacts belong, and the PR number inside the status cell.
    //
    // ## The name should link to the pipeline run, and CANNOT yet
    //
    // *"Build hat name mit link auf Jenkins oder Github pipeline"* — right, and
    // the address is **not on the wire**. `AgentRow.pr` carries `number`, `url`,
    // `draft` and `state`; nothing carries a checks or run URL, and the host
    // adapter is not asked for one.
    //
    // So the name renders as TEXT, by the rule this board applies without
    // exception: a fabricated URL is indistinguishable from a real one until it
    // 404s, and `CardPrSchema` states the same refusal for the same reason —
    // *"the same arithmetic produces a confidently wrong link for GitHub
    // Enterprise or a self-hosted Bitbucket"*. Guessing
    // `<repo>/pull/<n>/checks` would be that guess.
    //
    // `CI 283` names the run by the PR it ran for, which is the only identity
    // this row holds. An invented `CI:1860` is what `tupleFromBuild`'s own
    // fixture used and what nothing can supply.
    //
    // What is missing to finish it: a `checksUrl` on the PR object, filled by
    // the git-host adapter on the SERVER — GitHub answers it per PR, Jenkins per
    // job. Then this becomes `href: row.pr.checksUrl` and nothing else here
    // changes, because the address arrives on the row like every other fact.
    //
    // (Naming that script here would trip the gate one file over, which forbids
    // its name in this module by scanning the source text. The gate is right and
    // the wording bends: it cannot tell a call from a mention, and the property
    // it protects — *the projection never asks the host anything* — is exactly
    // what makes `checksUrl` a SERVER field rather than a lookup here.)
    return {
      ...base,
      name: row.pr
        ? { what: 'pr', label: `CI ${row.pr.number}`, href: '' }
        : branchLink(row),
      // PR, WAVE AND BRANCH. The PR first, because a run reports to it and that
      // is where a reader goes to read the result; the wave where the branch
      // belongs to one, for the reason the PR arm carries it — a branch cut for
      // a wave keeps that membership through review AND through CI; the branch
      // last, being what was built.
      //
      // The wave is the optional middle here as it is on a PR: a build on
      // `changeset-release/main` belongs to no wave.
      // wave → PR → branch, narrowing outward-in like every other arm. The run
      // itself is the NAME, so slot 4 opens with the slice it ran for, names
      // the PR it reports to, and ends on the branch that was built.
      links: [
        ...(row.wave ? [{ what: 'wave' as const, label: row.wave, href: '' }] : []),
        ...(row.pr ? [prLink(row.pr)] : []),
        branchLink(row),
      ],
    };
  }

  if (kind === 'agent') {
    // AN AGENT IS A WHO, and its artifacts are what it is working ON — the
    // branch, its wave, and the plan. Same gap as `build`: `tupleFromAgent`
    // existed with no caller, so an agent row named its BRANCH and read
    // `AGENT  feature/an-agent-is-working  | plan … worker running | open`.
    //
    // `open` was the branch's state, which says nothing about an agent — an
    // agent's status is what it is DOING. The row's `worker` field is that, and
    // it is the one fact no other row carries.
    //
    // ## Its artifacts are WAVE, BRANCH and WORKTREE
    //
    // *"ein AGENT hat als zu bearbeitende artefakte eine wave (mit branch),
    // worktree, plan und einen status"* — and all of it is on the wire, on two
    // objects that join by branch: `AgentRow` holds `wave` and `branch`, while
    // `fleet.agents` holds `session`, `worktree` and `command`. That join is
    // what `tupleFromAgent` was written for and why it never had a caller.
    //
    // The registry half arrives as `agent`, passed by the adapter — this
    // projection is given a row and cannot look anything up.
    //
    // The NAME is the session id, shortened, with no href: the overlay is a
    // local panel the ROW opens, not an address. `href: ''` renders it as text
    // and the adapter makes it a control — which is why the row, not the
    // projection, owns the click.
    //
    // `Inverted` used to render as the old wave BADGE beside the branch name;
    // it is an artifact link now, like every other named thing on the row.
    return {
      ...base,
      status: workerStatus(row.worker) || base.status,
      name: agent?.session
        ? { what: 'ticket', label: shortSessionId(agent.session), href: '' }
        : branchLink(row),
      // worktree → branch → wave → plan, narrowest first like every other arm.
      // A worktree is one checkout OF a branch, a branch is one slice of a
      // wave, and the plan closes the list.
      links: [
        // THE WORKTREE — where the agent is actually working, and the one
        // artifact no other kind has. Text, not a link: it is a local path and
        // a browser cannot open one. Basename only, because the full path is
        // `/Users/…/plot-wt-<branch>` and the leading half repeats on every row;
        // the panel shows it in full and copyable.
        ...(agent?.worktree
          ? [{ what: 'worktree' as const, label: worktreeName(agent.worktree), href: '' }]
          : []),
        branchLink(row),
        ...(row.wave ? [{ what: 'wave' as const, label: row.wave, href: '' }] : []),
        ...(plan ? [plan] : []),
      ],
    };
  }

  // A BRANCH names itself, and its artifact slot holds the plan that governs it
  // — or NOTHING, where no plan does. Nothing renders as nothing: an empty slot
  // is not a dead control, the rule this board already applies to a PR cell
  // with no PR.
  return {
    ...base,
    name: branchLink(row),
    // AND ITS PR, where it has one. A branch row is a branch row precisely when
    // the PR cannot resolve it (a merge conflict), so the branch is the SUBJECT
    // — but the PR is still a destination, and `fleet.ts` carries the warning
    // about erasing it: *a branch started and then shelved read as never begun,
    // with its age and its PR erased*. Leading with the branch was about which
    // fact is the subject; it was never an argument for dropping the other.
    //
    // It used to reach the reader as a badge in SLOT 5, beside the status — an
    // artifact in the status cell, which is the defect the tuple exists to end.
    // PR THEN PLAN — the narrow thing first, the container that answers *part
    // of what* last, the order every arm here uses.
    links: [...(row.pr ? [prLink(row.pr)] : []), ...(plan ? [plan] : [])],
  };
}

/**
 * The worktree as a row shows it — its last path segment.
 *
 * A dispatch worktree is `<parent>/plot-wt-<branch>`, so the leading half is
 * identical on every agent row and the branch name is already in slot 4 beside
 * it. The basename is what distinguishes one from another; the agent panel shows
 * the full path, copyable, which is where a reader who needs to `cd` goes.
 */
export function worktreeName(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path;
}

/** The PR as an artifact link — slot 4's form of a pull request. */
function prLink(pr: NonNullable<AgentRow['pr']>): TupleLink {
  return { what: 'pr', label: `${pr.number}`, href: pr.url };
}

/**
 * What an AGENT is doing, as slot 5's word — from `worker`, not from `state`.
 *
 * `state` is the branch's; an agent row showing `open` was reporting that
 * nobody had taken the branch, on a row about the agent that had. The eight
 * worker states are the answer, and the two TASK states matter most: every
 * worker exits 0, so `waiting` and `stalled` are the only way the row can say
 * the work did not finish with the process.
 *
 * "" where the worker state says nothing about activity (`none`, `elsewhere`),
 * so the caller falls back to the branch's state rather than printing a word
 * about a worker this machine cannot see.
 */
export function workerStatus(worker: AgentRow['worker']): string {
  switch (worker) {
    case 'running': return 'working';
    case 'finished': return 'finished';
    case 'failed': return 'failed';
    case 'ended': return 'ended';
    case 'waiting': return 'waiting on you';
    case 'stalled': return 'stalled';
    default: return '';
  }
}

/**
 * The version a release row is about, or "" — read from the branch, never
 * invented.
 *
 * **`row.version` now, and the field is READ from `package.json` on the release
 * branch.** This used to test whether the plan SLUG looked like a version, which
 * was true for no row this board has ever rendered: changesets names its branch
 * `changeset-release/<base>`, so the slug carries the base and the fallback to
 * the PR number fired every single time — measured, `RELEASE 240` where the
 * release is 2.7.0.
 *
 * The refusal that shaped the old version stands and is worth keeping straight:
 * *deriving* `2.7.0` by reading and summing pending changeset bumps is *what
 * would this ship*, a question this board must not answer. But on a
 * `changeset-release/*` branch that sum is already computed and written down by
 * the tool whose job it is — verified 2026-08-20,
 * `origin/changeset-release/main:package.json` reads `2.7.0` where `main` reads
 * `2.6.0`. Reading a file is not deriving a decision.
 *
 * The slug test is KEPT as a second source, because it costs nothing and a repo
 * that names a plan after a version is a repo where that is the answer.
 */
export function releaseVersion(row: AgentRow): string {
  if (row.version) return row.version;
  return /^\d+\.\d+\.\d+/.test(row.plan) ? row.plan : '';
}

/**
 * Slot 5 for a row with no PR — its git state, as a word.
 *
 * The row's `note` is deliberately NOT used. It is a sentence composed by the
 * server for a reader, and this slot holds one value a reader scans down a
 * column; the standing rule stated at `ELIGIBLE_NOTE` is that nothing new may
 * be built on matching prose, and picking a status out of a note is exactly
 * that. `state` is the field that answers this.
 */
export function stateStatus(row: AgentRow): string {
  switch (row.state) {
    // `delivered`, not `merged` — Plot's own word for the transition, and the
    // one its lifecycle names: a plan goes Draft → Approved → **Delivered** →
    // Released, and `/plot-deliver` is what performs it. `merged` describes what
    // git did to a ref; `delivered` describes what happened to the work, which is
    // what a reader of the DONE section is looking at.
    //
    // A DISPLAY word only. `BranchStateSchema` keeps `merged`, because that is
    // the scan's vocabulary and the state IS the ref's — the same split
    // `prStatus` makes between `pr.state` and the words it prints.
    case 'merged': return 'delivered';
    case 'claimed': return 'claimed';
    case 'deferred': return 'deferred';
    case 'wip': return 'in progress';
    case 'open': return 'open';
    default: return '';
  }
}

/**
 * Project a tracker issue into the six slots.
 *
 * The NAME IS TEXT and stays text where the tracker gave no address — and the
 * name is the TITLE rather than the number, because the title is what a reader
 * decides about. The number rides in the link slot, pointing at the tracker,
 * which is where a reader goes to read it: item and artifact, the same split
 * every other kind makes.
 *
 * **The age is carried.** A ticket open for three weeks is exactly what WAITING
 * ON YOU orders by, so dropping it would make the section's own sort key
 * invisible on one of its four kinds.
 */
export function tupleFromIssue(issue: IssueRow): TupleRow {
  return {
    kind: 'ticket',
    kindLabel: KIND_LABEL.ticket,
    name: { what: 'ticket', label: `${issue.number}: ${issue.title}`, href: issue.url },
    links: [],
    // `open`, and it is the only status an UNPLANNED issue has: the tracker
    // reports open issues and this list is filtered to the ones no plan
    // references. A closed one is not here to have a status.
    status: 'open',
    age: {
      text: issue.ageMinutes === null ? '' : tupleAgeText(issue.ageMinutes),
      label: '',
    },
  };
}

/**
 * What a tuple row needs about a PLAN — the client's own grouping, not a server
 * row.
 *
 * A plan row is assembled from the branches beneath it (`groupByPlan`), so
 * there is no `AgentRow` for it and nothing to read `kind` off. The kind is
 * stated at THIS construction site instead, which is the same rule: the kind is
 * declared where the row is created, never sniffed from another row's fields.
 */
export interface PlanRowFacts {
  /** How many rows this plan heads, where it heads more than one. */
  rowCount?: number;
  plan: string;
  planFile: string;
  /** The plan's phase, which is slot 5 — this is the object it belongs to. */
  phase: string;
  /** Days since approval, or null. A plan's clock is its approval. */
  waitingDays: number | null;
  /** The branch this plan's work sits on, where the row names one. */
  branch?: string;
  branchUrl?: string;
}

/**
 * Project a plan into the six slots.
 *
 * **The phase belongs HERE**, and this is the object it describes. 71 branch
 * rows printed their plan's phase — 36 `Development`, 26 `Endgame`, 9 `Design`
 * — a fact about the plan on a row about something else. Slot 5 on the PLAN row
 * is where that fact is true.
 *
 * The age is `waitingDays`, labelled. A plan's branches have no tip, so the
 * commit clock has nothing to say and the approval clock is the only one
 * running — which is not a change to the plan, so it wears its label like every
 * other exception.
 */
export function tupleFromPlan(facts: PlanRowFacts): TupleRow {
  return {
    kind: 'plan',
    kindLabel: KIND_LABEL.plan,
    name: {
      what: 'plan',
      label: facts.plan,
      href: facts.planFile ? `/plan/${encodeURIComponent(facts.planFile)}` : '',
      internal: true,
    },
    links: facts.branch
      ? [{ what: 'branch', label: facts.branch, href: facts.branchUrl ?? '' }]
      : [],
    ...(facts.rowCount != null && facts.rowCount > 1
      ? { tally: `(${facts.rowCount})` }
      : {}),
    status: facts.phase,
    age: {
      text: facts.waitingDays === null ? '' : tupleWaitText(facts.waitingDays),
      label: facts.waitingDays === null ? '' : 'waiting',
    },
  };
}

/** The name the board shows for a wave the plan file did not name. */
// Re-exported from the contract, where the ONE definition lives — the
// server writes this value and both clients test for it.
/**
 * The name a wave with no `###` heading shows — a LITERAL here, deliberately.
 *
 * The one definition lives in the contract as `UNNAMED_WAVE`, and this module
 * cannot import it: a gate asserts *"One import, and it is the contract's
 * types"*, because the projection must not reach for behaviour. That gate is
 * right, and a string is not worth bending it for.
 *
 * This is a DISPLAY fallback. Nothing compares against it — the server decides
 * which waves are unnamed and the contract holds the value both sides test.
 */
const UNNAMED_WAVE_LABEL = '(unnamed)';

/**
 * What a tuple row needs about a WAVE — a slice of a plan, with its own verdict.
 *
 * **A wave HAS branches; a branch does not have a wave.** The scan has emitted
 * `{name, verdict, branches}` per wave since waves existed. The board read the
 * name onto the branch row as a string, dropped the verdict onto that same row
 * as a nullable field nothing rendered, and then rebuilt the verdict as ENGLISH
 * in `blockedNote()`. Every piece was already on the wire.
 *
 * Client-assembled, like `PlanRowFacts` and for the same reason: the server
 * emits one row per branch, and the wave is the group those rows fall into. So
 * this is facts-in rather than a row-in, and the kind is declared here at the
 * construction site.
 */
export interface WaveRowFacts {
  /** The wave's name, or "" where the plan file named none. */
  name: string;
  /** The plan the wave is a slice of — for the row's identity, not for a link. */
  plan: string;
  /**
   * The scan's verdict — slot 5. `null` where the scan reported none, and then
   * the status is "" rather than a guessed word.
   */
  verdict: 'complete' | 'eligible' | 'blocked' | null;
  /** The branches this wave holds — slot 4, and there may be five. */
  branches: { branch: string; branchUrl: string }[];
  /**
   * The wave holding this one back, by name — `null` where nothing is.
   *
   * **A REFERENCE, and it renders AS AN INFO MARK IN SLOT 5**, beside the status
   * it explains, with the wave named on hover and in its accessible label.
   *
   * Two other placements were tried and measured first, both failing because the
   * reference is a SENTENCE and no slot on this row is spare: slot 4 put a
   * pointer *up* among links pointing *down*, and beside the name in slot 3 the
   * blocker text won the width fight against the name itself — `Relocated`
   * rendered as `R…` and `Moved` as `M`, so the row lost the one thing it exists
   * to say. `blocked` is the fact a reader scans down the column; *which wave*
   * is a follow-up about one row, and a follow-up belongs behind a disclosure.
   *
   * The server has carried this as `blockedBy`
   * all along while the board rendered the same fact as English:
   * `blocked by Relocated — 1 outstanding`, composed by `blockedNote()` and
   * printed into the note column. That sentence is three facts, and each has a
   * slot:
   *
   *   `blocked`        the verdict         → slot 5, with the count
   *   `by Relocated`   a reference         → slot 5, as an info mark
   *   `1 outstanding`  a count             → the RELOCATED row, not this one
   *
   * Carried on the facts rather than read by `tupleFromWave`, because slot 3's
   * `beside` belongs to the renderer: the projection decides what a row SAYS
   * and `TupleRowView` decides what sits inside a slot. `WaveRow` passes it.
   *
   * The third fact is the one that says why this had to move at all. It counts
   * what is unfinished in the BLOCKER, so a wave holding three others back
   * printed `1 outstanding` three times, once on each waiting row, describing a
   * row the reader had to find by name. It belongs on the wave it is about.
   */
  blockedBy: string | null;
  /**
   * How many of this wave's branches the SECTION is counting, and the word for
   * what the count means — `null` where the verdict is what slot 5 should say.
   *
   * It REPLACES the verdict: `3 to review`, `2 stalled`, `2 delivered`. The
   * verdict answers *may this wave be started*, and every wave grouped this way
   * already was — measured, `opus5-longhorizon-hardening :: Implementation`
   * reads `blocked` with five landed branches, so the verdict would tell a
   * reader to wait while five reviews wait on them.
   */
  groupedCount?: number | null;
  /** The word for what `groupedCount` counts — `to review`, `stalled`, … */
  groupedWord?: string;
  /**
   * The status of the ONE branch this wave holds — outranks the verdict, because
   * a wave of one has no fold and so no second row to carry it.
   *
   * `conflicts` and `checks failing` are the host's answer about that branch, and
   * no verdict computed from ordering can express either.
   */
  soleStatus?: string;
  /**
   * The PR and the plan of the ONE branch this wave holds — its ARTIFACT LINKS,
   * which a branch row carried and a wave of one must therefore carry too.
   *
   * A wave of one has no fold, so this row is the only row that branch gets.
   * Measured when they were absent: `expected 'Kind: Wave w branch
   * feature/phone…' to contain 'lonely-plan'` — the plan link, gone from a row
   * that had it. `WaveRow` was written for NOT STARTED, where a branch has
   * neither; every other section's branches have both.
   *
   * Ordered plan → wave's branches → PR in the projection, the same chain a PR
   * row reads.
   */
  solePr?: { number: number; url: string } | null;
  solePlan?: { slug: string; file: string } | null;
  /**
   * How many of THIS wave's branches are still unfinished — `null` where the
   * question does not apply.
   *
   * Its own count, on its own row: `Relocated` says how much is left in
   * `Relocated`. That is what makes it a fact rather than a note, and it is why
   * the row waiting on it needs only the reference.
   */
  outstanding: number | null;
  /** Minutes since the wave last changed, or null. */
  ageMinutes: number | null;
  /** Days since the plan's approval, where that is the only clock running. */
  waitingDays: number | null;
}

/**
 * Project a wave into the six slots.
 *
 * **Its links are its BRANCHES, and they carry no `PLAN` prefix — because they
 * are not its provenance.** A wave contains its work; it did not come from it.
 * The plan is what the wave sits UNDER, and that nesting is the statement, which
 * is why the plan is absent from the links entirely rather than present without
 * a prefix. Measured on the mock before this existed: `PLAN fleet-scan-asks-the-host`
 * rendered three times directly beneath the plan row heading those three rows.
 *
 * **The name is text, never a link.** A wave is a heading inside a plan file and
 * has no page of its own — the same reason the wave badge it replaces was a mark
 * rather than an anchor. Linking it to the plan file would make three sibling
 * waves three links to one document.
 *
 * **`(unnamed)` renders rather than failing.** Six of this estate's 71 waves
 * predate the naming convention and the server already substitutes for them at
 * `fleet.ts`. Refusing to render them would make six real waves invisible to
 * punish six old plan files, and the board is not where an authoring convention
 * is enforced.
 */
export function tupleFromWave(facts: WaveRowFacts): TupleRow {
  return {
    kind: 'wave',
    kindLabel: KIND_LABEL.wave,
    name: { what: 'plan', label: facts.name || UNNAMED_WAVE_LABEL, href: '' },
    // SLOT 4 HOLDS WHAT THE WAVE CONTAINS, and only that. Its branches, and
    // nothing pointing the other way.
    //
    // The blocker lived here for one commit, first in the list, on the argument
    // that *why can I not start this* outranks *what is in it*. Rendered, that
    // put a reference pointing UP among links pointing DOWN — `wave Relocated`
    // ahead of two branch links, in a column headed `Related` whose every other
    // kind reads one direction. The blocker qualifies the NAME, so it goes
    // beside the name: *Moved, blocked by Relocated*. Same positional rule the
    // wave badge followed beside a branch — adjacent to the thing it is about.
    // PR → branch → plan, narrowest first, like every other kind.
    //
    // The PR led this list until 2026-08-22 argued from the other end — *AND
    // ITS PR, last, the destination a reader goes to in order to act*. That is
    // true of the PR and does not settle the ORDER: acting is what the reader
    // does after finding the row, and slot 4 is what they scan while finding
    // it. Scanning wants the distinguishing thing first.
    links: [
      // THE PR, where this wave stands in for a single branch that has one.
      ...(facts.solePr ? [{
        what: 'pr' as const,
        label: `${facts.solePr.number}`,
        href: facts.solePr.url,
      }] : []),
      ...facts.branches.map((b) => ({
        what: 'branch' as const,
        label: b.branch,
        href: b.branchUrl,
      })),
      // AND THE PLAN LAST, where this wave stands in for a single branch that
      // named one. Absent on a multi-branch wave: there the plan is the row
      // above and the nesting states it, which is the rule this kind was built
      // on — and the reason the container closes the list rather than opening
      // it, since a list that ENDS in the plan can simply stop where the
      // nesting already answers.
      ...(facts.solePlan ? [{
        what: 'plan' as const,
        label: facts.solePlan.slug,
        href: facts.solePlan.file ? `/plan/${encodeURIComponent(facts.solePlan.file)}` : '',
        internal: true,
      }] : []),
    ],
    // THE VERDICT THE SCAN ALREADY COMPUTED, and nothing derived beside it.
    // `open` was what these rows showed — the branch's `state`, which is a fact
    // about a branch and says nothing about whether the wave can be started.
    // "" for a null verdict, by the rule `prStatus` states for `unknown`: a row
    // printing its own ignorance in a column a reader scans has said nothing.
    // THE VERDICT, AND THIS WAVE'S OWN COUNT WITH IT. `blocked` alone does not
    // say how much is left, and `2 left` alone does not say whether anyone may
    // start it — so slot 5 carries the verdict and the size of what remains,
    // which are both facts about THIS wave.
    //
    // Only where there is more than one, since `1 left` beside a single branch
    // link in slot 4 states what that link already shows. The count earns its
    // place exactly when the branches are folded out of sight.
    status: facts.soleStatus
      ? facts.soleStatus
      : facts.groupedCount != null
      ? `${facts.groupedCount} ${facts.groupedWord || 'to review'}`
      : facts.verdict
        ? (facts.outstanding !== null && facts.outstanding > 1
            ? `${facts.verdict} · ${facts.outstanding} left`
            : facts.verdict)
        : '',
    age: facts.ageMinutes !== null
      ? { text: tupleAgeText(facts.ageMinutes), label: '' }
      : facts.waitingDays !== null
        ? { text: tupleWaitText(facts.waitingDays), label: 'waiting' }
        : { text: '', label: '' },
  };
}

/**
 * What a tuple row needs about a BUILD — a CI run the board reports on.
 *
 * No row is emitted for a build today, and the kind is designed anyway: the
 * slot list is a shape, and a shape admitting only what exists has to be
 * reopened per kind — which is how three components and two grids happened.
 * The facts are already on a row (`pr.state`, and the failing checks `stuck`
 * carries), so this is a projection waiting for a caller rather than a source
 * waiting to be fetched.
 */
export interface BuildRowFacts {
  /** What the run is called — `CI:1860`, or the check's name. */
  name: string;
  /** Where the run can be read, or "". */
  url: string;
  /** The PR the run is for, and the link back to it. */
  prNumber: number | null;
  prUrl: string;
  /** Where it stands — `running`, `failing`, `green`. */
  status: string;
  /** Minutes since the run last changed. */
  ageMinutes: number | null;
}

/** Project a CI run into the six slots. */
export function tupleFromBuild(facts: BuildRowFacts): TupleRow {
  return {
    kind: 'build',
    kindLabel: KIND_LABEL.build,
    name: { what: 'pr', label: facts.name, href: facts.url },
    // The build points BACK along the chain at the PR it ran for, where a
    // ticket points forward at the plan it became. Direction is a property of
    // the pair rather than a rule the reader has to hold, because both slots
    // are linked and each says what it is.
    links: facts.prNumber === null
      ? []
      : [{ what: 'pr', label: `PR ${facts.prNumber}`, href: facts.prUrl }],
    status: facts.status,
    age: {
      text: facts.ageMinutes === null ? '' : tupleAgeText(facts.ageMinutes),
      label: '',
    },
  };
}

/**
 * What a tuple row needs about an AGENT.
 *
 * **The name is the SESSION ID**, shortened for display — never an invented
 * handle. The plan that proposed this kind wrote `@Dev-Agent` in its example,
 * and that name was dropped as a placeholder that was never a fact: agents
 * already have a real identity, the session id the runtime writes as its
 * transcript filename, which is what the agent manifest keys on *because it
 * survives the branch*. See `transcriptFile`, which already resolves a session
 * by that id.
 *
 * No agent row is emitted today — the registry is not merged — and this is the
 * kind whose absent data the plan names as a risk rather than discovers later.
 */
export interface AgentRowFacts {
  /** The session id, as the runtime writes it. */
  sessionId: string;
  /** The branch the agent holds, and its address. */
  branch: string;
  branchUrl: string;
  /** What it is doing — `thinking`, `waiting`, `stalled`. */
  status: string;
  /** Seconds since the run began, or null. */
  sessionSeconds: number | null;
  /** Seconds since the transcript last moved, or null. */
  idleSeconds: number | null;
}

/**
 * How much of a session id a row shows.
 *
 * Eight characters, the same prefix length git uses for an abbreviated hash and
 * for the same reason: enough to tell two apart at a glance, short enough to
 * sit in a slot. The FULL id stays available to the caller — this shortens for
 * display and discards nothing.
 */
export const SESSION_ID_CHARS = 8;

/** The displayed form of a session id — shortened, never renamed. */
export function shortSessionId(id: string): string {
  return id.slice(0, SESSION_ID_CHARS);
}

/**
 * Project an agent into the six slots.
 *
 * **The age slot carries TWO labelled clocks, and the agent is the only kind
 * that does.** An agent does not change, it acts — so the single rule (*since
 * last change*) has nothing to read. What a reader wants instead is *how long
 * has this run been going* and *how long has it been silent*, and the second is
 * the one that says whether it is stuck. Both are labelled, because neither is
 * a change to the agent:
 *
 *     ⬡ agent  f30b27a3   feature/x   thinking   27m · idle 4m
 */
export function tupleFromAgent(facts: AgentRowFacts): TupleRow {
  const session = facts.sessionSeconds === null
    ? '' : tupleAgeText(Math.floor(facts.sessionSeconds / 60));
  const idle = facts.idleSeconds === null
    ? '' : tupleAgeText(Math.floor(facts.idleSeconds / 60));
  return {
    kind: 'agent',
    kindLabel: KIND_LABEL.agent,
    // The session id, and nothing else. It is not a link: the transcript is a
    // local file, and the board's own agent panel is what opens it — reached
    // from the row's menu, where actions live.
    name: { what: 'ticket', label: shortSessionId(facts.sessionId), href: '' },
    links: [{ what: 'branch', label: facts.branch, href: facts.branchUrl }],
    status: facts.status,
    age: {
      text: [session, idle && `idle ${idle}`].filter(Boolean).join(' · '),
      // BOTH clocks are labelled, and the label says which is which. `session`
      // is the run's age and `idle` is its silence; the text carries the second
      // word inline because the two numbers sit side by side and a single
      // trailing label could only name one of them.
      label: session ? 'session' : '',
    },
  };
}
