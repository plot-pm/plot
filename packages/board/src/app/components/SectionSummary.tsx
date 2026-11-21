import { SLICE_STATE_WORDS, type SummaryChip, type SummaryPart, type SummaryTone } from '@plot-pm/domain';
import type { SectionSummaryView } from '../lib/agent-rows/section-summary.js';
import { headerControl, SectionEmptyMark } from './SectionHead.js';

/** The hue class of each chip tone; `zero` and `unread` carry their own grey form. */
const TONE_CLASS: Readonly<Record<SummaryTone, string>> = {
  red: 'delivery-hue-red',
  amber: 'delivery-hue-amber',
  blue: 'delivery-hue-blue',
  green: 'delivery-hue-green',
  grey: 'delivery-tone-neutral',
  zero: 'delivery-chip-zero',
  unread: 'delivery-chip-unread',
};

const Chip = ({ part, anchor, onJump }: { part: SummaryChip; anchor: string | undefined; onJump: (anchor: string) => void }) => {
  const className = `delivery-chip ${TONE_CLASS[part.tone]}`;
  if (anchor === undefined) return <span data-summary-chip={part.key} data-tone={part.tone} className={className}>{part.text}</span>;
  return (
    <button
      type="button"
      {...headerControl}
      data-summary-chip={part.key}
      data-summary-chip-link={anchor}
      data-tone={part.tone}
      onClick={(e) => { e.stopPropagation(); onJump(anchor); }}
      className={`${className} hover:underline`}
    >
      {part.text}
    </button>
  );
};

const Part = ({ part, anchors, onJump }: { part: SummaryPart; anchors: Record<string, string>; onJump: (anchor: string) => void }) => {
  switch (part.kind) {
    case 'chip':
      return <Chip part={part} anchor={anchors[part.key]} onJump={onJump} />;
    case 'text':
      return <span data-summary-text={part.key} className="delivery-text-muted whitespace-nowrap">{part.text}</span>;
    case 'bar': {
      const label = part.segments.map((s) => `${s.count} ${SLICE_STATE_WORDS[s.state]}`).join(' · ');
      return (
        <span data-summary-bar role="img" aria-label={label} title={label} className="delivery-sumbar">
          {part.segments.filter((s) => s.count > 0).map((s) => (
            <i key={s.state} data-summary-segment={s.state} className={`delivery-state-${s.state}`} style={{ width: `${(s.count / part.total) * 100}%` }} />
          ))}
        </span>
      );
    }
    case 'circles':
      return (
        <span data-summary-circles className="delivery-circles" aria-hidden="true">
          {part.circles.map((group, i) => <b key={i} data-summary-circle={group} className={`delivery-circle delivery-circle-${group}`} />)}
        </span>
      );
  }
};

/**
 * A folded section's summary, drawn in `SectionHead`'s summary slot.
 *
 * Every count, tone and link is `sectionSummariesOf`'s; this renders them. A linking chip calls
 * `onJump`, the tab's `jump`, which opens the target section and group before it scrolls.
 */
export const SectionSummary = ({ summary, onJump }: { summary: SectionSummaryView; onJump: (anchor: string) => void }) => {
  if (summary.empty !== null) {
    return (
      <span data-section-summary-empty={summary.empty.kind} className="flex items-center gap-2">
        <SectionEmptyMark empty={summary.empty} />
        <span data-summary-empty-sentence className="delivery-text-muted">{summary.empty.sentence}</span>
        {summary.hidden !== null && <span data-summary-hidden className="delivery-chip delivery-chip-zero">{summary.hidden}</span>}
      </span>
    );
  }
  return (
    <span data-section-summary-parts className="flex flex-wrap items-center gap-2">
      {summary.parts.map((part, i) => <Part key={`${part.kind}-${i}`} part={part} anchors={summary.anchors} onJump={onJump} />)}
    </span>
  );
};
