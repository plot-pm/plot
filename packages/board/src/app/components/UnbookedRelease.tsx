import { useState } from 'react';
import type { ReleaseUnbooked } from '@plot-pm/domain/rules/release-unbooked';
import type { LastFinish } from '@plot-pm/domain/entities/release-finish-record';
import { unbookedReleaseRow } from '@plot-pm/domain/rules/delivery-row-form';
import { finishReleaseVersion } from '../lib/release-finish.js';
import { MARKS_CELL, TUPLE_TRACKS } from './TupleRow.js';

/**
 * The You › Unblock row of a merged release that still owes its bookings.
 *
 * The row's text and the button's state come from `unbookedReleaseRow`. The
 * button always shows; it is disabled with its reason as the title. A click
 * posts `POST /api/release-finish` and shows the answer, or the refusal's
 * reason, in place under the button. The last recorded finish's refusal shows
 * as `last finish: <reason>` under the status.
 */
export const UnbookedRelease = ({
  unbooked,
  anchor,
  lastFinish = null,
}: {
  unbooked: ReleaseUnbooked;
  anchor: string;
  lastFinish?: LastFinish | null;
}) => {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const row = unbookedReleaseRow(unbooked, busy, lastFinish);

  const click = async () => {
    if (!row.action.enabled) return;
    setBusy(true);
    setMessage('');
    try {
      setMessage(await finishReleaseVersion(row.action.version));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      key={anchor}
      role="row"
      data-delivery-row=""
      data-unbooked-release={unbooked.version}
      className={`relative flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 delivery-row delivery-row-ruled sm:grid ${TUPLE_TRACKS} sm:items-baseline sm:gap-x-3`}
    >
      <span role="gridcell" className={MARKS_CELL} />
      <span role="gridcell" data-row-cell="kind" className="delivery-kind min-w-0 shrink-0 truncate">release</span>
      <span role="gridcell" data-row-cell="item" className="flex min-w-0 items-baseline gap-1.5 font-medium">{row.object}</span>
      <span role="gridcell" data-row-cell="where" className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400" data-unbooked-names="">
        {row.names ?? ''}
      </span>
      <span role="gridcell" data-row-cell="status" data-tuple-status className="flex min-w-0 items-baseline gap-2 truncate text-xs text-slate-500 dark:text-slate-400">
        {row.status}
        {row.lastFinish !== null && <span data-testid="unbooked-last-finish">{row.lastFinish}</span>}
      </span>
      <span role="gridcell" data-row-cell="by" />
      <span role="gridcell" data-row-cell="age" />
      <span role="gridcell" data-row-cell="do" className="flex min-w-0 flex-col items-end gap-1">
        <button
          type="button"
          data-you-verb={row.tone}
          disabled={!row.action.enabled}
          title={row.action.reason ?? undefined}
          onClick={click}
          data-testid="book-as-released"
        >
          {row.action.label}
        </button>
        {message && <span className="max-w-48 break-words text-right text-xs" data-testid="book-as-released-message">{message}</span>}
      </span>
    </li>
  );
};
