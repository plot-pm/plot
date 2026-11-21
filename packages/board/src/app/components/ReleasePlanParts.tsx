import { useContext } from 'react';
import { linkIconKind, type HeaderCountPart, type PlanLine } from '@plot-pm/domain';
import type { PlanRowView, ReleaseBlockView, ReleaseHeaderView } from '../lib/agent-rows/delivery-view.js';
import { artifactTuple } from '../lib/tuple-row.js';
import { TicketHrefContext } from './PlanTicketKeys.js';
import { SEGMENT_CLASS } from '../lib/agent-rows/state-classes.js';
import { LinkIcon } from './LinkIcon.js';
import { LinkTupleView } from './TupleRow.js';

/** The hue of a Release header count, by key; a key not named here takes the body colour. */
const COUNT_HUE: Readonly<Partial<Record<HeaderCountPart['key'], string>>> = {
  delivered: 'delivery-hue-green',
  'at-a-gate': 'delivery-hue-amber',
  blocked: 'delivery-hue-red',
};

/** The Phase chip's hue, by the row's `accent`: the colours `PlanCard.tsx`'s `PHASE_ACCENT` draws on a card's edge. */
const PHASE_HUE: Readonly<Record<string, string>> = {
  neutral: 'delivery-tone-neutral',
  Discovery: 'delivery-hue-sky',
  Design: 'delivery-hue-slate',
  Development: 'delivery-hue-green',
  Testing: 'delivery-hue-violet',
  Released: 'delivery-hue-orange',
};

/** The state word of an opened plan line and its hue, by the slice's state. */
const LINE_STATE: Readonly<Record<PlanLine['state'], { word: string; hue: string }>> = {
  delivered: { word: '✓ merged', hue: 'delivery-hue-green' },
  blocked: { word: '✕ blocked', hue: 'delivery-hue-red' },
  'at-a-gate': { word: '⟳ at CI', hue: 'delivery-hue-amber' },
  'being-built': { word: '● building', hue: 'delivery-hue-blue' },
  'not-started': { word: '○ not started', hue: '' },
  unread: { word: '○ not read', hue: '' },
};

/** The column headers of the plan table, shown from 640 px up. */
export const PLAN_COLUMNS = ['Plan', 'Phase', 'Slices', 'Owner'] as const;

/** The plan table's tracks: Plan, Phase, Slices, Owner and the actions cell, which holds one 1.25 rem menu. */
export const PLAN_TRACKS = 'sm:grid-cols-[minmax(0,2fr)_7rem_minmax(0,1.5fr)_6rem_1.25rem]';

/** The header bar of one Release block: its name where it has one, then each count's number in bold and its words. */
export const ReleaseLine = ({ block }: { block: Pick<ReleaseBlockView, 'release' | 'name' | 'header' | 'counts'> }) => {
  const label = block.release !== '' ? block.release : block.name;
  return (
    <p data-release-line title={block.header} className="delivery-counts delivery-release-line px-3">
      {label !== '' && <span data-release-label className="delivery-release-label">{label}</span>}
      {block.counts.map((c) => (
        <span key={c.key} data-release-count={c.key}>
          <b className={`delivery-count-n ${COUNT_HUE[c.key] ?? ''}`}>{c.count}</b> {c.words}
        </span>
      ))}
    </p>
  );
};

/**
 * The counts of the Release delivery header line: the one block's release or sprint, then each count's number in bold and its words.
 *
 * A count with an anchor is a button that calls `onJump` with the anchor and stops the click, so the header row it sits in does not
 * also fold or open. A count of 0 has no anchor and is text.
 */
export const ReleaseHeaderCounts = ({ head, onJump }: { head: ReleaseHeaderView; onJump: (anchor: string) => void }) => (
  <span data-release-header {...(head.title === '' ? {} : { title: head.title })} className="delivery-counts ml-2 flex flex-wrap items-baseline gap-x-3 font-normal">
    {head.scope !== '' && <span data-release-header-scope className="delivery-release-label">{head.scope}</span>}
    {head.counts.map((c) => {
      const figure = <><b className={`delivery-count-n ${COUNT_HUE[c.key] ?? ''}`}>{c.count}</b> {c.words}</>;
      return (
        <span key={c.key} data-release-header-count={c.key}>
          {c.anchor === null ? figure : (
            <button
              type="button"
              data-release-header-link={c.key}
              onClick={(e) => {
                e.stopPropagation();
                onJump(c.anchor!);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="hover:underline"
            >
              {figure}
            </button>
          )}
        </span>
      );
    })}
  </span>
);

/** The plan table's header row. */
export const PlanTableHead = () => (
  <div data-plan-thead className={`delivery-thead hidden gap-x-3 px-3 sm:grid ${PLAN_TRACKS}`}>
    {PLAN_COLUMNS.map((c) => <span key={c} role="columnheader">{c}</span>)}
    <span />
  </div>
);

/**
 * The Plan cell: the ▸ toggle, which opens and closes the slice lines, then the plan's tuple from `artifactTuple`.
 *
 * Each of the plan's ticket keys is its own ticket segment, and the plan segment after them links to `plan.href`. A plain click on
 * the slug calls `onOpenPlan` and, where it answers `true`, keeps the page; a modified click or another button keeps the browser's
 * own handling. Where `href` is `''`, the slug is plain text. The `title` carries `plan.label`, the keys and the slug.
 */
export const PlanName = ({ plan, open, onToggle, onOpenPlan }: {
  plan: Pick<PlanRowView, 'plan' | 'label' | 'keys' | 'planFile' | 'href'>;
  open: boolean;
  onToggle: () => void;
  onOpenPlan?: ((planFile: string) => boolean) | undefined;
}) => {
  const ticketHref = useContext(TicketHrefContext);
  const segments = artifactTuple({ what: 'plan', label: plan.plan, href: plan.href, internal: true, file: plan.planFile, keys: plan.keys }, ticketHref);
  const hook = { 'data-plan-link': plan.plan };
  return (
    <span className="delivery-release-plan flex w-full min-w-0 items-center gap-1 sm:w-auto" title={plan.label}>
      <button
        type="button"
        data-plan-toggle={plan.plan}
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} the slices of ${plan.plan}`}
        onClick={onToggle}
        className="shrink-0"
      >
        <span aria-hidden="true" className={`inline-block w-4 shrink-0 text-center transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      <LinkTupleView
        segments={segments}
        onOpenPlan={onOpenPlan}
        controls={segments.map((segment) => (segment.what === 'plan' ? { extraAttr: { link: hook } } : undefined))}
      />
    </span>
  );
};

/** The Phase cell: a chip with the phase word, or nothing where the plan has no phase. */
export const PhaseChip = ({ plan }: { plan: Pick<PlanRowView, 'phase' | 'accent'> }) => (
  plan.phase === undefined
    ? null
    : <span data-plan-phase-chip={plan.accent ?? ''} className={`delivery-chip ${PHASE_HUE[plan.accent ?? ''] ?? ''}`}>{plan.phase}</span>
);

/**
 * The Slices cell: one block per slice in the five-state colours, each state's count as words beside it.
 *
 * Each `data-strip-segment` holds its blocks and its words (`2 delivered`); the words are visually hidden, so the
 * strip's accessible name and every test reading the segment get the same wording.
 */
export const PlanStrip = ({ plan }: { plan: Pick<PlanRowView, 'strip' | 'stripText' | 'unread'> }) => {
  const words = plan.strip.map((seg) => `${seg.count} ${seg.state}`).join(', ');
  return (
    <span data-plan-strip className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {plan.strip.length > 0 && (
        <span className="delivery-strip" title={words}>
          {plan.strip.map((seg) => (
            <span key={seg.state} data-strip-segment={seg.state} className="contents">
              {Array.from({ length: seg.count }, (_, i) => (
                <span key={i} aria-hidden="true" className={`delivery-strip-block ${SEGMENT_CLASS[seg.state]}`} />
              ))}
              <span className="sr-only">{seg.count} {seg.state}</span>
            </span>
          ))}
        </span>
      )}
      <span data-strip-text className="delivery-release-strip-text">{plan.stripText}</span>
      {plan.unread > 0 && <span data-strip-unread className="delivery-release-strip-text">{plan.unread} not read</span>}
    </span>
  );
};

/** The state word of an opened plan line, coloured by the slice's state. */
export const LineState = ({ state }: { state: PlanLine['state'] }) => (
  <span data-plan-line-state={state} className={`delivery-release-state ${LINE_STATE[state].hue}`}>{LINE_STATE[state].word}</span>
);

/** A line's PR as a PR tuple: a link where the payload holds its address, the number as text where it does not. */
export const LinePr = ({ pr, url }: { pr: number; url: string | null }) => {
  const hook = { 'data-plan-line-pr': `${pr}` };
  return <LinkTupleView segments={artifactTuple({ what: 'pr', label: `${pr}`, href: url ?? '' }, () => undefined)} controls={[{ extraAttr: { link: hook, text: hook } }]} />;
};

/**
 * An opened plan line's slice as a slice tuple: a button that scrolls to the slice's item where `onJump` is given,
 * and text where it is not.
 */
export const LineSlice = ({ line, onJump }: { line: Pick<PlanLine, 'heading' | 'slice' | 'text' | 'pr'>; onJump?: (() => void) | undefined }) => (
  <LinkTupleView
    segments={artifactTuple({ what: 'wave', label: lineBody(line), href: '' }, () => undefined)}
    controls={[onJump === undefined ? undefined : { extraAttr: { text: { 'data-plan-line-link': '' } }, onActivate: onJump }]}
  />
);

/** A plan's owner: the person icon, then the handle. */
export const PlanOwner = ({ owner }: { owner: string }) => (
  <span data-plan-owner className="inline-flex items-baseline"><span className="sm:hidden">Owner </span><LinkIcon kind={linkIconKind('person')} />{owner}</span>
);

/**
 * The words of an opened plan line after its state word.
 *
 * A Done line with a PR shows the slice name, and the PR and merge time follow apart; a Done line without one keeps
 * its name and any named commit. Every other line keeps its text.
 */
export const lineBody = (line: Pick<PlanLine, 'heading' | 'slice' | 'text' | 'pr'>): string => {
  if (line.heading !== 'done') return line.text;
  return line.pr !== undefined ? line.slice : line.text.replace(/^✓ merged · /, '');
};
