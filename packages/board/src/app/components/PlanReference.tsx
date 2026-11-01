import type { MouseEvent } from 'react';
import type { PlanReferenceAnswer } from '@plot-pm/domain';

/** The keys a plain click checks before it may be intercepted — matches `TupleRow.tsx`'s own anchor handler. */
interface ClickModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}

/**
 * Whether a click is the plain primary click a plan reference intercepts.
 *
 * Cmd, Ctrl, Shift, Alt or a button other than the primary one each ask for
 * the browser's own handling — opening a new tab, for instance — so none of
 * them is swallowed.
 *
 * @param e - the click's modifier keys and button.
 * @returns whether the component may call `onOpenPlan` and prevent navigation.
 */
export const isPlainPlanClick = (e: ClickModifiers): boolean =>
  !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0;

/**
 * Renders one {@link PlanReferenceAnswer} and decides nothing else.
 *
 * With an `href`, a real `<a>` — a plain click or Enter calls `onOpenPlan`
 * and, where it answers `true`, prevents the navigation; a modified click or
 * another button is never intercepted, and the component never sets
 * `target`. Without an `href`, a `<span>` carrying the same text.
 *
 * The prefix is `shrink-0` so it is never the part an ellipsis eats; the slug
 * is `truncate` with a floor of 8 visible characters, so two plans sharing an
 * issue key still read apart by their first 8 slug characters in a narrow
 * column. The `title` attribute and the accessible name always carry the
 * full label and the plan's title, even where the visible text is cut.
 *
 * @param answer - the resolved reference, from `planReference`.
 * @param file - the plan's file, passed to `onOpenPlan` on a plain click; `undefined` where the reference named none.
 * @param onOpenPlan - called on a plain click or Enter; `true` prevents the anchor's own navigation.
 */
export function PlanReference({
  answer,
  file,
  onOpenPlan,
}: {
  answer: PlanReferenceAnswer;
  file?: string;
  onOpenPlan?: (file: string) => boolean;
}) {
  const prefix = answer.issues.length > 0 ? `${answer.issues.join(', ')}: ` : '';
  // `planReference` builds `label` as exactly `prefix + slug`, so slicing off
  // the prefix's own length recovers the slug without a second field on the
  // domain's answer shape.
  const slug = answer.label.slice(prefix.length);
  const title = answer.title ? `${answer.label} — ${answer.title}` : answer.label;
  const content = (
    <>
      {prefix && <span className="shrink-0">{prefix}</span>}
      <span className="min-w-[8ch] truncate">{slug}</span>
    </>
  );

  if (!answer.href) {
    return (
      <span data-tuple-text="plan" data-plan-ref title={title} aria-label={`Plan ${answer.label}`} className="flex min-w-0 items-baseline">
        {content}
      </span>
    );
  }

  // A focused anchor's native Enter keypress dispatches a plain click — no
  // modifiers, primary button — so this one handler covers both inputs the
  // brief names; no separate `onKeyDown` is needed.
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainPlanClick(e)) return;
    if (file === undefined || !onOpenPlan) return;
    if (!onOpenPlan(file)) return;
    e.preventDefault();
  };

  return (
    <a
      href={answer.href}
      data-tuple-link="plan"
      data-plan-ref
      title={title}
      aria-label={`Plan ${answer.label}`}
      onClick={handleClick}
      className="flex min-w-0 items-baseline text-blue-600 hover:underline dark:text-blue-400"
    >
      {content}
    </a>
  );
}
