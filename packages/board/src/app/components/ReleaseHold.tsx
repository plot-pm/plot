import { useState } from 'react';
import type { ReleaseHoldView } from '@plot-pm/domain/entities/release-hold-person';
import { releaseHoldButton, releaseLiftButton, type HoldButton } from '@plot-pm/domain/rules/release-hold-person';
import { releaseHoldMessage, type ReleaseHoldResult } from '@plot-pm/domain/workflows/release-hold';
import { post } from '../lib/passkey-client.js';

const send = async (route: string, sha: string): Promise<string> => {
  const answer = await post(route, { sha });
  const body = answer.body as Partial<ReleaseHoldResult>;
  return releaseHoldMessage(typeof body.ok === 'boolean' ? (body as ReleaseHoldResult) : null);
};

/**
 * The Release group's "Hold merges, I am approving now" and "Lift the hold" buttons.
 *
 * Both always show. Each state and reason comes from `releaseHoldButton` and
 * `releaseLiftButton`; the reason is the button's title. The hold posts the
 * release row's head, the lift the hold's own head, and the server re-reads both.
 */
export const ReleaseHold = ({ view, origin }: { view: ReleaseHoldView | null; origin: string }) => {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const hold = releaseHoldButton(origin, view);
  const lift = releaseLiftButton(view?.hold ?? null);

  const click = async (button: HoldButton, route: string, sha: string | null) => {
    if (busy || button.state !== 'enabled' || sha === null) return;
    setBusy(true);
    setMessage('');
    try {
      setMessage(await send(route, sha));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex min-w-0 flex-col items-end gap-1" data-testid="release-hold">
      <button
        type="button"
        data-testid="release-hold-button"
        disabled={hold.state === 'disabled' || busy}
        title={hold.reason || undefined}
        onClick={() => void click(hold, '/api/release-hold', view?.head ?? null)}
        className="delivery-approve"
      >
        Hold merges, I am approving now
      </button>
      <button
        type="button"
        data-testid="release-hold-lift"
        disabled={lift.state === 'disabled' || busy}
        title={lift.reason || undefined}
        onClick={() => void click(lift, '/api/release-hold-lift', view?.hold.holds === true ? view.hold.head : null)}
        className="delivery-approve"
      >
        Lift the hold
      </button>
      {message && <span className="max-w-48 break-words text-right text-xs" data-testid="release-hold-message">{message}</span>}
    </span>
  );
};
