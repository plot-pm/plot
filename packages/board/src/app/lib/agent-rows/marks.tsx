import { useContext, useEffect, useRef, useState } from 'react';
import { WorkGridContext } from '../../components/TupleRow.js';
import { type AgentRow } from '../../../contract/schema.js';
import { sliceItemId } from './delivery-readings.js';
import { itemAnchor, type Jump } from './delivery-view.js';
import { ACTIVITY_MARK_PLACE, CHANGE_FADE, type ActivityPace } from './activity.js';
import { stuckEvidence, stuckWord } from './stuck.js';

/**
 * The activity spinner: one braille glyph that cycles while a process runs on
 * the row, placed in the Status cell before the status word.
 *
 * The frames come from the `activity-spinner` keyframes in `index.css`, so the
 * page runs no timer. `pace` selects the frame rate: `fast` (80 ms per frame)
 * where an agent writes in this checkout, `slow` (220 ms per frame) where the
 * row is claimed and no write is observed. Under `prefers-reduced-motion:
 * reduce` the glyph stops on the static frame `⠿` and stays visible.
 *
 * The glyph is `aria-hidden`: the status word carries the fact in words. The
 * `title` names the local-only limit of each pace.
 *
 * @param pace - the row's or heading's pace, from `activityPace` or `groupPace`.
 */
export const ActivitySpinner = ({ pace }: { pace: ActivityPace }) => (
  <span
    aria-hidden
    data-activity-spinner
    data-activity-pace={pace}
    title={pace === 'fast'
      ? 'A write is in progress in this checkout'
      : 'Claimed, and no write observed in this checkout'}
    className={`activity-spinner activity-spinner-${pace} inline-block w-[1ch] shrink-0 font-mono text-emerald-600 dark:text-emerald-400`}
  />
);

/**
 * The reserved slot before a row's status: one character wide whether or not
 * the row runs, so the status text keeps its place when the spinner appears or
 * goes.
 *
 * @param pace - the spinner's pace, from `activitySignal`; `null` leaves the slot empty.
 */
export const ActivitySlot = ({ pace }: { pace: ActivityPace | null }) => (
  <span data-activity-slot className="inline-block w-[1ch] shrink-0">
    {pace !== null && <ActivitySpinner pace={pace} />}
  </span>
);

/**
 * Whether the reader asked for reduced motion, kept current while the page is open.
 *
 * @returns `true` while `prefers-reduced-motion: reduce` matches.
 */
export const useReducedMotion = (): boolean => {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (list === undefined) return;
    const onChange = () => setReduced(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return reduced;
};

/**
 * The mark a row wears while it holds commits nobody else can see.
 *
 * The mark is a flat emerald rule in the row's marks track and does not move:
 * it reports work that stopped and never left the machine. The activity
 * spinner in the Status cell reports work in progress; a row can carry both.
 *
 * It is not `[data-change-mark]`, `[data-activity-spinner]` or
 * `[data-stuck-cue]`: each mark is its own element with its own meaning.
 *
 * The title carries the same local-only limit its field does: this is what THIS
 * checkout can see, and a branch worked on elsewhere reports nothing here.
 */
export function UnpushedMark({ ahead, inTrack = false }: { ahead: number; inTrack?: boolean }) {
  return (
    <span
      aria-hidden
      data-unpushed-mark
      // The COUNT is in the title rather than on screen. `2 ahead` and `40
      // ahead` are different situations and the number is free, but printing it
      // in the left padding would put a second figure beside a row that already
      // carries phase, plan, branch, note, PR and age — and the mark's job is
      // to say *there is something here*, which the reader then opens.
      title={`${ahead} commit${ahead === 1 ? '' : 's'} in this checkout that the remote has not seen`}
      // Outside a marks track the mark takes the row's marks-cell placement.
      className={inTrack ? 'relative flex h-1 w-3 shrink-0 items-center' : ACTIVITY_MARK_PLACE.row}
    >
      <span className="h-0.5 w-full rounded-full bg-emerald-600/70 dark:bg-emerald-400/60" />
    </span>
  );
}

/**
 * The mark a row wears for `CHANGE_MARK_MS` after its watched state changed.
 *
 * **Deliberately NOT `LiveDot`, and the distinction is a requirement.** That dot
 * means *something is alive here, end unknown* and lives for hours; this means
 * *this just changed* and lives for seconds. One vocabulary carrying both would
 * make the reader ask which of two questions a mark is answering.
 *
 * A tint across the row rather than a badge in a cell: the change is a fact
 * about the ROW — and frequently about the row having just ARRIVED in this
 * section, since `pr.state` helps decide the group — so marking the whole line
 * is what makes the arrival legible at its new location.
 *
 * **`aria-hidden`, with no live region.** The cell's own text already changed,
 * and a screen reader reaches the new value by reading the row. An `aria-live`
 * announcement on every CI transition across every row would be an interruption
 * rather than an aid.
 *
 * The tint is the accent background, and it fades to transparent once over
 * `CHANGE_MARK_MS` (`CHANGE_FADE`); the element unmounts as the fade ends, so a
 * later pulse with no change lights nothing.
 *
 * **Under `motion-reduce` the mark STAYS and only the animation stops** — a
 * static tint for the same time, while the row's age cell reads `just now`
 * (`activitySignal`). Hiding the element under reduced motion would pass a
 * motion-only assertion and lose the information along with the movement.
 */
export function ChangeMark() {
  return (
    <span
      aria-hidden
      data-change-mark
      style={CHANGE_FADE}
      className="change-mark pointer-events-none absolute inset-0"
    />
  );
}

/**
 * `LiveDot` stood here until 2026-08-22 — a static green dot at `left-1`,
 * rendered on every row whose group was `working`.
 *
 * It went for two reasons, and the screenshot that reported it shows both. It
 * sat one pixel from the activity mark's dot, so a WORKING row drew TWO
 * dots side by side and the eye read one smudge rather than two marks. And what
 * it said — *this row is in WORKING* — is what the section heading above it
 * already says, once, instead of once per row.
 *
 * What it was FOR survives in the mark that replaced it: `ActivitySpinner` is
 * drawn when `isActive` finds a process, which is the question a reader
 * scanning WORKING actually has. `isLive` remains, and still answers *which
 * section is this row in* for `groupPace`; it no longer licenses a mark.
 */


/**
 * `StuckCue` stood here until 2026-08-22 — a pinging amber dot trailing the
 * stuck evidence, saying *there is an action here and you have not taken it*.
 *
 * Removed on the operator's call. The row already says what is wrong in words
 * (`CI failed`, `conflict`, the run history beside it) and offers the action in
 * its own menu; the dot pointed at a control it did not contain, and it pinged
 * on every row that had one. The board's other marks each report a FACT — a
 * process running, files changed, work unpushed — and this one reported an
 * absence of a click.
 *
 * `showsCue` and `actionReachable` went with it: both existed to decide when
 * this dot appeared and answered no other question.
 */


/**
 * Why this row offers no action — in the row's own words.
 *
 * A disabled control without a reason is the kind that makes people guess, and
 * this row already knows: the note beside it says *blocked by an earlier slice*
 * or *no commit for 22 days*. So the `title` says that, turning a dead
 * affordance into an explanation rather than a generic "no actions".
 *
 * The note is preferred wherever there is one; the fallback covers the rows that
 * carry none (a group whose classifier left the note empty), where naming the
 * group is still more than nothing.
 *
 * Exported for test — a generic string passes any assertion that only checks a
 * title exists.
 */

/**
 * What a stuck branch says in its row: which of the four, the evidence, and —
 * for the two the pulse cannot fix — the action, ON THE ROW.
 *
 * **On the row, not in the three-dot menu, and that is measured rather than
 * preferred.** `RowActions` hides its action behind the menu, and the menu opens
 * only if something inside could act — so a row with a waiting action looks
 * identical to a row with none until you click it. A cue nobody finds is not a
 * cue, and this is the whole reason the rule exists.
 *
 * **A stuck branch keeps its group.** The contract says so: *a stuck branch
 * keeps the group it belongs to and gains this beside it*. Nothing here moves a
 * row or adds a section — whether a branch is stuck and where it is waiting are
 * independent questions, and folding one into the other would put a conflicting
 * PR and an unpushed rebase in the same place while separating two conflicts.
 *
 * **`null` is the common case and costs nothing.** Most rows are not stuck, and
 * this renders exactly nothing for them — the caller does not even mount it. A
 * healthy row is byte-for-byte the row it was before this slice.
 */
export function StuckCell({
  row,
}: {
  row: AgentRow;
}) {
  const stuck = row.stuck;
  if (!stuck) return null;

  const word = stuckWord(stuck.state);
  const evidence = stuckEvidence(stuck);
  // The Work items grid has no kind track, so the row's content starts at track 2 there.
  const start = useContext(WorkGridContext) ? 'sm:col-start-2' : 'sm:col-start-3';

  return (
    <span
      role="gridcell"
      data-stuck={stuck?.state ?? ''}
      // ITS OWN LINE beneath the row's six columns rather than a seventh track:
      // the evidence is three lines wide on a `ci-failing` row and most rows
      // carry none at all, so a track sized for it would push every real column
      // in from the edge across the whole fleet to reserve room for something
      // rare and tall.
      //
      // **From column 2, not column 1**, and a screenshot settled the
      // difference. `col-span-full` starts at track 2, which is `5rem` wide and
      // was frequently EMPTY when it held a phase — so on a row with no phase
      // the evidence hung flush left under nothing while the branch it describes
      // started `5rem` in, reading as a foreign element rather than as a
      // continuation of the row. `2 / -1` starts it where the row's own content
      // starts, and because that track is FIXED it lands identically whichever
      // row it is on — the property the fixed tracks exist for.
      // COLUMN 3, not 2: the marks earned a track at the front, so the cell
      // that used to begin past track 2 now begins past the MARKS and runs
      // under it — the exact defect this span was written to fix, reintroduced
      // by a column inserted before it. Measured: the evidence line started at
      // x=57 where that cell ends at 130.
      //
      // Track 2 now holds the KIND and is never empty, which removes the
      // *frequently empty* half of the original argument. The geometry does not
      // change with it: the span still starts past the marks, because it is the
      // row's own content it must line up with, and a full cell above an
      // indented line is exactly as misaligned as an empty one.
      className={`flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs ${start} sm:col-end-[-1]`}
    >
      {/* The state as a WORD, in amber, and the word is the carrier — the
          colour only reinforces it. `title` names the state's own terms so a
          pointer gets the one sentence that explains the errand. */}
      {word && (
        <span className="shrink-0 font-medium text-amber-700 dark:text-amber-500">
          {word}
        </span>
      )}
      {/* EVIDENCE TRAVELS WITH THE STATE. Each line is its own element rather
          than one joined sentence, so a reader (and a test) can find the
          `ci-failing` row's three lines separately — they are three different
          facts and only the reader combines them. */}
      {evidence.map((line) => (
        <span
          key={line}
          data-stuck-evidence
          className="min-w-0 text-slate-500 max-sm:whitespace-normal dark:text-slate-400"
        >
          {line}
        </span>
      ))}
      {/* THE CUE STAYS IN THE ROW while the action it used to sit beside now
          lives in the three-dot menu. It is state, not an action — it says
          *this one is waiting on you*, and a signal reachable only by opening a
          menu is not a signal. `one-place-for-what-a-row-can-do` moved the
          actions and was explicit that this must not follow them.

          It points at the WORD and the evidence to its left rather than at a
          control to its right, which is what it always described: the row's own
          statement of what is wrong. The action is one `⋯` away, and the menu's
          accessible name carries the branch.

          Rendered LAST so it trails the evidence — the mark that says *unanswered*
          reads as a qualifier on the whole statement rather than as a bullet in
          front of it. */}
    </span>
  );
}

/**
 * The info mark on a blocked slice, and the overlay that names what blocks it.
 *
 * ## Why an overlay rather than a `title`
 *
 * This was a native `title` for one commit, and it could not do the job asked
 * of it: *show the LINK on hover*. A `title` renders plain text, waits about a
 * second before appearing, cannot be styled, and — the part that decides it —
 * **cannot hold a control**. The blocking slice is a row on screen; a reference
 * to it should be able to take the reader there.
 *
 * ## Why the target is always reachable
 *
 * The blocking slice is a SIBLING in the same list — a plan's slices all render
 * together, so `Shaped` is one or two rows above `Moved` whenever `Moved` says
 * it is blocked. That is why this needs none of App's reveal machinery
 * (`revealBranch`, `highlightBranch`, the nonce): those exist to cross tabs and
 * sections to find a row that may not be rendered. Here the row is a query away.
 *
 * Scoped by PLAN as well as by slice name, because slice names repeat across
 * plans — `Shaped` appears in several of this estate's plans, `Says` in three.
 * The same reason `openSlices` keys on `plan\0wave`.
 *
 * ## Hover AND focus
 *
 * A hover-only disclosure is unreachable by keyboard, and this one holds a
 * control, so it would be a control nobody could tab to. It opens on
 * `mouseenter` and on `focus` within, and closes on `mouseleave`, on blur out,
 * and on Escape.
 */
export function BlockedByMark({
  plan,
  wave,
  onJump,
}: {
  plan: string;
  wave: string;
  /**
   * The Delivery tab's one jump: it opens the section, group and plan row that hold the slice's item, then
   * finds the row. Absent outside the Delivery tab, where the mark finds the row in what is mounted.
   */
  onJump?: Jump;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // The sibling row, found by the two attributes that identify it. `scrollIntoView`
  // with a flash rather than a persistent highlight: the reader asked *which
  // slice*, and the answer is a glance, not a new state to dismiss.
  //
  // The selector searches the whole document with both attributes in one query,
  // so it crosses sections. A FOLDED section removes its rows from the tree, so
  // the jump opens the folds that hold the slice's item before it looks.
  const scrollToTarget = (target: HTMLElement) => {
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    // A brief ring, removed on its own. Not a class toggle held in state: the
    // flash belongs to the TARGET row, which this component does not own.
    target.classList.add('ring-2', 'ring-amber-400');
    window.setTimeout(() => target.classList.remove('ring-2', 'ring-amber-400'), 1200);
  };

  // Two shapes: a slice row under its plan's list, and a WORKING agent row,
  // which names its plan on itself because its grid holds every plan.
  const findSlice = () => {
    const p = CSS.escape(plan);
    const w = CSS.escape(wave);
    return document.querySelector<HTMLElement>(
      `[data-slice-list="${p}"] [data-slice-row="${w}"], [data-slice-row="${w}"][data-slice-plan="${p}"]`,
    );
  };

  const goToSlice = () => {
    setOpen(false);
    // The jump opens the folds that hold the slice's item and retries until the row mounts. An unreached row
    // is never silent: the mark already names the slice in its label and panel.
    if (onJump !== undefined) {
      onJump(itemAnchor(sliceItemId(plan, wave)), { find: findSlice, show: scrollToTarget });
      return;
    }
    const target = findSlice();
    if (target) scrollToTarget(target);
  };

  return (
    <span
      ref={box}
      className="relative ml-1 inline-flex shrink-0 items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        data-slice-blocked-by={wave}
        aria-haspopup="dialog"
        aria-expanded={open}
        // THE NAME IS IN THE LABEL, not only in the overlay. A reader on a
        // screen reader gets the answer without opening anything, which is the
        // same rule slot 2 follows: recognition must not depend on a disclosure.
        aria-label={`Blocked by slice ${wave} — show it`}
        onClick={goToSlice}
        className="inline-flex items-center text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="currentColor"
          className="inline-block align-text-bottom"
        >
          {/* Octicons `info` — the same vocabulary the kind glyphs use. */}
          <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
      </button>
      {open && (
        // RIGHT-ANCHORED and above the row, because slot 5 sits near the right
        // edge and a left-anchored panel would leave the viewport. `z-20` clears
        // the row menus' `z-10`.
        <span
          role="dialog"
          data-slice-blocked-panel={wave}
          className="absolute bottom-full right-0 z-20 mb-1 w-max whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <span className="text-slate-500 dark:text-slate-400">blocked by </span>
          <button
            type="button"
            data-slice-goto={wave}
            onClick={goToSlice}
            className="font-medium text-sky-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-sky-300"
          >
            {wave}
          </button>
        </span>
      )}
    </span>
  );
}
