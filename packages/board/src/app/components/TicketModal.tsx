import { useEffect, useState } from 'react';
import type { Known, Ref } from '@plot-pm/domain/entities/card-facts';
import type { TicketLaneRow } from '../../contract/schema.js';
import { fetchDoc } from '../lib/bounded-fetch.js';
import { ticketAction, ticketLinkFor, ticketSections, type TicketControls } from './TicketItemCard.js';

export interface TicketModalProps extends TicketControls {
  ticket: TicketLaneRow;
  onClose: () => void;
}

/** What `GET /api/issue/<number>` answers: the issue, or why it could not be read. */
type IssueRead =
  | { kind: 'loading' }
  | { kind: 'read'; body: string }
  | { kind: 'failed'; message: string };

/** The words an item in the lineage list is shown by. */
const refLabel = (ref: Ref): string => {
  switch (ref.kind) {
    case 'ticket': return `#${ref.key}`;
    case 'slice': return ref.branch;
    default: return ref.title || ref.slug;
  }
};

const RELATIONS = ['plans', 'stories'] as const;

/**
 * The ticket viewer: title, the issue body through `GET /api/issue/<number>`,
 * the ticket's lineage as links, the card's action row, and a link to the issue
 * on the host. The body renders as text: no markup in it becomes an element or a link.
 */
export const TicketModal = ({ ticket, onClose, ...controls }: TicketModalProps) => {
  const [issue, setIssue] = useState<IssueRead>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setIssue({ kind: 'loading' });
    fetchDoc(`/api/issue/${encodeURIComponent(ticket.id)}`)
      .then(async (res) => {
        const answer = await res.json() as { ok?: boolean; body?: string; error?: string };
        if (!res.ok || answer.ok !== true) throw new Error(answer.error ?? `HTTP ${res.status}`);
        if (!cancelled) setIssue({ kind: 'read', body: answer.body ?? '' });
      })
      .catch((e) => {
        if (!cancelled) setIssue({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [ticket.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const linkFor = ticketLinkFor(controls);
  const sections = ticket.facts === undefined ? null : ticketSections(ticket, controls, Date.now());
  const lineage = ticket.facts === undefined ? null : ticket.facts.lineage;
  const renderAction = ticketAction(ticket, controls);
  const actions = sections === null
    ? []
    : [...(sections.footer.primary === null ? [] : [sections.footer.primary]), ...sections.footer.secondary, ...sections.footer.more];
  const known = (value: Known<readonly Ref[]> | undefined): readonly Ref[] => (value !== undefined && 'value' in value ? value.value : []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ticket: ${ticket.title || ticket.id}`}
      data-ticket-modal={ticket.id}
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
            #{ticket.id} {ticket.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
            {issue.kind === 'loading' && <p className="text-xs text-slate-500 dark:text-slate-400">Loading…</p>}
            {issue.kind === 'failed' && (
              <p data-ticket-body="failed" className="text-xs text-amber-700 dark:text-amber-400">
                The issue could not be read: {issue.message}
              </p>
            )}
            {issue.kind === 'read' && (
              <pre data-ticket-body="read" className="whitespace-pre-wrap break-words font-sans text-sm text-slate-700 dark:text-slate-200">
                {issue.body.trim() || 'The issue has no body.'}
              </pre>
            )}
          </div>

          <div data-ticket-lineage className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
            {RELATIONS.map((relation) => {
              const value = lineage?.[relation];
              return (
                <div key={relation} className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{relation}</span>
                  {value === undefined || 'unknown' in value ? (
                    <span data-lineage-unknown={relation} className="text-slate-500 dark:text-slate-400">unread</span>
                  ) : known(value).length === 0 ? (
                    <span className="text-slate-500 dark:text-slate-400">none</span>
                  ) : (
                    known(value).map((ref) => {
                      const link = linkFor(ref);
                      return link === null ? (
                        <span key={refLabel(ref)} className="text-slate-700 dark:text-slate-200">{refLabel(ref)}</span>
                      ) : (
                        <a
                          key={refLabel(ref)}
                          href={link.href}
                          {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                          onClick={(e) => {
                            if (link.onOpen === undefined || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                            e.preventDefault();
                            link.onOpen();
                          }}
                          className="text-cyan-600 hover:underline dark:text-cyan-400"
                        >
                          {refLabel(ref)}
                        </a>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>

          <div data-ticket-actions className="flex flex-wrap items-center gap-2 px-4 py-3">
            {actions.map((action) => (
              <span key={action.action} data-ticket-action={action.action} className="flex items-center gap-2 text-xs">
                {action.enabled ? (
                  renderAction(action)
                ) : (
                  <>
                    <button type="button" disabled className="cursor-not-allowed rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
                      {action.label}
                    </button>
                    <span data-action-reason className="text-slate-500 dark:text-slate-400">{action.reason}</span>
                  </>
                )}
              </span>
            ))}
            <a
              href={ticket.url}
              target="_blank"
              rel="noopener noreferrer"
              data-ticket-host-link
              className="ml-auto shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Open on host
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
