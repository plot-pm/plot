import type { TodoList as TodoListFact, YouMarker } from '@plot-pm/domain';

/** The hue of each marker, for its tag and its verb: blocks delivery red, input blue, clean up the body colour. */
export const TODO_MARKER_CLASS: Record<YouMarker, string> = {
  'blocks-delivery': 'delivery-hue-red',
  input: 'delivery-hue-blue',
  'clean-up': 'delivery-tone-neutral',
};

/** The Delivery tab header's to-do list: every line, the header and the triage line are the domain's. */
export const TodoList = ({ todo, onJump }: { todo: TodoListFact; onJump: (anchor: string) => void }) => (
  <div data-todo-list className="delivery-card">
    <p data-todo-header>{todo.header}</p>
    {todo.lines.length > 0 && (
      <ul>
        {todo.lines.map((l) => (
          <li key={l.id} data-todo-line={l.marker} className={`flex min-w-0 items-baseline ${TODO_MARKER_CLASS[l.marker]}`}>
            <span data-todo-marker className="delivery-chip shrink-0">{l.markerWords}</span>
            <button
              type="button"
              data-todo-name
              onClick={() => onJump(l.anchor)}
              className="flex min-w-0 items-baseline text-left"
            >
              <span data-todo-verb className="shrink-0">{l.verb}</span>
              {' '}
              <span data-todo-label className="delivery-truncate" title={l.label}>{l.label}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
    <p data-todo-triage className="delivery-text-muted">
      {todo.triageText} ·{' '}
      <button type="button" data-todo-triage-link onClick={() => onJump(todo.triageAnchor)} className="delivery-text-link">
        triage ›
      </button>
    </p>
  </div>
);
