import { describe, it, expect } from 'vitest';
import {
  activeSprintOf,
  recordOpenedTicket,
  ticketMarkOf,
  ticketRecordLine,
  ticketRecordOf,
} from '../src/rules/sprint-ticket-record.js';

const SPRINT = [
  '# Sprint', '', '- **State:** Active', '', '### Must Have', '', '- [ ] [plan-a] A', '',
  '### Deferred', '', '- [ ] [plan-d] D', '',
  '## Notes', '', '### Scope Changes', '- 2026-11-08: Added [plan-a] to Must', '',
  '### Interventions', '', '- 2026-11-09: something', '',
].join('\n');

describe('recordOpenedTicket', () => {
  it('writes the line under a new Opened tickets subsection of ## Notes', () => {
    const { content, outcome } = recordOpenedTicket(SPRINT, '2026-11-10', '3301', 'feature/x');
    expect(outcome).toBe('updated');
    expect(content).toContain('### Opened tickets\n\n- 2026-11-10: Opened ticket #3301 from slice feature/x');
    expect(content.indexOf('### Opened tickets')).toBeGreaterThan(content.indexOf('## Notes'));
  });

  it('writing the same ticket and slice twice leaves one line', () => {
    const first = recordOpenedTicket(SPRINT, '2026-11-10', '3301', 'feature/x');
    const second = recordOpenedTicket(first.content, '2026-11-11', '#3301', 'feature/x');
    expect(second.outcome).toBe('already');
    expect(second.content).toBe(first.content);
    expect(second.content.match(/Opened ticket #3301/g)).toHaveLength(1);
  });

  it('appends a second ticket below the first inside the same subsection', () => {
    const first = recordOpenedTicket(SPRINT, '2026-11-10', '3301', 'feature/x');
    const second = recordOpenedTicket(first.content, '2026-11-10', 'QKP-123', 'feature/y');
    expect(second.outcome).toBe('updated');
    expect(second.content.match(/### Opened tickets/g)).toHaveLength(1);
    expect(ticketRecordOf(second.content, '3301').kind).toBe('opened-by-sprint');
    expect(ticketRecordOf(second.content, 'QKP-123').kind).toBe('opened-by-sprint');
  });

  it('answers no-notes where the file has no ## Notes', () => {
    const bare = '# Sprint\n\n- **State:** Active\n';
    expect(recordOpenedTicket(bare, '2026-11-10', '1', 'b')).toEqual({ content: bare, outcome: 'no-notes' });
  });

  it('keeps a section that follows ## Notes intact', () => {
    const withNext = `${SPRINT}## Later\n\ntext\n`;
    const { content } = recordOpenedTicket(withNext, '2026-11-10', '5', 'b');
    expect(content).toContain('## Later\n\ntext\n');
    expect(content.indexOf('Opened ticket #5')).toBeLessThan(content.indexOf('## Later'));
  });
});

describe('ticketRecordOf', () => {
  it('reads back the ticket and slice the writer produced', () => {
    const { content } = recordOpenedTicket(SPRINT, '2026-11-10', '3301', 'feature/x');
    expect(ticketRecordOf(content, '3301')).toEqual({ kind: 'opened-by-sprint', date: '2026-11-10', slice: 'feature/x' });
    expect(ticketRecordOf(content, '#3301')).toEqual({ kind: 'opened-by-sprint', date: '2026-11-10', slice: 'feature/x' });
  });

  it('reads the line ticketRecordLine returns', () => {
    const content = `## Notes\n\n### Opened tickets\n\n${ticketRecordLine('2026-11-10', 'QKP-9', 'bug/z')}\n`;
    expect(ticketRecordOf(content, 'QKP-9')).toEqual({ kind: 'opened-by-sprint', date: '2026-11-10', slice: 'bug/z' });
  });

  it('counts only the Notes record when the identifier also sits under Scope Changes and Deferred', () => {
    const line = ticketRecordLine('2026-11-10', '3301', 'feature/x');
    const content = [
      '- **State:** Active', '', '### Deferred', '', line, '',
      '## Notes', '', '### Scope Changes', '', line, '',
      '### Opened tickets', '', line, '',
    ].join('\n');
    expect(ticketRecordOf(content, '3301')).toEqual({ kind: 'opened-by-sprint', date: '2026-11-10', slice: 'feature/x' });
    const withoutOpened = content.split('\n').slice(0, -4).join('\n');
    expect(ticketRecordOf(withoutOpened, '3301')).toEqual({ kind: 'no-record' });
  });

  it('does not read a record outside ## Notes', () => {
    const line = ticketRecordLine('2026-11-10', '3301', 'feature/x');
    const content = `## Scope\n\n### Opened tickets\n\n${line}\n\n## Notes\n\ntext\n`;
    expect(ticketRecordOf(content, '3301')).toEqual({ kind: 'no-record' });
  });

  it('does not match #33 against #330', () => {
    const { content } = recordOpenedTicket(SPRINT, '2026-11-10', '330', 'feature/x');
    expect(ticketRecordOf(content, '33')).toEqual({ kind: 'no-record' });
    expect(ticketRecordOf(content, '330').kind).toBe('opened-by-sprint');
  });
});

describe('ticketMarkOf', () => {
  it('shows the mark for a record and nothing for no record', () => {
    expect(ticketMarkOf({ kind: 'opened-by-sprint', slice: 'b', date: '2026-11-10' })).toBe('opened by sprint');
    expect(ticketMarkOf({ kind: 'no-record' })).toBeNull();
  });
});

describe('activeSprintOf', () => {
  const sprint = (file: string, state: string, member: string): { file: string; content: string } => ({
    file,
    content: `- **State:** ${state}\n- **Start:** 2026-11-01\n\n### Must Have\n\n${member}\n\n### Deferred\n\n`,
  });

  it('finds the one active sprint that lists the plan', () => {
    const files = [sprint('a.md', 'Active', '- [ ] [p] P'), sprint('b.md', 'Closed', '- [ ] [p] P')];
    expect(activeSprintOf('p', files)).toEqual({ outcome: 'sprint', file: 'a.md' });
  });

  it('answers none where no active sprint holds the plan', () => {
    expect(activeSprintOf('p', [sprint('a.md', 'Active', '- [ ] [q] Q')])).toEqual({ outcome: 'none' });
    expect(activeSprintOf('p', [sprint('a.md', 'Closed', '- [ ] [p] P')])).toEqual({ outcome: 'none' });
  });

  it('answers none for a slug that only sits under Deferred', () => {
    const deferred = { file: 'a.md', content: '- **State:** Active\n\n### Deferred\n\n- [ ] [p] P\n' };
    expect(activeSprintOf('p', [deferred])).toEqual({ outcome: 'none' });
  });

  it('names both files where two active sprints hold the plan', () => {
    const files = [sprint('a.md', 'Active', '- [ ] [p] P'), sprint('b.md', 'Active', '- [ ] [p] P')];
    expect(activeSprintOf('p', files)).toEqual({ outcome: 'ambiguous', files: ['a.md', 'b.md'] });
  });
});
