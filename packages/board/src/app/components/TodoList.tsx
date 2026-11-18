import type { TodoList as TodoListFact } from '@plot-pm/domain';

/** The Delivery tab header's to-do list: every line, the header and the triage line are the domain's. */
export function TodoList({ todo, onJump }: { todo: TodoListFact; onJump: (anchor: string) => void }) {
  return (
    <div data-todo-list className="space-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/40">
      <p data-todo-header className="font-semibold text-slate-800 dark:text-slate-100">{todo.header}</p>
      {todo.lines.length > 0 && (
        <ul className="space-y-0.5">
          {todo.lines.map((l) => (
            <li key={l.id} data-todo-line={l.marker} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <button
                type="button"
                data-todo-name
                onClick={() => onJump(l.anchor)}
                className="min-w-0 break-words text-left text-blue-600 hover:underline dark:text-blue-400"
              >
                {l.text}
              </button>
              <span data-todo-marker className="text-xs text-slate-500 dark:text-slate-400">{l.markerWords}</span>
            </li>
          ))}
        </ul>
      )}
      <p data-todo-triage className="text-xs text-slate-500 dark:text-slate-400">
        {todo.triageText} ·{' '}
        <button type="button" data-todo-triage-link onClick={() => onJump(todo.triageAnchor)} className="text-blue-600 hover:underline dark:text-blue-400">
          triage ›
        </button>
      </p>
    </div>
  );
}
