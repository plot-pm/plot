import { describe, it, expect } from 'vitest';
import { parsePersonDirectory, sprintIsMine, type Reader } from '../src/index.js';
import { sprintRecordOf } from '../src/rules/sprint-record.js';

const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const sprintFile = (owner: string): string =>
  `# Sprint: S\n\n## Status\n\n- **State:** Active\n- **Start:** 2026-11-16\n- **End:** 2026-11-20\n${owner}\n\n## Sprint Goal\n\nx\n`;

describe('sprintRecordOf ownerHandle', () => {
  it('reads the Owner line', () => {
    const r = sprintRecordOf(sprintFile('- **Owner:** jwloka'), '2026-W47-s.md');
    expect(r?.ownerHandle).toBe('jwloka');
    expect(r?.end).toBe('2026-11-20');
  });
  it('parses a file with no Owner line as ownerHandle "" without refusing it', () => {
    const r = sprintRecordOf(sprintFile(''), '2026-W47-s.md');
    expect(r).not.toBeNull();
    expect(r?.ownerHandle).toBe('');
  });
});

describe('sprintIsMine', () => {
  it('is true where the reader login is the Owner handle', () => {
    expect(sprintIsMine('jwloka', { hostUser: 'jwloka', directory })).toBe(true);
  });
  it('is true where the reader login is an alias declared for the Owner', () => {
    const d = parsePersonDirectory('jwloka = Jan Wloka, janw');
    expect(sprintIsMine('jwloka', { hostUser: 'janw', directory: d })).toBe(true);
  });
  it('is false for another person', () => {
    expect(sprintIsMine('eins78', { hostUser: 'jwloka', directory })).toBe(false);
  });
  it('is false for a reader with no identity against an empty Owner', () => {
    expect(sprintIsMine('', { directory })).toBe(false);
    expect(sprintIsMine('', { hostUser: '', gitEmail: '', directory })).toBe(false);
  });
  it('is false for a reader known only by email', () => {
    const r: Reader = { gitEmail: 'jan.wloka@quatico.com', directory };
    expect(sprintIsMine('jwloka', r)).toBe(false);
  });
  it('is false where the directory does not declare the Owner', () => {
    expect(sprintIsMine('stranger', { hostUser: 'stranger', directory })).toBe(false);
    expect(sprintIsMine('jwloka', { hostUser: 'jwloka' })).toBe(false);
  });
});
