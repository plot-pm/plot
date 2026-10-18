import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sprintGoal } from '../src/index.js';

/**
 * The goal a sprint file states. A hand-written sprint states it as the bold
 * line under `## Sprint Goal` and often uses the `> ` block under the title for
 * motivation. `/plot-sprint` fills only `<title>` and `<sprint goal>` in the
 * shipped template (`skills/plot-sprint/SKILL.md`, step 5), so there the typed
 * goal is the `> ` line and `## Sprint Goal` keeps `<expanded goal description>`.
 */
const TEMPLATE = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/plot/templates/sprint.md'), 'utf8');

const filled = (goal: string, expanded?: string): string => {
  const titled = TEMPLATE.replace('<title>', 'Fixture').replace('<sprint goal>', goal);
  return expanded === undefined ? titled : titled.replace('<expanded goal description>', expanded);
};

/** The W39 shape: a motivation paragraph in `>`, the goal in bold under `## Sprint Goal`. */
const MOTIVATION_AND_BOLD = [
  '# Sprint: The Jenkins team sees its builds', '',
  '> 2.15.0 shipped for a team on Bitbucket, Jenkins and Jira. Two of its slices',
  '> merged carrying no work: PR #811, **zero files**.', '',
  '## Status', '', '- **State:** Active', '',
  '## Sprint Goal', '',
  '**A teammate on Bitbucket and Jenkins clones a repository, runs `/plot-init`, and',
  'sees real build status on the board.**', '',
  'Two halves. **Connected** means the state reaches the domain.', '',
  '### Must Have', '', '- [ ] [a-plan] the plan',
].join('\n');

describe('the goal of a sprint file', () => {
  it('is the bold line under ## Sprint Goal when the > block is motivation', () => {
    expect(sprintGoal(MOTIVATION_AND_BOLD)).toBe(
      'A teammate on Bitbucket and Jenkins clones a repository, runs /plot-init, and sees real build status on the board.');
  });

  it('is the typed goal in the shipped template filled from a one-line /plot-sprint', () => {
    expect(sprintGoal(filled('The board shows the typed goal.'))).toBe('The board shows the typed goal.');
  });

  it('is the > line in a multi-line /plot-sprint, not the context lines under ## Sprint Goal', () => {
    const content = filled('Ship the connector.', 'Motivation: teams on Jira.\nScope: the inbox only.');
    expect(sprintGoal(content)).toBe('Ship the connector.');
  });

  it('is the > line when the file has nothing else', () => {
    expect(sprintGoal('# Sprint: X\n\n> The goal.')).toBe('The goal.');
  });

  it('is empty for the unfilled template, which holds only placeholders', () => {
    expect(sprintGoal(TEMPLATE)).toBe('');
  });

  it('skips a bold placeholder and reads the > line', () => {
    expect(sprintGoal('# Sprint: X\n\n> The goal.\n\n## Sprint Goal\n\n**<goal>**\n')).toBe('The goal.');
  });

  it('reads only the first paragraph of a > block split by a bare > line', () => {
    const content = '# Sprint: X\n\n> The goal.\n>\n> Why it matters.\n\n## Status\n';
    expect(sprintGoal(content)).toBe('The goal.');
  });

  it('joins a > goal wrapped over several lines and strips its inline markdown', () => {
    const content = '# Sprint: X\n\n> Every row is **true**, and a *glance*\n> reads `state` from [the board](https://x).\n\n## Status\n';
    expect(sprintGoal(content)).toBe('Every row is true, and a glance reads state from the board.');
  });

  it('reads the first prose paragraph when there is neither bold nor > line', () => {
    const content = '# Sprint: X\n\n## Sprint Goal\n\nFive bugs shared one shape: **a measurement that was\nnever re-read**.\n';
    expect(sprintGoal(content)).toBe('Five bugs shared one shape: a measurement that was never re-read.');
  });

  it('reads ## Sprint Goal when the file has no title at all', () => {
    expect(sprintGoal('## Sprint Goal\n\nShip it.\n')).toBe('Ship it.');
  });

  it('reads ## Sprint Goal when the title is the last line', () => {
    expect(sprintGoal('## Sprint Goal\n\nShip it.\n\n# Sprint: X')).toBe('Ship it.');
  });

  it('skips comments, lists and quotes, and stops at a ### heading', () => {
    const content = [
      '# Sprint: X', '', '## Status', '', '## Sprint Goal', '',
      '<!-- a note', 'over two lines -->', '', '- [ ] **not a goal**', '', '> not a goal either', '',
      'The goal.', '', '### Must Have', '', '**Not the goal.**',
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

  it('reads CRLF line endings', () => {
    expect(sprintGoal('# Sprint: X\r\n\r\n> The goal.\r\n\r\n## Status\r\n')).toBe('The goal.');
  });
});
