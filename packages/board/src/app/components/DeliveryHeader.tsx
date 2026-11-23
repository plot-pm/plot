import type { ReactNode } from 'react';
import { TICKETS_ANCHOR, type DeliveryHeader as DeliveryHeaderFacts, type HeaderGroupBase, type HeaderNumber } from '@plot-pm/domain';
import type { ActivityPace } from '../lib/agent-rows/activity.js';
import { sectionAnchor } from '../lib/agent-rows/delivery-view.js';
import { ActivitySpinner } from '../lib/agent-rows/marks.js';
import { TONE_CLASS } from '../lib/agent-rows/state-classes.js';
import { LinkIcon } from './LinkIcon.js';

type OnJump = (anchor: string) => void;

/** One group's frame: its label, the spinner of hidden activity where `pace` is set, its `open ›` link to the section, the unread clause and the clear sentence. */
const Group = ({ group, onJump, pace = null, children }: { group: HeaderGroupBase; onJump: OnJump; pace?: ActivityPace | null; children?: ReactNode }) => (
  <div data-header-group={group.section} data-header-kind={group.kind} className="delivery-header-group min-w-0 space-y-1">
    <p className="flex items-baseline gap-2">
      <span data-header-label className="delivery-header-label">{group.label}</span>
      {pace !== null && <ActivitySpinner pace={pace} />}
      <button type="button" data-header-open={group.section} onClick={() => onJump(sectionAnchor(group.section))} className="delivery-text-link ml-auto text-[12px]">
        open ›
      </button>
    </p>
    {group.clear !== null && <p data-header-clear className="delivery-hue-green">{group.clear}</p>}
    {children}
    {group.unread !== null && <p data-header-unread className="delivery-hue-amber font-semibold">{group.unread.text}</p>}
  </div>
);

/** The numbers of You or Work items, each in its tone, and the oldest wait. */
const Numbers = ({ numbers, oldest }: { numbers: readonly HeaderNumber[]; oldest: string | null }) => (
  <>
    <p className="flex flex-wrap gap-x-3 tabular-nums">
      {numbers.map((n) => (
        <span key={n.key} data-header-number={n.key} data-count={n.count} className={n.count > 0 ? TONE_CLASS[n.tone] : 'delivery-text-muted'}>
          <span className="font-semibold">{n.count}</span> {n.words}
        </span>
      ))}
    </p>
    {oldest !== null && <p data-header-oldest className="delivery-text-muted">{oldest}</p>}
  </>
);

/**
 * The Delivery tab header: one card of five groups — Release, You, Work items, Fleet and Machine — that never folds.
 *
 * Every word, count and tone comes from `deliveryHeader`; this component decides nothing. `release` is the Release
 * group's content. Each `open ›` and the triage link call `onJump` with the section's anchor.
 */
export const DeliveryHeader = ({ header, release, onJump }: { header: DeliveryHeaderFacts; release: ReactNode; onJump: OnJump }) => {
  const { you, work, fleet, machine } = header;
  return (
    <div data-tab-header className="delivery-card text-[13px]">
      <div data-header-group="release" className="delivery-header-group min-w-0">{release}</div>
      <Group group={you} onJump={onJump}>
        {you.kind !== 'clear' && <Numbers numbers={you.numbers} oldest={you.oldest} />}
        {you.releases.map((r) => (
          <p key={r.label} data-header-release-wait className="delivery-text-muted">{r.label} · {r.reason}</p>
        ))}
        <p data-header-tickets={you.tickets.count ?? 'unread'} className="delivery-text-muted">
          {you.tickets.text}
          {you.tickets.note !== null && <span data-header-tickets-note> · {you.tickets.note}</span>} ·{' '}
          <button type="button" data-header-triage onClick={() => onJump(TICKETS_ANCHOR)} className="delivery-text-link">
            <LinkIcon kind="ticket" />
            triage ›
          </button>
        </p>
      </Group>
      <Group group={work} onJump={onJump}>
        {work.kind !== 'clear' && <Numbers numbers={work.numbers} oldest={work.oldest} />}
      </Group>
      <Group group={fleet} onJump={onJump} pace={fleet.pace}>
        {fleet.status !== null && <p data-header-status className={fleet.kind === 'stopped' ? 'delivery-hue-red font-semibold' : 'delivery-hue-amber font-semibold'}>{fleet.status}</p>}
        {fleet.circles.length > 0 && (
          <p data-header-circles aria-hidden="true" className="flex flex-wrap gap-1">
            {fleet.circles.map((g, i) => <span key={i} data-header-circle={g} className={`delivery-header-circle delivery-header-circle-${g}`} />)}
          </p>
        )}
        {fleet.line !== null && fleet.kind !== 'clear' && <p data-header-line className="tabular-nums">{fleet.line}</p>}
        <p data-header-marks className="delivery-text-muted flex flex-wrap gap-x-2">
          {fleet.marks.map((m) => <span key={m.key} data-header-mark={m.key} data-on={m.on ? '1' : '0'}>{m.text}</span>)}
          <span data-header-parallel>{fleet.parallel}</span>
        </p>
      </Group>
      <Group group={machine} onJump={onJump}>
        {machine.meters.map((m) => (
          <div key={m.key} data-header-meter={m.key} data-tone={m.tone} className="space-y-0.5">
            {m.share !== null && (
              <div aria-hidden="true" className="delivery-header-meter">
                <span className={`delivery-header-meter-fill delivery-header-meter-${m.tone}`} style={{ width: `${Math.round(m.share * 100)}%` }} />
              </div>
            )}
            <p className={m.tone === 'grey' ? 'delivery-text-muted' : 'tabular-nums'}>{m.text}</p>
          </div>
        ))}
      </Group>
    </div>
  );
};
