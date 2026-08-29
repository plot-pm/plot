import { useEffect, useState, type ReactNode } from 'react';
import { fetchDoc } from '../lib/bounded-fetch.js';

export interface DocModalProps {
  /** The static chrome label — "Plan" or "Story", never the document's title. */
  label: string;
  /** Accessible name for the dialog, e.g. `Plan: Fix the leaky hose`. */
  ariaLabel: string;
  /** The viewer route: `/plan/<file>` or `/story/<slug>`. */
  href: string;
  /** `title` on the embedded iframe — how a test names the frame. */
  frameTitle: string;
  /**
   * Switch to the board and land on this document's place in it. Absent where
   * there is nowhere to land, and the control then does not render.
   */
  onShowInBoard?: () => void;
  onClose: () => void;
  /** Rendered between the header and the embedded document, or nothing. */
  children?: ReactNode;
}

/**
 * The shell both viewers share: header, fetch-and-embed, Escape, backdrop.
 *
 * It exists so the two headers cannot drift. The plan modal and the story
 * overlay are meant to carry the SAME three controls — *Show in board*, *Open
 * in new tab*, *Close* — and a reader who has learned one should not have to
 * learn the other. Two copies of that header would agree on the day they were
 * written and disagree on the day one of them grew a fourth button; one
 * component makes "they match" a fact rather than a promise.
 *
 * What differs is the BODY, and that is the parameter: a plan has worktree
 * paths, a story has the plans it is made of. The header answers *where do I
 * go*; the body answers *what now*.
 */
export function DocModal({
  label,
  ariaLabel,
  href,
  frameTitle,
  onShowInBoard,
  onClose,
  children,
}: DocModalProps) {
  // The embedded view drops the back-to-board titlebar (that navigation only
  // makes sense on the full page). "Open in new tab" uses the plain href.
  const embedSrc = `${href}?embed=1`;
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrcDoc(null);
    setError(null);
    // Bounded: the board restarts under `node --watch`, and a request killed
    // mid-response neither resolves nor rejects. Without the bound the `.catch`
    // below is correct code that never runs, and the `Loading…` arm — which
    // means *wait* — renders for a server that will never answer.
    fetchDoc(embedSrc)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((html) => {
        if (!cancelled) setSrcDoc(html);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [embedSrc]);

  // Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="mr-auto truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {label}
          </h2>
          {/* A real <button>: it changes what this page shows, and is neither a
              destination nor something to open in a new tab. */}
          {onShowInBoard && (
            <button
              type="button"
              onClick={onShowInBoard}
              className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Show in board
            </button>
          )}
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Open in new tab
          </a>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </header>
        {/* Scrollable children area — grows to fill available space */}
        {children && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {children}
          </div>
        )}
        <div className="min-h-[30vh] shrink-0 bg-white dark:bg-slate-950">
          {error ? (
            <p className="p-6 text-sm text-red-600 dark:text-red-400">
              Failed to load {label.toLowerCase()}: {error}
            </p>
          ) : srcDoc === null ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : (
            <iframe
              title={frameTitle}
              srcDoc={srcDoc}
              // Static rendered markdown needs no scripts; sandbox disables them
              // (defense in depth) while keeping same-origin so the page styles.
              sandbox="allow-same-origin allow-popups"
              className="h-[70vh] w-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
