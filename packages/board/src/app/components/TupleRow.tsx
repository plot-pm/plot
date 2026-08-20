// ONE ROW COMPONENT FOR ALL SEVEN KINDS.
//
// The board reached seven kinds of row through three components and two
// competing grid definitions, and the third component — a TICKET — was already
// rendering through the tracks of a BRANCH: no wave, no worker, no branch, but
// wearing the columns of something it is not, because there was no third grid
// to give it. Three fill sites is how the two grids drifted apart, and a shared
// grid with three fillers keeps that possibility while adding a contract.
//
// This renders a {@link TupleRow} — six slots, projected from whatever the kind
// is by `src/app/lib/tuple-row.ts`. It DELETES NOTHING: `Row`, `PlanRow` and
// `IssueRowView` keep working, and the wave that replaces them with this one
// goes last on purpose, because `AgentList.tsx` took eleven commits on
// 2026-08-20 alone and conflicted on nearly every merge that day. Landing the
// shape first means that wave moves rendering only.
import type { MouseEvent, ReactNode } from 'react';
import type { TupleLink, TupleRow as TupleRowData } from '../lib/tuple-row.js';

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
 * The fixed tracks total 496 px and the six gaps and padding add 84 px, so the
 * grid needs 580 px before the links track gets a pixel — under the 640 px
 * `sm` breakpoint the rest of the board turns into cards at, with room to
 * spare. That arithmetic is the constraint `ROW_TRACKS` records having crossed
 * by 8 px once; this stays 60 px clear of it, and any widening of a fixed track
 * has to be checked against it again.
 *
 * The MARKS track is 1.5rem and comes first, matching the existing rows, so the
 * activity marks of a tuple row and of a `Row` beside it stay in one vertical
 * line — the property `agent-rows-line-up` paid to establish.
 */
export const TUPLE_TRACKS =
  'grid-cols-[1.5rem_4.5rem_12rem_1fr_8rem_4.5rem_1.25rem]';

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
 */
export function TupleLinkView({
  link,
  showWhat = false,
  onOpenPlan,
}: {
  link: TupleLink;
  /** Whether to print what the link points at beside it. */
  showWhat?: boolean;
  /** Opens an internal plan link as a modal, where the board has the card. */
  onOpenPlan?: (planFile: string) => boolean;
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
      <span className="min-w-0 truncate">{link.label}</span>
    </>
  );
  // NO ADDRESS, so no anchor. `data-tuple-text` is what a test asserts is not
  // an `<a>` — the assertion that a name without a URL stays a name.
  if (!link.href) {
    return (
      <span
        data-tuple-text={link.what}
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
      onClick={handle}
      // An EXTERNAL link opens a new tab; an internal one navigates in place,
      // because the board is what serves it and the modal is what usually
      // catches it.
      target={link.internal ? undefined : '_blank'}
      rel="noreferrer"
      title={`${link.what}: ${link.label}`}
      className="flex min-w-0 items-baseline gap-1 text-blue-600 hover:underline dark:text-blue-400"
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
 * `marks` and `menu` are passed in rather than built here. The tuple says what
 * a row IS; the menu says what can be DONE to it, and that stays per kind where
 * `the-menu-fits-the-kind` put it — which is also how a RELEASE row offers no
 * release action: it is handed no such item, and this component invents none.
 */
export function TupleRowView({
  tuple,
  onOpenPlan,
  marks = null,
  menu = null,
  extra = null,
}: {
  tuple: TupleRowData;
  onOpenPlan?: (planFile: string) => boolean;
  /** The activity marks, in the first track — see `ACTIVITY_MARK_PLACE`. */
  marks?: ReactNode;
  /** The row's `⋯` menu, per kind. Nothing where the kind offers nothing. */
  menu?: ReactNode;
  /** A second line beneath the slots — a stuck status, an evidence line. */
  extra?: ReactNode;
}) {
  return (
    <li
      role="row"
      data-tuple-kind={tuple.kind}
      className={`relative flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-slate-100 px-3 py-2 text-sm dark:border-slate-800 sm:grid ${TUPLE_TRACKS} sm:items-baseline sm:gap-x-3`}
    >
      {/* SLOT 1 — the icon, in the marks track it shares with the activity
          marks. One track for *what is happening to this row* and *what kind of
          row it is*: both are the row's identity rather than its content, and a
          seventh fixed track costs its own width AND a gap. */}
      <span role="gridcell" className="flex w-full shrink-0 items-center justify-center gap-1 self-stretch">
        <span aria-hidden data-tuple-icon={tuple.kind} className="text-xs leading-none">
          {tuple.icon}
        </span>
        {marks}
      </span>
      {/* SLOT 2 — THE KIND, as a word, VISIBLE. Not a tooltip and not a badge to
          decode: the defect this replaces was a kind stated only on hover, and
          before that a column whose word meant four different things depending
          on the plan's wave count. `data-tuple-kind-label` is what a test reads
          to assert the kind is present without hovering. */}
      <span
        role="gridcell"
        data-tuple-kind-label={tuple.kind}
        className="min-w-0 shrink-0 truncate text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        {tuple.kindLabel}
      </span>
      {/* SLOT 3 — THE ITEM'S OWN NAME: what the reader is deciding about. A PR
          leads with the PR, a branch with the branch, a ticket with its title.
          `showWhat` is off here — the kind slot immediately left has already
          said what this is, and repeating it would be the same word twice. */}
      <span role="gridcell" className="flex min-w-0 items-baseline font-medium">
        <TupleLinkView link={tuple.name} onOpenPlan={onOpenPlan} />
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
      </span>
      {/* SLOT 5 — WHERE THIS STANDS. One slot whatever the kind: `conflicts`,
          `draft`, `thinking`, `no-checks` are all the same question. The prose
          notes that varied per kind become one value in one place. */}
      <span
        role="gridcell"
        data-tuple-status
        className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400"
      >
        {tuple.status}
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
        title={tuple.age.label ? `${tuple.age.label}: ${tuple.age.text}` : undefined}
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
          handed nothing rather than a `⋯` that opens an empty list. */}
      <span role="gridcell" className="flex shrink-0 items-center justify-end">
        {menu}
      </span>
      {extra}
    </li>
  );
}
