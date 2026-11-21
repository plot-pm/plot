import type { TodoList as TodoListFact, TodoMarker } from '@plot-pm/domain';
import { LinkIcon } from './LinkIcon.js';

/** The hue of each marker, for its tag and its verb: blocks delivery red, input blue, clean up the body colour, waits grey. */
export const TODO_MARKER_CLASS: Record<TodoMarker, string> = {
  'blocks-delivery': 'delivery-hue-red',
  input: 'delivery-hue-blue',
  'clean-up': 'delivery-tone-neutral',
  waits: 'delivery-hue-slate',
};

/** The Delivery tab header's to-do list: every line, the header and the triage line are the domain's. */
export const TodoList = ({ todo, onJump }: { todo: TodoListFact; onJump: (anchor: string) => void }) => (
  <div data-todo-list className="delivery-card">
    <p data-todo-header>{todo.header}</p>
    {/* ONE GRID FOR EVERY LINE: chip, kind or verb, link. Each line is a subgrid row, so the second and
        third columns start at one x on every line, and the link truncates rather than wrapping the line. */}
    {todo.lines.length > 0 && (
      <ul data-todo-lines className="grid grid-cols-[max-content_max-content_minmax(0,1fr)]">
        {todo.lines.map((l) => (
          <li key={l.id} data-todo-line={l.marker} className={`col-span-3 grid grid-cols-subgrid items-baseline ${TODO_MARKER_CLASS[l.marker]}`}>
            <span data-todo-marker className="delivery-chip shrink-0 whitespace-nowrap">{l.markerWords}</span>
            <button
              type="button"
              data-todo-name
              onClick={() => onJump(l.anchor)}
              className="col-span-2 grid min-w-0 grid-cols-subgrid items-baseline text-left"
            >
              <span data-todo-verb className="whitespace-nowrap">{l.verb}</span>
              {' '}
              <span className="flex min-w-0 items-baseline">
                <LinkIcon kind={l.icon} />
                <span data-todo-label className="delivery-truncate min-w-0" title={l.reason === '' ? l.label : `${l.label} · ${l.reason}`}>{l.label}</span>
                {l.reason !== '' && <span data-todo-reason className="delivery-text-muted delivery-truncate min-w-0">{' · '}{l.reason}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )}
    <p data-todo-triage className="delivery-text-muted">
      {todo.triageText} ·{' '}
      <button type="button" data-todo-triage-link onClick={() => onJump(todo.triageAnchor)} className="delivery-text-link">
        <LinkIcon kind={todo.triageIcon} />
        triage ›
      </button>
    </p>
  </div>
);
