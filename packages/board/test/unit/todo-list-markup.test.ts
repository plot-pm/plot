import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TodoList as TodoListFact } from '@plot-pm/domain';
import { TodoList, TODO_MARKER_CLASS } from '../../src/app/components/TodoList.js';

const todo = (over: Partial<TodoListFact>): TodoListFact => ({
  lines: [],
  counts: { 'blocks-delivery': 0, input: 0, 'clean-up': 0 },
  header: 'You block nothing',
  tickets: 0,
  triageText: '0 tickets assigned to you have no plan',
  triageAnchor: 'tickets',
  ...over,
});

const render = (fact: TodoListFact): string => renderToStaticMarkup(createElement(TodoList, { todo: fact, onJump: () => {} }));

/** The text of a markup string, tags removed. */
const text = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('the to-do list markup', () => {
  it('renders the header and the triage line and no empty list where no line exists', () => {
    const html = render(todo({}));
    expect(html).toContain('<p data-todo-header="true">You block nothing</p>');
    expect(html).toMatch(/<p data-todo-triage="true"[^>]*>0 tickets assigned to you have no plan · <button[^>]*data-todo-triage-link/);
    expect(html).not.toContain('<ul');
  });

  it('renders the verb and the label apart, keeps the line text, and marks the line with its hue class', () => {
    const html = render(todo({
      lines: [{ id: 'a', text: 'Approve my-plan', verb: 'Approve', label: 'my-plan', marker: 'blocks-delivery', markerWords: 'blocks delivery', anchor: 'x' }],
      counts: { 'blocks-delivery': 1, input: 0, 'clean-up': 0 },
    }));
    expect(html).toMatch(/<li data-todo-line="blocks-delivery" class="[^"]*\bdelivery-hue-red\b/);
    const name = /<button[^>]*data-todo-name[^>]*>(.*?)<\/button>/.exec(html)![1];
    expect(text(name)).toBe('Approve my-plan');
    expect(name).toMatch(/<span data-todo-verb="true"[^>]*>Approve<\/span>/);
    expect(name).toMatch(/<span data-todo-label="true"[^>]*title="my-plan"[^>]*>my-plan<\/span>/);
    expect(html).toMatch(/<span data-todo-marker="true"[^>]*>blocks delivery<\/span>/);
  });

  it('maps every marker to a hue class and draws no Tailwind colour utility', () => {
    expect(TODO_MARKER_CLASS).toEqual({ 'blocks-delivery': 'delivery-hue-red', input: 'delivery-hue-blue', 'clean-up': 'delivery-tone-neutral' });
    const html = render(todo({
      lines: [{ id: 'b', text: 'Interrogate p', verb: 'Interrogate', label: 'p', marker: 'input', markerWords: 'input', anchor: 'y' }],
    }));
    expect(html).not.toMatch(/dark:|slate-|blue-\d|red-\d/);
  });
});
