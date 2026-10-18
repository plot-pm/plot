import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseSprintContent } from '../../src/server/board.js';

/**
 * `/plot-sprint` fills only `<title>` and `<sprint goal>` in the shipped
 * template, so the typed goal is the `> ` line under the title and
 * `## Sprint Goal` still holds `<expanded goal description>`. The card's goal
 * is the typed goal, never the placeholder.
 *
 * Read from the shipped template file itself, not a hand-rolled fixture
 * string: a hand-rolled fixture can drift from the real template and keep
 * passing while the real template still fails.
 */
const TEMPLATE_PATH = path.resolve(__dirname, '../../../../skills/plot/templates/sprint.md');

describe('a sprint goal read from the shipped template', () => {
  it('is the goal /plot-sprint typed into the > line', () => {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8')
      .replace('<title>', 'Fixture').replace('<sprint goal>', 'Ship the thing.');
    const card = parseSprintContent(template, '2026-W42-fixture.md');
    expect(card!.goal).toBe('Ship the thing.');
  });

  it('reads a bold headline under ## Sprint Goal when the title has no > line', () => {
    const content = '# Sprint: Fixture\n\n## Status\n\n- **State:** Planning\n\n' +
      '## Sprint Goal\n\n**Ship the thing.**\n\nMore detail below.\n';
    expect(parseSprintContent(content, '2026-W42-fixture.md')!.goal).toBe('Ship the thing.');
  });
});
