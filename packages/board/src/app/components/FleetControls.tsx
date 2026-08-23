import { useEffect, useRef, useState } from 'react';
import type { Fleet } from '../../contract/schema.js';

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
 * ## This wave dispatches nothing
 *
 * The switch records an intention wave 3 reads; turning it on here starts no
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
      aria-label="parallel agents"
      aria-valuenow={count}
      aria-valuemin={MIN_PARALLEL_AGENTS}
      aria-valuetext={`${count} agents`}
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
      <span aria-hidden className="ml-0.5">
        parallel agents
      </span>
    </span>
  );
}
