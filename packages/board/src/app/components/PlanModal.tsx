import { useEffect, useState } from 'react';
import type { Card } from '../../contract/schema.js';
import { planHref } from '../lib/plan.js';

export interface PlanModalProps {
  card: Card;
  onClose: () => void;
}

/**
 * In-board plan viewer. Fetches the server-rendered `/plan/<file>` HTML and
 * embeds it in a sandboxed iframe (fetch + embed, not iframe `src`) so the plan
 * renders in its own isolated document — no style bleed, no scripts. "Open in
 * new tab" points at the same route for the native full-page view.
 */
export function PlanModal({ card, onClose }: PlanModalProps) {
  const href = planHref(card);
  // The embedded view drops the back-to-board titlebar (that navigation only
  // makes sense on the full page). "Open in new tab" uses the plain href.
  const embedSrc = `${href}?embed=1`;
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrcDoc(null);
    setError(null);
    fetch(embedSrc)
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
      aria-label={`Plan: ${card.title}`}
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
            Plan
          </h2>
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
        <div className="min-h-0 flex-1 bg-white dark:bg-slate-950">
          {error ? (
            <p className="p-6 text-sm text-red-600 dark:text-red-400">Failed to load plan: {error}</p>
          ) : srcDoc === null ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : (
            <iframe
              title={`Plan: ${card.slug}`}
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
