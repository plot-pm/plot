/**
 * Visual marks that indicate row state — activity, unpushed work, changes,
 * stuck conditions, and blocked-by references.
 *
 * Extracted from `AgentList.tsx` as wave 2 of
 * `the-derivations-leave-the-component`. The derivations (host notes, activity,
 * waves, sections, etc.) left in wave 1; the RENDERED components — these marks,
 * the row adapters, and the menus — leave here.
 *
 * Each mark communicates a distinct state:
 * - `ActivityMark`: something is being written to this branch
 * - `UnpushedMark`: commits exist locally that the remote has not seen
 * - `ChangeMark`: the row's PR status changed in the last few seconds
 * - `StuckCell`: why this branch cannot move forward
 * - `BlockedByMark`: which earlier wave blocks this one
 */
import { useState, useRef, useEffect, type CSSProperties } from 'react';
import type { AgentRow } from '../../../contract/schema.js';
import { ACTIVITY_MARK_PLACE, type ActivityPace } from './activity.js';
import { stuckEvidence, stuckWord } from './stuck.js';
import { repairWord } from './actions.js';

/**
 * A pulsing dot-on-track that says something is being written to this branch.
 *
 * Two paces:
 * - `fast`: a write is in progress in this checkout
 * - `slow`: claimed, and no write observed in this checkout
 *
 * The glow is explicit — a bright emerald halo — and is what "someone is here"
 * means. Compare to `UnpushedMark`, which has NO glow and is what "stopped" means.
 */
export function ActivityMark({ pace, place = 'row', inTrack = false }: { pace: ActivityPace; place?: 'row' | 'heading'; inTrack?: boolean }) {
  const fast = pace === 'fast';
  return (
    <span
      aria-hidden
      data-activity-mark
      data-activity-pace={pace}
      // Each pace says what it actually knows. The fast one names its local-only
      // limit; the slow one names the gap it is reporting — *claimed, and nobody
      // observed* is a different statement from *someone is writing*, and a
      // single shared title would flatten the two speeds back into one fact.
      title={fast
        ? 'A write is in progress in this checkout'
        : 'Claimed, and no write observed in this checkout'}
      // Beside the live dot in the row's left padding rather than in a track of
      // its own — the same reasoning `LiveDot` documents, and the reason the
      // six columns do not move to make room for a mark most rows never carry.
      //
      // At the row's very edge (`left-0`), where `LiveDot` sits at `left-1`
      // with a 6px dot. The track is 12px wide and 2px tall, so it passes UNDER
      // the dot rather than colliding with it: two marks, two meanings, and a
      // row carrying both still shows both.
      //
      // ALIGNED TO THE ROW'S FIRST LINE, not to the row's centre — and the
      // mechanism is chosen so that no pixel has to be guessed. The mark used to
      // carry `sm:top-1/2 sm:-translate-y-1/2`, which centres it on the whole
      // ROW. That rested on an assumption which has since broken: *the row is
      // `py-2` around ONE line of `text-sm`*, so centring on the row and
      // centring on the line were the same pixel. The stuck cell then landed as
      // its own line beneath the columns (`sm:col-start-3 sm:col-end-[-1]`),
      // and a row carrying a status line is roughly twice as tall — so `top-1/2`
      // put the mark BETWEEN the two lines instead of beside the branch name.
      //
      // The mark belongs to the BRANCH, and the branch is on line one whatever
      // else the row grows beneath it. So the mark is given the FIRST LINE'S
      // OWN BOX to sit in: `sm:top-2` is the row's `py-2` padding — where the
      // first line begins — and `sm:h-5` is one line box of `text-sm`. The track
      // then centres itself inside that box with `items-center`, which is what
      // keeps this honest: the line's height is stated once, and nothing
      // downstream has to know a magic offset.
      //
      // Measured rather than assumed: the row's first line box runs 18.6px from
      // the row's own top edge on a real page, so a hand-computed `top-4.5`
      // would be right today and wrong the moment the type scale moves. A box
      // that IS the line does not have that failure mode.
      //
      // The pairing that matters: `top-1/2` looks correct on every single-line
      // row and is wrong on exactly the rows carrying the most information.
      // Anything measuring itself against the ROW's height is suspect; this
      // measured itself against the row and meant the line.
      // In the marks TRACK the parent cell already positions and sizes; the
      // mark is then just a 12px box in the flow. Outside it (the heading) the
      // placement map still applies.
      className={inTrack ? 'relative flex h-2 w-3 shrink-0 items-center' : ACTIVITY_MARK_PLACE[place]}
    >
      {/* The TRACK the dot rides: a faint 2px rule, centred on the line box by
          the flex above. Dim on purpose — what reads from a distance is a
          bright point moving against a dim line, so the track marks the extent
          of the travel without competing with the thing that travels.

          It is `relative` because the dot is positioned against IT rather than
          against the line box: the dot's reach is a fraction of the track, and
          measuring it against anything else would decouple the two. */}
      <span
        data-activity-track
        className="relative h-0.5 w-full rounded-full bg-emerald-500/25 dark:bg-emerald-400/25"
      >
        <span
          data-activity-dot
          // `--tw-travel` is the reach, read by the shared `travel` keyframes:
          // the track is 12px and the dot is 6px, so 6px of travel takes the dot
          // from flush-left to flush-right and back without ever leaving the
          // track. Set here rather than baked into the keyframes so the two stay
          // tied to each other — a wider track changes one number, not two.
          style={{ '--tw-travel': '0.375rem' } as CSSProperties}
          // The glow is an explicit `shadow-[...]` in the mark's own emerald
          // rather than a `shadow-*` scale step, because the scale's shadows are
          // neutral greys for lifting a surface off the page — a drop shadow,
          // not a light. Two rings: a tight one that thickens the dot's edge and
          // a wide, faint one that spreads. It is what carries the mark across a
          // room, and it does NOT depend on the travel — see `motion-reduce`
          // below, which stops the movement and leaves everything else standing.
          //
          // `-top-0.5` centres the 6px dot on the 2px track it rides.
          className={`absolute -top-0.5 left-0 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_1px_rgba(16,185,129,0.9),0_0_10px_3px_rgba(16,185,129,0.5)] motion-reduce:animate-none dark:bg-emerald-400 dark:shadow-[0_0_4px_1px_rgba(52,211,153,0.9),0_0_12px_4px_rgba(52,211,153,0.55)] ${
            fast ? 'animate-travel-fast' : 'animate-travel-slow'
          }`}
        />
      </span>
    </span>
  );
}

/**
 * The mark a row wears while it holds commits nobody else can see.
 *
 * **STILLNESS IS THE MESSAGE.** The activity mark says *someone is writing
 * here* and carries a travelling dot and a glow to say it; this says the
 * opposite — someone wrote, stopped, and the result never left the machine. So
 * it is separated from the activity mark by FORM and by the ABSENCE OF THE
 * GLOW, never by motion: adding movement here would say the one thing that is
 * measurably untrue.
 *
 * That makes it the only one of the four marks with nothing animated at all,
 * which is why `motion-reduce` needs no clause: there is nothing to reduce. The
 * glow's absence is doing the work, and a reduced-motion rule that dimmed it
 * would take the distinction with it.
 *
 * **A BAR, WHERE THE ACTIVITY MARK IS A DOT ON A TRACK.** Same 12px left-edge
 * slot, same emerald family, and the two are still told apart at a glance:
 * one is a bright point with a halo, the other a flat rule with none. A row
 * carrying both shows both — they occupy the same slot at different heights,
 * the way the track already passes under `LiveDot`.
 *
 * **It is NOT `[data-live-dot]`, NOT `[data-change-mark]`, NOT
 * `[data-activity-mark]` and NOT `[data-stuck-cue]`.** Five marks, five
 * meanings, and no mark implemented by modifying another — the precedent #180
 * set and every wave since has kept.
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
      // The same left-edge slot and the same first-line alignment as the
      // activity mark — reusing its placement map rather than restating the
      // string, so a change to the row's padding moves both marks together
      // instead of moving one and stranding the other.
      className={inTrack ? 'relative flex h-1 w-3 shrink-0 items-center' : ACTIVITY_MARK_PLACE.row}
    >
      {/* A flat rule at FULL opacity where the activity track sits at 25%, and
          with no dot riding it. Against the activity mark the difference reads
          without a legend: a solid bar means work that has stopped, a dim track
          with a bright point on it means work in progress. No shadow — the glow
          is the activity mark's alone and is what "someone is here" means. */}
      <span className="h-0.5 w-full rounded-full bg-emerald-600/70 dark:bg-emerald-400/60" />
    </span>
  );
}

/**
 * The mark a row wears for ~3 s after its PR status changed.
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
 * **Under `motion-reduce` the mark STAYS and only the animation stops** — a
 * static tint, the same rule `LiveDot` follows. Hiding the element under reduced
 * motion would pass a motion-only assertion and lose the information along with
 * the movement, which is the defect that rule exists to prevent.
 */
export function ChangeMark() {
  return (
    <span
      aria-hidden
      data-change-mark
      className="pointer-events-none absolute inset-0 animate-pulse bg-amber-300/25 motion-reduce:animate-none dark:bg-amber-400/20"
    />
  );
}

/**
 * Why this branch cannot MOVE — conflicts, failing CI, an unsliced wave.
 *
 * A second line beneath the row's six columns rather than a seventh track:
 * the evidence is three lines wide on a `ci-failing` row and most rows carry
 * none at all, so a track sized for it would push every real column in from
 * the edge across the whole fleet.
 *
 * Where a stuck row's actions used to live — they moved to the three-dot menu
 * under `one-place-for-what-a-row-can-do`. The CUE stayed because it is state
 * rather than an action: it points at something being wrong, and a signal
 * behind a click is not a signal.
 */
export function StuckCell({
  row,
}: {
  row: AgentRow;
}) {
  const stuck = row.stuck;
  const repairLine = repairWord(row.repair);
  // NOT `if (!stuck)` alone, and the difference is the whole point of reporting
  // repairs at all. A SUCCESSFUL repair ends by pushing, which unsticks the
  // branch — so on the very next pulse `stuck` is null while the repair is the
  // freshest thing that happened to it. Returning early there would hide the
  // report at exactly the moment it explains what a reader is looking at, and
  // an automatic write nobody can see is the defect this plan exists to remove.
  if (!stuck && !repairLine) return null;

  const word = stuck ? stuckWord(stuck.state) : '';
  const evidence = stuck ? stuckEvidence(stuck) : [];

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
      className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs sm:col-start-3 sm:col-end-[-1]"
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
      {/* WHAT THE MACHINE DID, on the same line as why it was stuck. A repair
          is an event on this branch, and separating it from the state that
          caused it would make a reader join two places to learn that the
          conflict they are looking at is already being handled — or was, and
          the handling gave up. */}
      {repairLine && (
        <span
          data-repair={row.repair?.state ?? ''}
          data-repair-outcome={row.repair?.outcome ?? ''}
          className="min-w-0 text-slate-500 max-sm:whitespace-normal dark:text-slate-400"
        >
          {repairLine}
        </span>
      )}
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
 * The info mark on a blocked wave, and the overlay that names what blocks it.
 *
 * ## Why an overlay rather than a `title`
 *
 * This was a native `title` for one commit, and it could not do the job asked
 * of it: *show the LINK on hover*. A `title` renders plain text, waits about a
 * second before appearing, cannot be styled, and — the part that decides it —
 * **cannot hold a control**. The blocking wave is a row on screen; a reference
 * to it should be able to take the reader there.
 *
 * ## Why the target is always reachable
 *
 * The blocking wave is a SIBLING in the same list — a plan's waves all render
 * together, so `Shaped` is one or two rows above `Moved` whenever `Moved` says
 * it is blocked. That is why this needs none of App's reveal machinery
 * (`revealBranch`, `highlightBranch`, the nonce): those exist to cross tabs and
 * sections to find a row that may not be rendered. Here the row is a query away.
 *
 * Scoped by PLAN as well as by wave name, because wave names repeat across
 * plans — `Shaped` appears in several of this estate's plans, `Says` in three.
 * The same reason `openWaves` keys on `plan\0wave`.
 *
 * ## Hover AND focus
 *
 * A hover-only disclosure is unreachable by keyboard, and this one holds a
 * control, so it would be a control nobody could tab to. It opens on
 * `mouseenter` and on `focus` within, and closes on `mouseleave`, on blur out,
 * and on Escape.
 */
export function BlockedByMark({ plan, wave }: { plan: string; wave: string }) {
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
  // wave*, and the answer is a glance, not a new state to dismiss.
  const goToWave = () => {
    const target = document.querySelector<HTMLElement>(
      `[data-wave-list="${CSS.escape(plan)}"] [data-wave-row="${CSS.escape(wave)}"]`,
    );
    if (!target) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    // A brief ring, removed on its own. Not a class toggle held in state: the
    // flash belongs to the TARGET row, which this component does not own.
    target.classList.add('ring-2', 'ring-amber-400');
    window.setTimeout(() => target.classList.remove('ring-2', 'ring-amber-400'), 1200);
    setOpen(false);
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
        data-wave-blocked-by={wave}
        aria-haspopup="dialog"
        aria-expanded={open}
        // THE NAME IS IN THE LABEL, not only in the overlay. A reader on a
        // screen reader gets the answer without opening anything, which is the
        // same rule slot 2 follows: recognition must not depend on a disclosure.
        aria-label={`Blocked by wave ${wave} — show it`}
        onClick={goToWave}
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
          data-wave-blocked-panel={wave}
          className="absolute bottom-full right-0 z-20 mb-1 w-max whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <span className="text-slate-500 dark:text-slate-400">blocked by </span>
          <button
            type="button"
            data-wave-goto={wave}
            onClick={goToWave}
            className="font-medium text-sky-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-sky-300"
          >
            {wave}
          </button>
        </span>
      )}
    </span>
  );
}
