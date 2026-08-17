/**
 * The marker an acting button carries while a click is in flight.
 *
 * A SPINNER, and deliberately not the WORKING rows' pulsing dot. The two say
 * different things and the difference is their LIFETIME:
 *
 * | Indicator            | Means                                  | Lives for |
 * |----------------------|----------------------------------------|-----------|
 * | `LiveDot` on a row   | something is alive here, end unknown   | hours     |
 * | this, on a button    | an answer is coming                    | seconds   |
 *
 * `working-rows-show-motion` chose a pulse over a spinner for two reasons, and
 * neither survives the move onto a button. *Rotation implies progress toward
 * completion, which nothing here measures* — true of a row, whose `isLive` is
 * just `group === 'working'` and can pulse all afternoon; a click resolves when
 * the request returns and the pulse confirms. *Four rotating spinners in a
 * column is flicker* — true of WORKING, which regularly holds several rows;
 * there is never more than one button in flight.
 *
 * Unifying the two was considered in both directions and rejected in both. One
 * indicator everywhere would make every WORKING row promise a completion
 * nothing measures, which is the exact defect the pulse was chosen to avoid.
 *
 * `aria-hidden`, because the state is already announced twice — the label reads
 * `starting…` / `approving…` and `aria-busy` is set. A third announcement from
 * a marker would say the same thing again. Decoration on top of information,
 * never the carrier of it: the same rule the row's dot follows.
 *
 * Under `prefers-reduced-motion` the ROTATION stops and the MARKER STAYS.
 * Rendering nothing there would take the marker away with the motion, leaving a
 * reader who prefers reduced motion with less information rather than the same
 * information held still — the rule `working-rows-show-motion` settled, and the
 * reason the ring below is a ring rather than a bare arc: stopped, it still
 * reads as a mark beside the word.
 *
 * Tailwind's own `animate-spin` with `motion-reduce:animate-none`, for the same
 * reason the dot used `animate-pulse`: the reduced-motion variant arrives with
 * the utility rather than needing a keyframe and a media query of our own.
 */
export function ActingSpinner() {
  return (
    <span
      aria-hidden
      data-acting-spinner
      className="ml-1 inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent align-[-1px] motion-reduce:animate-none"
    />
  );
}

/**
 * What an acting button looks like while it is acting.
 *
 * Dimming, on the same state that drives the label — never a timer of its own.
 * The button is genuinely unavailable in that moment and dimming is how this
 * board already says so, so the three signals say it once each in a different
 * channel: motion (the spinner), text (`starting…`), contrast (this).
 */
export const ACTING_CLASS = 'opacity-60';
