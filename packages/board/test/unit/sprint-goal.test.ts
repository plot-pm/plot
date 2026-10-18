import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseSprintContent } from '../../src/server/board.js';

/**
 * A sprint cut from the shipped template writes `## Sprint Goal` as plain
 * text (`<expanded goal description>`), with no bold line. Before this fix
 * `parseSprintContent` only read a `**bold**` first line there, so every
 * templated sprint served `goal: ''` until someone hand-bolded a line —
 * `2026-W42-bitbucket-jira-and-jenkins-work-with-the-board` did exactly
 * that in `4396b16af`.
 *
 * Read from the shipped template file itself, not a hand-rolled fixture
 * string: a hand-rolled fixture can drift from the real template and keep
 * passing while the real template still fails.
 */
const TEMPLATE_PATH = path.resolve(__dirname, '../../../../skills/plot/templates/sprint.md');

describe('a sprint goal read from the shipped template', () => {
  it('is non-empty with no edit to the sprint file or the template', () => {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const card = parseSprintContent(template, '2026-W42-fixture.md');
    expect(card!.goal).not.toBe('');
  });

  it('still prefers a bold headline when one is present', () => {
    const content = '# Sprint: Fixture\n\n## Status\n\n- **State:** Planning\n\n' +
      '## Sprint Goal\n\n**Ship the thing.**\n\nMore detail below.\n';
    expect(parseSprintContent(content, '2026-W42-fixture.md')!.goal).toBe('Ship the thing.');
  });
});
