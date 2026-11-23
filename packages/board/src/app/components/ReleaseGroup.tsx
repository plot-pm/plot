import { useCallback, useEffect, useState } from 'react';
import { SLICE_STATE_WORDS, releaseStatusLine } from '@plot-pm/domain';
import type { PasskeyRegistration } from '@plot-pm/domain/rules/passkey-settings';
import type { ReleaseGroupOf } from '../lib/agent-rows/delivery-readings.js';
import { SEGMENT_CLASS } from '../lib/agent-rows/state-classes.js';
import { readRegistration } from '../lib/passkey-client.js';
import { artifactTuple } from '../lib/tuple-row.js';
import { LinkTupleView } from './TupleRow.js';
import { ReleaseApprove } from './ReleaseApprove.js';

const noTicket = () => undefined;

/**
 * The Delivery tab header's Release group: one title, scope line, five-state bar and legend over
 * every sprint in scope, the status line, and the "Approve release" button in a fixed slot.
 *
 * Every word and count comes from `releaseGroup` and `releaseStatusLine`; this component decides
 * nothing. It holds the passkey answer, `null` until `readRegistration` answers, and reads it
 * again after every click.
 */
export const ReleaseGroup = ({ view }: { view: ReleaseGroupOf }) => {
  const { group, rows, prReading } = view;
  const [passkey, setPasskey] = useState<PasskeyRegistration | null>(null);
  const reread = useCallback(() => { void readRegistration().then(setPasskey); }, []);
  useEffect(reread, [reread]);
  const line = releaseStatusLine(group, prReading, passkey);
  const slotRow = line.slot.rowId === null ? null : rows[line.slot.rowId] ?? null;

  return (
    <div
      data-release-group={group.kind}
      data-release-group-scope={group.scope}
      className="delivery-release-group text-[13px]"
    >
      <div className="delivery-release-group-body relative min-w-0 space-y-2">
        {/* The to-do list's "Approve release" lines jump to these anchors. */}
        {group.candidates.map((c) => <span key={c.key} id={c.anchor} aria-hidden className="absolute top-0 left-0" />)}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {/* The payload holds no release URL, so the release segment is text. A group naming no release is no artifact. */}
          {group.kind === 'none' ? (
            <span data-release-group-title className="delivery-title min-w-0 break-words">{group.title}</span>
          ) : (
            <span data-release-group-title className="delivery-title inline-flex min-w-0">
              <LinkTupleView segments={artifactTuple({ what: 'release', label: group.title, href: '' }, noTicket)} />
            </span>
          )}
          <span data-release-group-scope-line className="delivery-text-muted min-w-0 break-words">{group.scopeLine}</span>
        </div>
        {group.sprints.length > 0 && (
          <p className="flex min-w-0 flex-wrap gap-1.5">
            {group.sprints.map((s) => (
              <span key={s.slug} data-release-group-sprint={s.slug} className="inline-flex min-w-0">
                <LinkTupleView segments={artifactTuple({ what: 'sprint', label: s.title, href: '' }, noTicket)} />
              </span>
            ))}
          </p>
        )}
        <div
          data-release-group-bar
          data-reading-missing={group.readingMissing ? '' : undefined}
          role="img"
          aria-label={group.bar === null ? line.text : group.bar.map((s) => `${s.count} ${SLICE_STATE_WORDS[s.state]}`).join(', ')}
          className="flex w-full overflow-hidden"
        >
          {group.bar?.map((s) => (
            s.count > 0 ? <span key={s.state} data-release-group-segment={s.state} data-count={s.count} style={{ flexGrow: s.count }} className={SEGMENT_CLASS[s.state]} /> : null
          ))}
        </div>
        {group.bar !== null && group.total > 0 && (
          <p data-release-group-legend className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            {group.bar.map((s) => (
              s.count > 0 ? (
                <span key={s.state} data-release-group-legend-item={s.state} className="inline-flex items-center tabular-nums">
                  <span aria-hidden className={`delivery-release-swatch ${SEGMENT_CLASS[s.state]}`} />
                  {s.count} {SLICE_STATE_WORDS[s.state]}
                </span>
              ) : null
            ))}
          </p>
        )}
        <p data-release-status className="delivery-text-muted min-w-0 break-words">{line.text}</p>
        {line.more !== null && (
          <p data-release-more className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="delivery-text-muted">{line.more}</span>
            {line.others.map((o) => (
              <span key={o.key} data-release-other={o.pr} className="inline-flex min-w-0">
                <LinkTupleView segments={artifactTuple({ what: 'pr', label: `#${o.pr}`, href: rows[o.rowId]?.pr?.url ?? '' }, noTicket)} />
              </span>
            ))}
          </p>
        )}
        {group.unknownOwners.map((o) => (
          <p key={o.slug} data-release-group-unknown-owner={o.slug} className="delivery-text-warn">
            Sprint {o.slug} names the Owner “{o.handle}”, which People does not declare.
          </p>
        ))}
      </div>
      <div data-release-slot data-release-slot-version={line.slot.version} className="delivery-release-slot">
        <ReleaseApprove button={line.button} row={slotRow} onDone={reread} />
      </div>
    </div>
  );
};
