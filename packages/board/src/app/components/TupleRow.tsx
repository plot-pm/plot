// ONE ROW COMPONENT FOR ALL SEVEN KINDS.
//
// The board reached seven kinds of row through three components and two
// competing grid definitions, and the third component — a TICKET — rendered
// through the tracks of a BRANCH: no wave, no worker, no branch, but wearing
// the columns of something it is not, because there was no third grid to give
// it. Three fill sites is how the two grids drifted apart, and a shared grid
// with three fillers would have kept that possible while adding a contract —
// which is why the collapse replaced the three rather than merging their
// grids.
//
// This renders a {@link TupleRow} — six slots, projected from whatever the kind
// is by `src/app/lib/tuple-row.ts`. `Row`, `PlanRow` and `IssueRowView` are
// GONE: the wave that landed this component deleted nothing on purpose, and the
// wave that deleted them moved rendering only, because the shape and the
// projection were already landed and tested.
//
// What the collapse added here is the pass-through set below — `id`, `rowAttr`,
// `highlighted`, `bordered`. Every one of them is a fact about WHERE A ROW SITS
// rather than what it says, which is why none of them reached the tuple: a
// scroll anchor, an arrival ring and a rule between groups are the section's
// business, and the six slots are the row's. They are props rather than
// hardcoded because the three call sites disagree about all four, and a
// component that guessed would be the fourth fill site this wave exists to
// remove.
import type { MouseEvent, ReactNode } from 'react';
import type { TupleLink, TupleRow as TupleRowData } from '../lib/tuple-row.js';
import { splitBranch } from '../lib/tuple-row.js';

/**
 * The tuple's tracks — six slots, and the FOURTH is the flexible one.
 *
 * ```
 * 1.5rem  4.5rem  12rem   1fr     8rem     4.5rem   1.25rem
 * marks   kind    name    links   status   age      menu
 * ```
 *
 * **The links track takes `1fr`, where a branch row's own NAME used to.** That
 * is the one geometric consequence of slot 4 being zero-or-more: a PR carries
 * two links and a branch none, so the track that varies is the track that must
 * absorb the slack. Every other slot is bounded by what it holds — a kind is
 * one word, a status is one word, an age is four characters.
 *
 * The fixed tracks total 508 px and the six gaps and 24 px of padding add 96,
 * so the grid needs **604 px** before the links track gets a pixel — under the
 * 640 px `sm` breakpoint the rest of the board turns into cards at, with 36 px
 * to spare. That arithmetic is the constraint `ROW_TRACKS` records having
 * crossed by 8 px once, and any widening of a fixed track has to be checked
 * against it again.
 *
 * > These numbers read 496 / 580 / 60 until 2026-08-20, when the collapse gave
 * > the constant a test that computes them. The error was one uncounted GAP:
 * > `84` is five gaps plus padding, correct for six tracks, and this has seven.
 * > It shipped no defect — 604 is still under 640 — but the margin a later
 * > widening would have been checked against was overstated by 24 px, which is
 * > the same failure `ROW_TRACKS` records making and warns is *reassuring*.
 *
 * The MARKS track is 1.5rem and comes first, matching the existing rows, so the
 * activity marks of a tuple row and of a `Row` beside it stay in one vertical
 * line — the property `agent-rows-line-up` paid to establish.
 */
export const TUPLE_TRACKS =
  'grid-cols-[1.5rem_4.5rem_12rem_1fr_8rem_4.5rem_1.25rem]';

/**
 * SLOT 1's CELL — the marks track, and it is declared HERE because the tuple is
 * what renders it.
 *
 * `AgentList.tsx` re-exports it as `ACTIVITY_MARK_PLACE.row`, which is the name
 * the fleet's suites already assert on and the name `ActivityMark` reads for
 * its `heading` sibling. One string, two names, and the direction of the
 * dependency is the point: the ROW owns where its marks sit, and the section
 * borrows that answer for the heading it draws above them.
 *
 * Every clause is load-bearing and was paid for:
 *
 *   - **In the flow, not `absolute`.** `sm:absolute sm:left-0` put the mark at
 *     the row's edge — OUTSIDE the section's border, so every mark straddled
 *     the panel edge, and two marks on one row overlapped because absolute
 *     boxes do not make room for each other.
 *   - **`flex-col` with a gap**, so a row carrying several marks stacks them.
 *   - **No padding of its own.** The row already carries `py-2`; a second pair
 *     here made every row as tall as a two-line one — measured, a plain row and
 *     a row with a status line both came out at 60px, which would have made
 *     every alignment assertion hold on the defect too.
 *   - **`self-stretch`** takes the row's full height, so the marks centre
 *     against whatever the row grew to. The height comes from the row's
 *     content, never from this cell.
 */
export const MARKS_CELL =
  'relative flex w-full shrink-0 flex-col items-start justify-center gap-1 self-stretch';

/**
 * The VALUE-carrying attribute a link keeps, beyond `data-tuple-link`.
 *
 * `data-tuple-link` says what SORT of thing a link points at, which is what the
 * tuple's own assertions read. These say WHICH one, and that is a different
 * question — `[data-branch="feature/x"]` is how a test finds one row among a
 * hundred, and it is the hook the fleet's suites were built on long before the
 * tuple existed.
 *
 * Both, because the collapse must not make the fleet's suites unwritable. The
 * alternative — rewriting 48 `data-branch` assertions onto
 * `[data-tuple-link="branch"]` with a text match — trades an exact attribute
 * lookup for a substring comparison, on names that share twenty-four characters
 * of prefix in this very fleet (`feature/opus5-hardening-*`). That is a worse
 * hook, bought with a large diff.
 *
 * ONLY where the value is an identity. A `plan` link's label is the plan's
 * slug and the row already carries `data-plan-row` where a plan is the subject;
 * a `pr` link's identity is its number, which `data-pr-link` marked on the
 * anchor rather than on the row.
 */
function valueAttr(link: TupleLink): Record<string, string> {
  if (link.what === 'branch') return { 'data-branch': link.label };
  // ONLY `branch`, and the omission of `ticket` is deliberate rather than an
  // oversight. `what: 'ticket'` is worn by TWO different things — an issue's
  // number-and-title, and an AGENT's session id — so a hook keyed on it would
  // stamp `data-issue-link` on an agent row. The kind is what tells them apart
  // and this function is not given it; the adapter is, so a ticket's hooks are
  // passed as `nameAttr` from the one call site that knows the row is a ticket.
  //
  // `branch` has no such ambiguity: every `what: 'branch'` link on every kind
  // is a branch, which is exactly why it can be answered here once for all
  // seven rather than at each of three call sites.
  return {};
}

/**
 * One linked name — or the same name as plain TEXT where there is no address.
 *
 * **A missing address renders as text, never as a dead control.** This board's
 * standing rule, stated at `AgentRow.pr.url` and at `IssueRow.url` for the same
 * reason: an invented URL is indistinguishable from a real one until it 404s,
 * and a control that goes nowhere is a control that lies.
 *
 * `data-tuple-link` carries WHAT the link points at, so a reader hovering and a
 * test asserting both get the association the plan requires — *each linked name
 * is visibly attached to the item it belongs to, so a reader knows what they are
 * about to open before they click.* The visible form of that association is the
 * prefix: a PR row's two artifact links read `plan …` and `branch …` rather than
 * as two interchangeable words.
 *
 * **`data-branch` rides along on a branch link, and it is not decoration.** It
 * is how twelve test files find *the row for this branch* among a hundred, and
 * the collapse had to decide whether that hook was a fact about `BranchName`
 * (which is gone) or about the branch name wherever it renders. It is the
 * second: the attribute names the VALUE, not the component that happened to
 * print it, so it moves to `valueAttr` below and every one of those assertions
 * keeps an owner.
 */

/**
 * A BRANCH NAME, folded in the MIDDLE when the slot cannot hold it.
 *
 * Two spans rather than one: the head clips (`truncate`, so the browser adds its
 * own ellipsis at exactly the width it has) and the tail does not (`shrink-0`),
 * which is middle-elision performed by the LAYOUT rather than by arithmetic.
 * See `splitBranch` for why the tail is the half that must survive — six
 * branches here share twenty-four characters of prefix, so end-truncation
 * renders them identically and reads as six duplicate rows.
 *
 * `aria-hidden` on the two halves, with the whole name supplied by the anchor's
 * own `title` and by `data-branch`. Measured: the halves are flex ITEMS, and the
 * accessible-name algorithm joins adjacent boxes with a space — the row
 * announced `feat ure/reviewed`, a branch name no host would recognise and one
 * no reader could search for. The fold is a fact about the slot's width, so it
 * belongs to the visual channel alone.
 *
 * ONLY a branch. A plan slug, a PR number and an issue title do not share long
 * prefixes with their neighbours, so they clip at the end like ordinary text —
 * which is what `truncate` alone does, and why this is a branch of the label
 * rather than the shape of every label.
 */
function BranchLabel({ name }: { name: string }) {
  const { head, tail } = splitBranch(name);
  return (
    <span aria-hidden className="flex min-w-0 font-mono text-[13px] max-sm:flex-wrap max-sm:break-all">
      <span className="truncate">{head}</span>
      {tail && <span className="shrink-0">{tail}</span>}
    </span>
  );
}

export function TupleLinkView({
  link,
  showWhat = false,
  onOpenPlan,
  extraAttr,
}: {
  link: TupleLink;
  /** Whether to print what the link points at beside it. */
  showWhat?: boolean;
  /** Opens an internal plan link as a modal, where the board has the card. */
  onOpenPlan?: (planFile: string) => boolean;
  /**
   * Attributes the CALL SITE stamps, where `valueAttr` cannot answer.
   *
   * A ticket's `data-issue-link` is the case this exists for: `what: 'ticket'`
   * is worn by both an issue and an agent's session id, so the hook cannot be
   * keyed on the link's own fields — only the adapter knows which kind of row
   * it is building. Passed as a pair, one for each answer: the attribute for a
   * link and the attribute for the same name with no address.
   */
  extraAttr?: { link?: Record<string, string>; text?: Record<string, string> };
}) {
  const label = (
    <>
      {showWhat && (
        <span
          aria-hidden
          className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500"
        >
          {link.what}
        </span>
      )}
      {link.what === 'branch' ? <BranchLabel name={link.label} /> : (
        <span className="min-w-0 truncate">{link.label}</span>
      )}
    </>
  );
  // NO ADDRESS, so no anchor. `data-tuple-text` is what a test asserts is not
  // an `<a>` — the assertion that a name without a URL stays a name.
  if (!link.href) {
    return (
      <span
        data-tuple-text={link.what}
        {...valueAttr(link)}
        {...extraAttr?.text}
        // The same reason as on the anchor above: a folded branch name is two
        // `aria-hidden` spans, and this is where the unfolded one rides.
        aria-label={link.what === 'branch' ? link.label : undefined}
        title={`${link.what}: ${link.label}`}
        className="flex min-w-0 items-baseline gap-1 text-slate-600 dark:text-slate-300"
      >
        {label}
      </span>
    );
  }
  // A real anchor either way, so cmd/ctrl/shift/middle-click open natively —
  // the property `PlanLink` established and the reason only a plain primary
  // click is ever intercepted.
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!link.internal || !onOpenPlan) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const file = decodeURIComponent(link.href.replace(/^\/plan\//, ''));
    if (!onOpenPlan(file)) return;
    e.preventDefault();
  };
  return (
    <a
      href={link.href}
      data-tuple-link={link.what}
      // THE WHOLE NAME, where the label is FOLDED. `BranchLabel` renders two
      // `aria-hidden` spans, so without this a branch link has no accessible
      // name at all — which is worse than the defect the hiding prevents.
      //
      // Measured on `BranchName`, the component this replaces: the two halves
      // are flex ITEMS and the accessible-name algorithm joins adjacent boxes
      // with a space, so the row announced `feat ure/reviewed` — a branch name
      // no host would recognise and one no reader could search for. Hiding the
      // halves fixes that and takes the name with it; the label puts it back,
      // whole, on the element that carries the destination.
      aria-label={link.what === 'branch' ? link.label : undefined}
      {...valueAttr(link)}
      {...extraAttr?.link}
      onClick={handle}
      // An EXTERNAL link opens a new tab; an internal one navigates in place,
      // because the board is what serves it and the modal is what usually
      // catches it.
      target={link.internal ? undefined : '_blank'}
      rel="noreferrer"
      title={`${link.what}: ${link.label}`}
      // 24 px TALL, by padding the row absorbs — and this is the one place it
      // now has to be said, which is the accessibility half of the collapse.
      //
      // WCAG 2.2 asks 24 px in both directions for a pointer target. The three
      // deleted components each grew their own anchor to reach it: `PrCell` and
      // `IssueRowView` both carried `-my-1 inline-block py-1`, measured at 35x16
      // on 2026-08-19 and fixed there. Three anchors, three fixes, and the next
      // link added would have needed a fourth.
      //
      // ONE anchor renders every linked name on every kind now, so the target
      // is answered once. `py-1 -my-1` grows the hit box by 8 px while the
      // negative margin gives the space back to the layout — the text does not
      // move and the line box is the height it was, which is what keeps a row
      // at 35-36 px and the marks beside it in line.
      className="-my-1 flex min-w-0 items-baseline gap-1 py-1 text-blue-600 hover:underline dark:text-blue-400"
    >
      {label}
    </a>
  );
}

/**
 * A row, as six slots.
 *
 * The two requirements every variation of this design is tested against, from
 * the plan that shaped it:
 *
 *   1. **The item is recognisable** — slot 1 and slot 2 say what kind of thing
 *      the row is, in a glyph and in a word, with NO hover required. That is
 *      what the four-meanings phase column failed at, and what a tooltip
 *      reading *Branch … on the git host* was doing a label's job for.
 *   2. **The artifact links are associated** — every linked name says what it
 *      points at, so three links on a PR row do not read as three
 *      interchangeable words.
 *
 * ## The props, and why there are so many of them
 *
 * Fifteen is a lot for one component, and the count is the price of ONE
 * component serving three call sites rather than a shared grid with three
 * fillers. They fall into three groups, and every one of them is in the third
 * or the second because it could not be in the first:
 *
 *   1. **The tuple** — `tuple`, and it answers all six slots. This is the whole
 *      of what a row SAYS, and it is data: `tuple-row.ts` carries no React, so
 *      the unit suite tests the slot rules without a browser. That property is
 *      why the collapse was cheap, and it is what the other two groups exist to
 *      protect.
 *   2. **What a kind adds INSIDE a slot** — `marks`, `beside`, `aside`,
 *      `statusExtra`, `statusAttr`, `nameAttr`, `ageTitle`, `menu`, `extra`.
 *      Each names the slot it lands in, and each is a React node or an
 *      attribute rather than a value, which is exactly why it cannot live in
 *      group 1. A wave badge, a `⋯` menu and a stuck row's second line are
 *      renderings; putting them in the projection would put React in the module
 *      that deliberately has none.
 *   3. **Where the row SITS** — `id`, `rowAttr`, `highlighted`, `bordered`. A
 *      scroll anchor, a test hook, an arrival ring and a rule between groups.
 *      All four are the section's business rather than the row's, and the three
 *      call sites disagree about all four — a component that guessed would be
 *      the fourth fill site this wave exists to remove.
 *
 * `marks` and `menu` in particular are passed in rather than built here. The
 * tuple says what a row IS; the menu says what can be DONE to it, and that
 * stays per kind where `the-menu-fits-the-kind` put it — which is also how a
 * RELEASE row offers no release action: it is handed no such item, and this
 * component invents none.
 */
export function TupleRowView({
  tuple,
  onOpenPlan,
  marks = null,
  menu = null,
  extra = null,
  aside = null,
  beside = null,
  ageTitle,
  statusExtra = null,
  statusAttr,
  nameAttr,
  id,
  rowAttr,
  highlighted = false,
  bordered = true,
}: {
  tuple: TupleRowData;
  onOpenPlan?: (planFile: string) => boolean;
  /** The activity marks, in the first track — see `ACTIVITY_MARK_PLACE`. */
  marks?: ReactNode;
  /** The row's `⋯` menu, per kind. Nothing where the kind offers nothing. */
  menu?: ReactNode;
  /** A second line beneath the slots — a stuck status, an evidence line. */
  extra?: ReactNode;
  /**
   * What a kind adds INSIDE slot 4, after its artifact links.
   *
   * A branch row's WAVE badge and its `deferred` badge, both of which qualify
   * the branch name rather than pointing anywhere — a wave is a heading inside
   * a plan file and has no page of its own. They sit in the links slot because
   * that is what they are adjacent to and what they are about, which is the
   * association rule applied to a mark instead of to a link.
   *
   * NOT in the projection, because neither is a link and `tuple-row.ts` renders
   * nothing: it decides what a row SAYS, and a badge is how one call site says
   * it.
   */
  aside?: ReactNode;
  /**
   * What a kind adds INSIDE slot 3, beside the item's own name.
   *
   * A branch row's WAVE badge and its `deferred` badge, and the placement is
   * `a-branch-row-names-its-wave`'s (#275) decision, kept: *a fact about the
   * branch belongs beside the branch.* The wave qualifies THIS BRANCH, and the
   * association is positional and needs no rule — the way `deferred` beside it
   * qualifies the branch's state.
   *
   * NOT slot 4. An earlier draft of the collapse put both there on the reasoning
   * that slot 4 holds *things about the item*; a test measured the cost, and it
   * is one cell of distance between a word and the thing it is about. Slot 4
   * holds LINKS to other objects — a plan, a PR — and a wave is neither: it is
   * a heading inside a plan file with no page of its own.
   */
  beside?: ReactNode;
  /**
   * What slot 6's clock MEANS, in a sentence, where the label is not enough.
   *
   * `waiting` is the label; *"Approved this long ago, and nobody has started
   * it"* is the sentence, and the two are not the same thing. The label marks
   * the exception — this row is not aged from its last change — while the
   * sentence says what happened, which is the only form a reader can act on:
   * `22d` beside `waiting` still leaves *waiting for what?* unanswered.
   *
   * Per call site, because the answer differs: a PLAN's clock is its approval,
   * and a not-started BRANCH inherits that same clock from the plan above it.
   * Defaulted to the label-and-value form where a kind has nothing more to say.
   */
  ageTitle?: string;
  /** What a kind adds beside its status word — a draft badge, a note. */
  statusExtra?: ReactNode;
  /** Attributes for slot 3's name — see `TupleLinkView.extraAttr`. */
  nameAttr?: { link?: Record<string, string>; text?: Record<string, string> };
  /**
   * The attribute the status WORD carries — `data-pr-state="conflicts"`.
   *
   * The word itself comes from the tuple; this says which vocabulary it was
   * drawn from, and it exists because a test asserting `conflicts` against a
   * row with three other words on it needs to name the one it means. Absent on
   * kinds whose status is not a PR's.
   */
  statusAttr?: Record<string, string>;
  /**
   * The element id a scroll target aims at — `agent-row-<branch>`, which is
   * what `App` calls `getElementById` with when the agent panel reveals a
   * branch. Absent on kinds nothing scrolls to.
   */
  id?: string;
  /**
   * The row-identity attribute this call site stamps — `data-agent-row`,
   * `data-plan-row="<plan>"`, `data-issue-row="<n>"`.
   *
   * IDENTITY, NOT LAYOUT, and the distinction is what survived the collapse.
   * `ROW_TRACKS` was a layout fact and it is gone; these are how a test finds
   * *the row for this branch* among a hundred, and 12 test files ask that
   * question. Passed as an object rather than derived from `tuple.kind`,
   * because a plan row's attribute carries the plan's NAME and a ticket's the
   * issue NUMBER — values the tuple deliberately holds as a link label and not
   * as a key.
   */
  rowAttr?: Record<string, string>;
  /** This row is the one just revealed from an agent panel — wear the ring. */
  highlighted?: boolean;
  /**
   * Whether this row draws its own rule.
   *
   * FALSE INSIDE A PLAN GROUP, where the rule belongs to the group: a plan and
   * its branches are one block, and a row drawing its own would put a line
   * between a plan and its first branch. The property `Row` carried as
   * `inPlanGroup`, kept because the defect it prevents is still reachable.
   */
  bordered?: boolean;
}) {
  return (
    <li
      role="row"
      id={id}
      data-tuple-kind={tuple.kind}
      data-highlighted={highlighted ? 'true' : undefined}
      {...rowAttr}
      // The ring is `-inset` so it hugs the row without a track of its own, and
      // it is the same blue the board's highlighted card wears — one arrival
      // colour across both tabs.
      className={`relative flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm sm:grid ${TUPLE_TRACKS} sm:items-baseline sm:gap-x-3 ${
        bordered ? 'border-t border-slate-100 dark:border-slate-800' : ''
      } ${highlighted ? 'rounded-sm ring-2 ring-inset ring-blue-500' : ''}`}
    >
      {/* SLOT 1 — the icon, in the marks track it shares with the activity
          marks. One track for *what is happening to this row* and *what kind of
          row it is*: both are the row's identity rather than its content, and a
          seventh fixed track costs its own width AND a gap. */}
      <span role="gridcell" className={MARKS_CELL}>
        {/* THE ICON IS THE ROW'S LEAST URGENT MARK. It says what KIND of row
            this is — which slot 2 also says, in a word a reader can see —
            while the marks beside it say what is happening to the row RIGHT
            NOW. So where the two compete for this track, the icon gives way:
            it leaves the flow and the marks keep the alignment. */}
        <span
          aria-hidden
          data-tuple-icon={tuple.kind}
          // ON THE FIRST LINE, and OUT OF THE STACK — `absolute` within this
          // cell rather than a flex item in it. Both facts are measured.
          //
          // In the flow, the icon and the marks share one vertical stack, so
          // the icon's 12px box shifted every mark beside it: a row's activity
          // mark came out 6px off the branch name it marks, against a 4px
          // tolerance the suite has held since `agent-rows-line-up`. The marks
          // are what must line up — they are read across rows, down a column —
          // and the icon is constant, so the icon is what gives way.
          //
          // `top-2` matches the row's own `py-2`, which puts the icon on the
          // FIRST LINE rather than at the row's centre. On a two-line row (one
          // carrying a stuck status) the centre is the gap between the lines —
          // the same defect `ActivityMark` records fixing for itself, and the
          // icon would have re-introduced it one element over.
          className="absolute left-0 top-2 text-xs leading-none"
        >
          {tuple.icon}
        </span>
        {marks}
      </span>
      {/* SLOT 2 — THE KIND, as a word, VISIBLE. Not a tooltip and not a badge to
          decode: the defect this replaces was a kind stated only on hover, and
          before that a column whose word meant four different things depending
          on the plan's wave count. `data-tuple-kind-label` is what a test reads
          to assert the kind is present without hovering.

          `data-kind` IS THE SAME CLAIM, and it is here because the fleet's
          suites were already asserting it — sixteen times, reading the WORD as
          this element's text. It was `Row`'s hook and `IssueRowView`'s, and the
          collapse had to decide whether it named the deleted components or the
          slot. The slot: `[data-kind]` means *where a row says what it is*, and
          that is exactly what slot 2 is, so the assertions keep an owner rather
          than being rewritten onto a synonym.

          The `sr-only` prefix survives BELOW `sm` and only there, exactly as it
          did before: a card has no columns for the header to name, so `Branch`
          would arrive with nothing saying what it is. Above `sm` the
          `columnheader` says `Kind` once for the whole grid.

          IT SITS OUTSIDE `[data-tuple-kind-label]`, and that is not tidiness.
          The hook's whole claim is *this is the kind, and a reader can SEE it*,
          which the suite asserts with `innerText` — a layout-computed reading
          that returns "" for a hidden box, so a kind moved into a tooltip
          fails. A screen-reader prefix inside the hook would be read by that
          same assertion, and it would pass or fail depending on whether a
          stylesheet had loaded rather than on whether the kind was visible.
          The two are different statements to two different readers; only one
          of them is what the hook names. */}
      <span
        role="gridcell"
        className="min-w-0 shrink-0 truncate text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        <span className="sr-only sm:hidden">Kind: </span>
        <span data-tuple-kind-label={tuple.kind} data-kind={tuple.kind}>
          {tuple.kindLabel}
        </span>
      </span>
      {/* SLOT 3 — THE ITEM'S OWN NAME: what the reader is deciding about. A PR
          leads with the PR, a branch with the branch, a ticket with its title.
          `showWhat` is off here — the kind slot immediately left has already
          said what this is, and repeating it would be the same word twice. */}
      <span role="gridcell" className="flex min-w-0 items-baseline gap-2 font-medium">
        <TupleLinkView link={tuple.name} onOpenPlan={onOpenPlan} extraAttr={nameAttr} />
        {beside}
      </span>
      {/* SLOT 4 — THE ARTIFACT LINKS, zero or more. Each says what it points at,
          which is what keeps a PR row's two from reading as interchangeable
          words. NOTHING where there are none: a branch row renders no empty
          artifact control, by the rule this board already applies to a PR cell
          with no PR. */}
      <span
        role="gridcell"
        className="flex w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-xs sm:w-auto"
      >
        {tuple.links.map((link) => (
          <TupleLinkView
            key={`${link.what}:${link.label}`}
            link={link}
            showWhat
            onOpenPlan={onOpenPlan}
          />
        ))}
        {aside}
      </span>
      {/* SLOT 5 — WHERE THIS STANDS. One slot whatever the kind: `conflicts`,
          `draft`, `thinking`, `no-checks` are all the same question. The prose
          notes that varied per kind become one value in one place.

          `statusExtra` is what a kind adds BESIDE the word, never instead of it
          — the draft badge a PR carries, the sentence a branch's note holds
          that no status word can say (*uncommitted work*, *blocked by an
          earlier wave*). It sits here rather than in the projection because a
          badge is a rendering and `tuple-row.ts` carries no React: that
          separation is what lets the unit suite test the slot rules as data. */}
      <span
        role="gridcell"
        data-tuple-status
        className="flex min-w-0 items-baseline gap-2 truncate text-xs text-slate-500 dark:text-slate-400"
      >
        {tuple.status && (
          <span {...statusAttr} className="min-w-0 truncate">{tuple.status}</span>
        )}
        {statusExtra}
      </span>
      {/* SLOT 6 — THE AGE, from the row's LAST CHANGE. Unlabelled, because that
          is the rule; the label appears exactly where the rule does not apply —
          a not-started row's approval clock, and an agent's session and idle —
          which is the inverse of the four-meanings column, unlabelled *because*
          its meaning varied. */}
      <span
        role="gridcell"
        data-tuple-age
        data-tuple-age-label={tuple.age.label || undefined}
        title={ageTitle ?? (tuple.age.label ? `${tuple.age.label}: ${tuple.age.text}` : undefined)}
        className="shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400"
      >
        {tuple.age.label && (
          <span className="mr-1 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {tuple.age.label}
          </span>
        )}
        {tuple.age.text}
      </span>
      {/* THE MENU — per kind, and passed in. The tuple says what a row IS; the
          menu says what can be DONE to it, and a kind with nothing to offer is
          handed nothing rather than a `⋯` that opens an empty list.

          THE CELL IS UNCONDITIONAL AND THE MENU INSIDE IT IS NOT — the same
          split the marks track makes, and for the same reason. A row whose kind
          offers nothing must still occupy the track, or every row that does
          offer something lands its six preceding cells one column adrift of it.
          That alignment is what the grid is for.
          
          So the three menu components — `RowActions`, `PlanActions`,
          `IssueRowActions` — render their button and their popup and NOT a cell
          of their own: this is the cell, and a nested one is something the grid
          role does not admit. Each keeps its own `relative` box, which is what
          floats the popup out over the rows below. */}
      <span role="gridcell" className="relative flex w-5 shrink-0 items-center justify-end">
        {menu}
      </span>
      {extra}
    </li>
  );
}
