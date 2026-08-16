import type { ServerInfo } from '../../contract/schema.js';

/**
 * The board's posture when its server has been silent for a sustained stretch.
 *
 * `board-tells-the-truth` made the page stop LYING — a banner, `(frozen)` in
 * the footer, stopped clocks. This makes it stop INVITING. The banner says
 * *these numbers are old*; what was missing is *do not operate this right now*,
 * and a page whose rows keep full contrast and whose menus keep offering
 * `Start work` is a control surface behaving exactly as it does when
 * everything is fine.
 *
 * Two escalating states, and the escalation is the point: the banner alone for
 * a short silence, this only after a sustained one. `pnpm board` runs under
 * `node --watch`, so an ordinary edit restarts the server and the tab loses
 * contact several times an hour — dimming for that would be a strobe, and it
 * would teach the reader to ignore the dimming.
 *
 * DEGRADE, DO NOT HIDE. The last payload stays on screen because it remains
 * the best information available: a reader mid-triage still wants to see which
 * branch was where, even knowing the figures are minutes old. So this reduces
 * contrast and it does not obscure — reading needs no clicks, so reading never
 * stops.
 */

export interface UnreachableOverlayProps {
  /** Consecutive failed polls — what the message counts. */
  failures: number;
  /**
   * How to start the server again and where it listened, as the server itself
   * reported on the last successful poll. Absent before any poll has ever
   * landed — and the overlay cannot be reached in that state, because there is
   * no silence to measure from an answer that never came.
   */
  server?: ServerInfo;
}

/**
 * The reason a blocked control carries, so a disabled button never reads as a
 * bug. Exported because the controls that wear it live elsewhere: one sentence,
 * one place, or the wording drifts across three components.
 */
export const BLOCKED_REASON =
  'the board server is not answering — this would post to a server that is not there';

/**
 * The overlay proper: a dimming layer over the board, and a readable card.
 *
 * `aria-live="assertive"` rather than `polite`, and it is a considered choice:
 * a visual dim tells a screen reader nothing at all, and the statement is that
 * the controls the reader is about to use have stopped working. That is worth
 * interrupting for — it is the same class of message as a form refusing a
 * submission, not a status line.
 *
 * The dimming layer carries `aria-hidden`: it is a scrim, and announcing an
 * empty box beside the message would be noise.
 */
export function UnreachableOverlay({ failures, server }: UnreachableOverlayProps) {
  const command = server?.restartCommand ?? '';
  const port = server?.port ?? 0;

  return (
    <>
      {/*
        The scrim. `pointer-events-auto` on a fixed layer is what BLOCKS the
        board underneath — clicking cards, filters, columns, actions — while
        leaving every one of them visible and legible through it. That is the
        surface whose data is stale, and it is the surface an overlay is for.

        Blocking by intercepting clicks rather than by disabling each control
        one at a time is deliberate: a per-control list is a rule someone has to
        remember for every control added later, and a control added later is
        exactly the one that would keep inviting.

        It does NOT stop reading. Text selection stays on (`select-text` on the
        card, and the scrim intercepts pointer events without preventing
        selection of what is beneath it in the normal case of scroll and drag),
        and scrolling the page continues to work because the scrim is fixed
        rather than a scroll container of its own.
      */}
      <div
        data-unreachable-scrim
        aria-hidden="true"
        className="pointer-events-auto fixed inset-0 z-40 bg-slate-100/70 backdrop-grayscale dark:bg-slate-950/70"
      />
      <div
        data-unreachable-overlay
        role="alert"
        aria-live="assertive"
        // Centred on the viewport rather than the document: the reader may be
        // scrolled anywhere in a long board, and a message pinned to the top of
        // the page would be off screen exactly when it matters.
        className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-4 pt-24"
      >
        {/*
          `pointer-events-auto` back on for the card ALONE. The overlay's own
          message, its command and its selectable text are the one thing on
          screen that still works, and blocking them would be a dead end with a
          lock on it.
        */}
        <div className="pointer-events-auto max-w-lg select-text rounded-lg border border-rose-300 bg-white px-5 py-4 shadow-lg dark:border-rose-800 dark:bg-slate-900">
          <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">
            No contact with the board server for {failures} polls
          </p>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
            Everything below is the last thing the server said. It is still
            readable, and it is no longer being checked — so the board's own
            controls are switched off until it answers again.
          </p>
          {/*
            The way out, in the project's own words. Named because this board is
            left running for hours and reloaded rarely: whoever finds it frozen
            at midday may not remember how it was started, and a message that
            only describes the problem is a dead end. It is also the one moment
            the page has the reader's full attention.

            Rendered only when the SERVER said one. An empty command means the
            project declared none, and a guess would be advice that does not
            work handed out by the message whose whole purpose is to work.
          */}
          {command && (
            <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
              Start it again with{' '}
              <code
                data-restart-command
                className="select-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900 dark:bg-slate-800 dark:text-slate-100"
              >
                {command}
              </code>
            </p>
          )}
          {/*
            The port this page was SERVED FROM — not one probed for.

            If the server comes back somewhere else the overlay correctly stays
            up: a page can only ask its own origin, so a board on another port
            is genuinely unreachable from here. Naming the port lets the reader
            see that for themselves rather than wondering why a running board
            still reads as gone. Probing other ports was rejected outright — a
            page that guesses could attach itself to a different project's board.
          */}
          {port > 0 && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              This page is served from{' '}
              <span data-served-port className="font-mono">
                localhost:{port}
              </span>
              . A board that comes back on a different port will not reach this
              tab — reload from its own address.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
