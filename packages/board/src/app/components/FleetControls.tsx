import { useEffect, useRef, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import type { Fleet, RegistryInfo, Supervisor } from '../../contract/schema.js';

/**
 * THE TWO SECTION-HEADER CONTROLS: a switch on NOT STARTED, a stepper on
 * WORKING.
 *
 * Each renders on the section it is ABOUT. NOT STARTED holds work nobody has
 * taken, so *is the queue being served?* goes there. WORKING holds the running
 * agents, so *how many may run at once?* is a statement about that section's
 * contents. Read together they are the model — serve the queue / this many at a
 * time — which is why they are two controls in two places, not one panel.
 *
 * ## Server truth, optimistically echoed
 *
 * The authoritative state lives on the server, in `.plot/state/`, and reaches
 * here on `fleet.fleetControls` every poll. A control that rendered that value
 * directly would lag up to one poll (4 s) behind a click, which a spinbutton
 * cannot afford. So each control keeps a local echo: a click updates the echo
 * and POSTs, and the POST's RESPONSE — the server's own resulting state — is
 * adopted as the new truth. Between the click and the response, incoming polls
 * are ignored for the field being written, so a 4 s-old poll cannot clobber a
 * value the operator just set. Once no write is outstanding, the poll is the
 * truth again — which is what keeps two boards agreeing.
 *
 * ## This slice dispatches nothing
 *
 * The switch records an intention slice 3 reads; turning it on here starts no
 * agent. Turning either off is a promise about the FUTURE only — it never stops
 * a running worker, whose home is the agent panel.
 */

/** The one endpoint both controls write through. */
const ENDPOINT = '/api/fleet-controls';

/** The floor the stepper refuses to cross, matching the server's own clamp. */
export const MIN_PARALLEL_AGENTS = 1;

/**
 * POST a partial change and return the server's resulting controls, or null on
 * any failure. Same-origin by construction — this page is the board's own
 * origin — so the request carries no special headers; the browser sets
 * `sec-fetch-site` and `origin`, which is exactly what the endpoint checks.
 */
async function postControls(
  patch: Partial<Fleet['fleetControls']>,
): Promise<Fleet['fleetControls'] | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Fleet['fleetControls'];
    if (typeof body?.autoDispatch !== 'boolean' || typeof body?.parallelAgents !== 'number') {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

/**
 * The auto-dispatch switch, for the NOT STARTED header.
 *
 * A real `checkbox` with a text label, so a screen reader announces both its
 * ROLE and its checked state — `role="switch"` was considered and rejected: the
 * board owns no switch styling and a native checkbox already announces on/off,
 * where a bare `role="switch"` on a `<span>` would need the whole keyboard and
 * `aria-checked` contract rebuilt by hand. The label text carries the meaning
 * (*Auto-dispatch*) so the control is not a naked box a reader must guess at.
 */
export function AutoDispatchSwitch({ value }: { value: boolean }) {
  // The local echo, seeded from the server and re-seeded by every poll UNLESS a
  // write is in flight — see the effect below.
  const [checked, setChecked] = useState(value);
  const [busy, setBusy] = useState(false);
  // Whether a write is outstanding, in a ref so the reconciling effect reads the
  // live value rather than a closed-over stale one.
  const writing = useRef(false);

  // Adopt the server's value on each poll — but only when no write is
  // outstanding. A poll that lands mid-write carries the value from BEFORE the
  // click, and adopting it would flip the switch back under the operator's hand.
  useEffect(() => {
    if (!writing.current) setChecked(value);
  }, [value]);

  const toggle = async () => {
    const next = !checked;
    setChecked(next); // optimistic
    setBusy(true);
    writing.current = true;
    const result = await postControls({ autoDispatch: next });
    writing.current = false;
    setBusy(false);
    // Adopt the server's answer on success; roll the echo back on failure so the
    // control never claims a state the server did not accept.
    setChecked(result ? result.autoDispatch : value);
  };

  return (
    <label className="flex items-center gap-1.5 text-xs font-normal normal-case tracking-normal text-slate-500 dark:text-slate-400">
      <input
        type="checkbox"
        data-fleet-auto-dispatch
        checked={checked}
        disabled={busy}
        onChange={() => void toggle()}
        className="h-3.5 w-3.5 accent-slate-500"
      />
      auto-dispatch
    </label>
  );
}

/**
 * The parallel-agent cap, for the WORKING header — a real `spinbutton`.
 *
 * Not two buttons beside a label: a `spinbutton` is the ARIA role for a numeric
 * value with increment/decrement, and building it as such is what lets a screen
 * reader read the value and its bounds. The `−` and `+` are its two adjusters,
 * and the number between them is announced through `aria-valuenow`. It refuses
 * to go below {@link MIN_PARALLEL_AGENTS}: a cap of zero is a stopped fleet
 * expressed as a number, which the switch already says better.
 *
 * ArrowUp / ArrowDown adjust it from the keyboard, which is the spinbutton's
 * expected interaction — a reader who lands on it with Tab can change it without
 * reaching for the two buttons.
 */
export function ParallelAgentsStepper({ value }: { value: number }) {
  const [count, setCount] = useState(value);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);

  useEffect(() => {
    if (!writing.current) setCount(value);
  }, [value]);

  const commit = async (next: number) => {
    // The floor lives here as well as on the server: a control that let the
    // value reach 0 and relied on the endpoint to raise it would flash a 0 the
    // fleet never runs at.
    const bounded = Math.max(MIN_PARALLEL_AGENTS, next);
    if (bounded === count && !writing.current) return;
    setCount(bounded); // optimistic
    setBusy(true);
    writing.current = true;
    const result = await postControls({ parallelAgents: bounded });
    writing.current = false;
    setBusy(false);
    setCount(result ? result.parallelAgents : value);
  };

  const atFloor = count <= MIN_PARALLEL_AGENTS;

  return (
    <span
      role="spinbutton"
      data-fleet-parallel-agents
      aria-label="parallel agents cap"
      aria-valuenow={count}
      aria-valuemin={MIN_PARALLEL_AGENTS}
      aria-valuetext={`${count} agents cap`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          void commit(count + 1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          void commit(count - 1);
        }
      }}
      className="inline-flex items-center gap-1 text-xs font-normal normal-case tracking-normal text-slate-500 dark:text-slate-400"
    >
      {/*
        THE LABEL LEADS AND THE WIDGET IS FLUSH RIGHT. The control sits in a
        right-aligned column, so whichever of its own children is last lands on
        the section's right edge — and that edge should hold the `+` a reader
        aims at, not the words explaining it. Reading order is unchanged:
        *parallel agents* then the value.
      */}
      <span aria-hidden className="mr-0.5">
        parallel agents
      </span>
      <button
        type="button"
        data-fleet-parallel-decrement
        // `aria-hidden` on the two adjusters: the spinbutton itself carries the
        // value and its bounds for a screen reader, and the buttons would
        // otherwise announce as two more unlabelled controls beside it. A sighted
        // reader clicks them; a screen-reader reader uses Arrow keys on the
        // spinbutton, which is the role's own interaction.
        aria-hidden
        tabIndex={-1}
        disabled={busy || atFloor}
        onClick={() => void commit(count - 1)}
        className="flex h-4 w-4 items-center justify-center rounded border border-slate-300 leading-none disabled:opacity-40 dark:border-slate-700"
      >
        −
      </button>
      <span data-fleet-parallel-value className="min-w-[1.5ch] text-center tabular-nums">
        {count}
      </span>
      <button
        type="button"
        data-fleet-parallel-increment
        aria-hidden
        tabIndex={-1}
        disabled={busy}
        onClick={() => void commit(count + 1)}
        className="flex h-4 w-4 items-center justify-center rounded border border-slate-300 leading-none disabled:opacity-40 dark:border-slate-700"
      >
        +
      </button>
    </span>
  );
}

/**
 * WHAT A READER CAN ACT ON, beside the WORKING heading — and nothing else.
 *
 * The header carried five figures in one line: the cap's own label, a registry
 * size, a filter gap, a manifest split and a supervisor reading, all
 * `·`-separated in reading order. Their combined width is what moved the
 * stepper between renders, and the stepper is the thing an operator aims at.
 * So the counts stay on the left, where text belongs, and the control leaves
 * them.
 *
 * COLLAPSED TO WHAT DISAGREES WITH SOMETHING. Each figure earns its place by
 * stating a fact neither the tally nor the rows already carry:
 *
 * - `N not working` — registry entries the section is NOT showing, because
 *   their worker is finished, stalled or gone. The section renders live agents
 *   only, so its tally is the live count and `N running` beside it would be one
 *   number twice; this is the figure that differs from it.
 * - the filter gap — printed only when a filter WOULD hide a live worker.
 * - the manifest split — printed only when the counts disagree, which is the
 *   rule `RegistryInfo`'s annotation already followed: `3 manifests, 3 agents`
 *   says nothing. `0 manifests, 12 synthesized` said in one line what took ten
 *   minutes to diagnose.
 *
 * NONE OF THE THREE IS PRINTED WHEN IT AGREES — a zero is an absence and is
 * rendered as one. A header that always prints every figure trains a reader to
 * skip the line, which is how a correct sentence sat in a chip for an hour on
 * 2026-09-09.
 */
export function WorkingCounts({
  notWorking,
  hiddenByFilter,
  registry,
}: {
  /**
   * Registry entries whose worker is not live — finished, stalled, exited. The
   * section shows the live ones, so this is what it is not showing.
   */
  notWorking?: number;
  /** Live workers a sprint filter would hide if it were applied. */
  hiddenByFilter?: number;
  /** The registry read, for the manifest split. */
  registry?: RegistryInfo;
}) {
  // Printed only when there are some. Zero entries not working is the ordinary
  // state and the tally already said it, so `· 0 not working` is the redundant
  // clause this slice removes rather than adds.
  const showRunning = typeof notWorking === 'number' && notWorking > 0;
  const showHidden = typeof hiddenByFilter === 'number' && hiddenByFilter > 0;
  // The rule `RegistryInfo`'s own annotation already carried, reused rather
  // than reinvented: no manifests at all (the error case) or anything
  // synthesized.
  const showRegistry = !!registry && (registry.manifestCount === 0 || registry.synthesizedCount > 0);
  if (!showRunning && !showHidden && !showRegistry) return null;

  return (
    <span className="flex items-baseline gap-1.5 text-xs font-normal normal-case tracking-normal text-slate-500 dark:text-slate-400">
      {showRunning && (
        <span
          data-fleet-working
          className="tabular-nums"
          title={`${notWorking} registry entr${notWorking === 1 ? 'y' : 'ies'} whose worker is finished, stalled or gone — this section shows the live ones`}
        >
          · {notWorking} not working
        </span>
      )}
      {showHidden && (
        <span
          data-fleet-hidden-by-filter
          className="tabular-nums text-amber-600 dark:text-amber-500"
          title={`${hiddenByFilter} live workers on plans outside the selected sprint filter`}
        >
          ({hiddenByFilter} hidden by filter)
        </span>
      )}
      {showRegistry && registry && (
        <span
          data-fleet-registry
          className={`tabular-nums ${registry.manifestCount === 0 ? 'text-amber-600 dark:text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}
          title={`Registry: ${registry.directory}\n${registry.manifestCount} manifest(s) read, ${registry.synthesizedCount} synthesized from worktrees`}
        >
          · {registry.manifestCount} manifest{registry.manifestCount !== 1 ? 's' : ''}{registry.synthesizedCount > 0 && `, ${registry.synthesizedCount} synthesized`}
        </span>
      )}
    </span>
  );
}

/**
 * WHETHER ANYTHING SUPERVISES THESE AGENTS — on its own line under the WORKING
 * heading, and neither a control nor a count.
 *
 * ## Why it is not in the stepper any more
 *
 * Wave 2 shipped this inside `ParallelAgentsStepper`, which was right while
 * there was no header layout to hang it on and is wrong now, for two reasons
 * that are both about the `spinbutton` it was nested in. A screen reader
 * announces a `spinbutton`'s contents as part of the control's value, so the
 * outage sentence was read as the cap's reading. And the control is now
 * right-aligned, which would have carried the alert into the control column —
 * making an alert compete for the edge a control owns.
 *
 * So it takes its own line: *"It is not a control and it is louder than a
 * status; competing for either edge would make it one of them."*
 *
 * ## Nothing is decided here
 *
 * `shown`, `label`, `detail` and `prominence` all arrive from
 * `supervisorVerdict` in the domain, asserted in
 * `packages/domain/test/supervisor-reading.test.ts` with no browser. This maps
 * `prominence` to class strings and renders the words it was given. THE WORD IS
 * NOT CHOSEN HERE: the label says FLEET because the domain says so, since
 * `/plot-fleet` is the command a person types and no supervisor command exists.
 * A prefix concatenated here would be a second vocabulary no test of the rule
 * could see.
 *
 * `alert` — the fleet stopped while agents run — is the level a chip cannot
 * carry. Measured 2026-09-09: three agents idle 44-57 minutes with merged PRs,
 * an eligible slice untaken, and this exact sentence in a grey chip a person
 * read for an hour without acting.
 *
 * `note` — the `unknown` state — is deliberately NOT amber: a board that could
 * not ask must render neither an alarm nor an all-clear. Promoting it would
 * train the operator to dismiss the alert that matters.
 *
 * IT PRINTS THE REPAIR AND RUNS NOTHING. The detail carries
 * `/plot-fleet --start` as text a person types; a button here would make a page
 * load a lifecycle action, which is the boundary `DESIGN-process.md` draws
 * between the board and fleet control.
 */
export function FleetAlert({ supervisor }: { supervisor?: Supervisor }) {
  if (!supervisor?.shown) return null;
  const loud = supervisor.prominence === 'alert';
  return (
    <div
      data-fleet-supervisor
      data-fleet-supervisor-state={supervisor.state}
      data-fleet-supervisor-prominence={supervisor.prominence}
      // `role="alert"` ONLY when it is one. A `note` that announced itself
      // would interrupt a screen-reader reader to say the board could not ask a
      // question, which is the same over-promotion the colours refuse.
      {...(loud ? { role: 'alert' as const } : {})}
      className={
        loud
          ? 'mb-2 flex flex-wrap items-baseline gap-x-2 rounded border border-red-500 bg-red-50 px-3 py-1 text-xs font-semibold normal-case tracking-normal text-red-700 dark:border-red-500 dark:bg-red-950 dark:text-red-300'
          : `mb-2 flex flex-wrap items-baseline gap-x-2 px-3 text-xs font-normal normal-case tracking-normal ${
              supervisor.prominence === 'warn'
                ? 'text-amber-600 dark:text-amber-500'
                : 'text-slate-400 dark:text-slate-500'
            }`
      }
      title={supervisor.detail}
    >
      <span data-fleet-supervisor-label>
        {loud && <span aria-hidden>⚠ </span>}
        {supervisor.label}
      </span>
      {/*
        THE CONSEQUENCE AND THE REPAIR, in the domain's own words. The detail is
        the sentence that names what will not happen and what to type; the chip
        carried it in a `title` only, where a reader who never hovered never saw
        it. On its own line there is room to print it, and the outage this plan
        was written from is exactly the case where the reader needed the
        sentence rather than the word.
      */}
      {loud && <span data-fleet-supervisor-detail className="font-normal">{supervisor.detail}</span>}
    </div>
  );
}
