import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sprintGoal } from '../src/index.js';

/**
 * The goal a sprint file states. `/plot-sprint` fills only `<title>` and
 * `<sprint goal>` in the shipped template (`skills/plot-sprint/SKILL.md`, step
 * 5), so the `> ` line under the title holds the typed goal and `## Sprint Goal`
 * keeps `<expanded goal description>`.
 */
const REPO = path.resolve(__dirname, '../../..');
const TEMPLATE = fs.readFileSync(path.join(REPO, 'skills/plot/templates/sprint.md'), 'utf8');

const filled = (goal: string, expanded?: string): string => {
  const titled = TEMPLATE.replace('<title>', 'Fixture').replace('<sprint goal>', goal);
  return expanded === undefined ? titled : titled.replace('<expanded goal description>', expanded);
};

describe('the goal of a sprint file', () => {
  it('is the typed goal in the shipped template filled from a one-line /plot-sprint', () => {
    expect(sprintGoal(filled('The board shows the typed goal.'))).toBe('The board shows the typed goal.');
  });

  it('is the > line in a multi-line /plot-sprint, not the context lines under ## Sprint Goal', () => {
    const content = filled('Ship the connector.', 'Motivation: teams on Jira.\nScope: the inbox only.');
    expect(sprintGoal(content)).toBe('Ship the connector.');
  });

  it('is the bold goal line of the live W42 sprint as the operator wrote it', () => {
    const live = fs.readFileSync(
      path.join(REPO, 'docs/sprints/2026-W42-bitbucket-jira-and-jenkins-work-with-the-board.md'), 'utf8');
    expect(sprintGoal(live)).toBe(
      'A project hosted on Bitbucket, tracked in Jira and built on Jenkins works with the board as well as a GitHub project does.');
  });

  it('is empty for the unfilled template, which holds only placeholders', () => {
    expect(sprintGoal(TEMPLATE)).toBe('');
  });

  it('joins a > goal wrapped over several lines and strips its inline markdown', () => {
    const content = '# Sprint: X\n\n> Every row is **true**, and a *glance*\n> reads `state` from [the board](https://x).\n\n## Status\n';
    expect(sprintGoal(content)).toBe('Every row is true, and a glance reads state from the board.');
  });

  it('reads ## Sprint Goal when the title has no > line', () => {
    const content = '# Sprint: X\n\n## Sprint Goal\n\n**The Jenkins team sees its builds.**\n\nMore detail.\n';
    expect(sprintGoal(content)).toBe('The Jenkins team sees its builds.');
  });

  it('reads ## Sprint Goal when the file has no title at all', () => {
    expect(sprintGoal('## Sprint Goal\n\nShip it.\n')).toBe('Ship it.');
  });

  it('reads ## Sprint Goal when the title is the last line', () => {
    expect(sprintGoal('## Sprint Goal\n\nShip it.\n\n# Sprint: X')).toBe('Ship it.');
  });

  it('joins a wrapped bold goal rather than returning half a sentence', () => {
    const content = '# Sprint: X\n\n## Sprint Goal\n\nFive bugs shared one shape: **a measurement that was\nnever re-read**.\n';
    expect(sprintGoal(content)).toBe('Five bugs shared one shape: a measurement that was never re-read.');
  });

  it('skips comments, lists and quotes, and stops at a ### heading', () => {
    const content = [
      '# Sprint: X', '', '## Status', '', '## Sprint Goal', '',
      '<!-- a note', 'over two lines -->', '', '- [ ] not a goal', '', '> not a goal either', '',
      'The goal.', '', '### Must Have', '', 'Not the goal.',
    ].join('\n');
    expect(sprintGoal(content)).toBe('The goal.');
  });

  it('is empty when ## Sprint Goal runs straight into a heading', () => {
    expect(sprintGoal('# Sprint: X\n\n## Sprint Goal\n\n### Must Have\n\n- [ ] item\n')).toBe('');
  });

  it('is empty when the section holds only an unclosed comment', () => {
    expect(sprintGoal('## Sprint Goal\n\n<!-- never closed\nstill comment')).toBe('');
  });

  it('is empty when the file has no goal anywhere', () => {
    expect(sprintGoal('# Sprint: X\n\n## Status\n\n- **State:** Active\n')).toBe('');
  });

  it('reads a > goal that ends the file', () => {
    expect(sprintGoal('# Sprint: X\n\n> The goal.')).toBe('The goal.');
  });

  it('reads CRLF line endings', () => {
    expect(sprintGoal('# Sprint: X\r\n\r\n> The goal.\r\n\r\n## Status\r\n')).toBe('The goal.');
  });
});
