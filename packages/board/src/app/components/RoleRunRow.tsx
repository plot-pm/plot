import type { ReactNode } from 'react';
import type { RoleRun } from '@plot-pm/domain';
import { KIND_LABEL, type TupleRow } from '../lib/tuple-row.js';
import { RoleChip } from './RoleChip.js';
import { TupleRowView } from './TupleRow.js';

/**
 * The Fleet row of a reviewer, fixer, design or verify agent: one that a state
 * file shows and the registry does not hold.
 *
 * @param run - the run the server read.
 * @param label - what the agent acts on, as the placement names it.
 * @param by - the BY cell.
 */
export const RoleRunRow = ({ run, label, by }: { run: RoleRun; label: string; by?: ReactNode }) => {
  const tuple: TupleRow = {
    kind: 'agent',
    kindLabel: KIND_LABEL.agent,
    name: { what: 'ticket', label, href: '' },
    links: [],
    status: run.stopped === undefined ? 'running' : 'stopped',
    age: { text: '', label: '' },
  };
  return (
    <TupleRowView
      tuple={tuple}
      kindChip={<RoleChip role={run.role} />}
      by={by}
      statusExtra={run.stopped === undefined ? null : (
        <>
          <span data-plan-level-reason className="min-w-0 truncate text-slate-500 dark:text-slate-400">{run.stopped.reason}</span>
          <span data-plan-level-restart className="shrink-0 truncate font-mono text-xs text-slate-400 dark:text-slate-500">{run.stopped.restart}</span>
          <span data-plan-level-log className="shrink-0 truncate font-mono text-xs text-slate-400 dark:text-slate-500">{run.stopped.log}</span>
        </>
      )}
      rowAttr={{ 'data-agent-row': '', 'data-role-run': run.role }}
    />
  );
};
