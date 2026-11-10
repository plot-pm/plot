import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import { foldVerification } from '@plot-pm/domain/rules/verification';
import { ticketRecordOf } from '@plot-pm/domain/rules/sprint-ticket-record';
import type { PlanStore } from '@plot-pm/domain';
import { openRefutedIssues } from '../../src/server/entry/verify.js';
import { writeTicketRecords } from '../../src/server/entry/sprint-ticket-write.js';

const sprintText = (state: string, member: string): string =>
  `- **State:** ${state}\n\n### Must Have\n\n${member}\n\n## Notes\n\n### Scope Changes\n\n- 2026-11-08: x\n`;

/** An in-memory store of `files`; `failWrite` makes every write refuse. */
const storeOf = (files: Record<string, string>, failWrite = false): { store: PlanStore; files: Record<string, string>; writes: string[] } => {
  const writes: string[] = [];
  const store = {
    listDir: async (dir: string) => ({ ok: true, value: Object.keys(files).filter((f) => path.dirname(f) === dir.replace(/\/$/, '')).map((f) => path.basename(f)) }),
    readText: async (file: string) => ({ ok: true, value: files[file] ?? null }),
    writeText: async (file: string, text: string) => {
      writes.push(file);
      if (failWrite) return { ok: false };
      files[file] = text;
      return { ok: true };
    },
  } as unknown as PlanStore;
  return { store, files, writes };
};

describe('a sprint records the ticket its work opened', () => {
  it('writes one record into the one active sprint and reads it back', async () => {
    const { store, files } = storeOf({ '/r/docs/sprints/a.md': sprintText('Active', '- [ ] [p] P') });
    const report = await writeTicketRecords(store, '/r', 'docs/sprints/', 'p', 'feature/x', ['3301'], '2026-11-10');
    expect(report).toEqual({ file: 'docs/sprints/a.md', notes: [] });
    expect(ticketRecordOf(files['/r/docs/sprints/a.md']!, '3301')).toEqual({ kind: 'opened-by-sprint', date: '2026-11-10', slice: 'feature/x' });
  });

  it('writing the same record twice leaves one line and the second write touches nothing', async () => {
    const { store, files, writes } = storeOf({ '/r/docs/sprints/a.md': sprintText('Active', '- [ ] [p] P') });
    await writeTicketRecords(store, '/r', 'docs/sprints/', 'p', 'feature/x', ['3301'], '2026-11-10');
    const second = await writeTicketRecords(store, '/r', 'docs/sprints/', 'p', 'feature/x', ['3301'], '2026-11-11');
    expect(second.file).toBe('');
    expect(writes).toHaveLength(1);
    expect(files['/r/docs/sprints/a.md']!.match(/Opened ticket #3301/g)).toHaveLength(1);
  });

  it('writes nothing and says why where no active sprint holds the plan', async () => {
    const { store, writes } = storeOf({ '/r/docs/sprints/a.md': sprintText('Closed', '- [ ] [p] P') });
    const report = await writeTicketRecords(store, '/r', 'docs/sprints/', 'p', 'feature/x', ['3301'], '2026-11-10');
    expect(writes).toEqual([]);
    expect(report.notes[0]).toContain("no active sprint lists 'p'");
  });

  it('writes to neither sprint and names both where two active sprints hold the plan', async () => {
    const { store, writes } = storeOf({
      '/r/docs/sprints/a.md': sprintText('Active', '- [ ] [p] P'),
      '/r/docs/sprints/b.md': sprintText('Active', '- [ ] [p] P'),
    });
    const report = await writeTicketRecords(store, '/r', 'docs/sprints/', 'p', 'feature/x', ['3301'], '2026-11-10');
    expect(writes).toEqual([]);
    expect(report.notes[0]).toContain('docs/sprints/a.md and docs/sprints/b.md');
  });

  it('reports a failed write with the ticket and throws nothing', async () => {
    const { store } = storeOf({ '/r/docs/sprints/a.md': sprintText('Active', '- [ ] [p] P') }, true);
    const report = await writeTicketRecords(store, '/r', 'docs/sprints/', 'p', 'feature/x', ['3301'], '2026-11-10');
    expect(report.file).toBe('');
    expect(report.notes[0]).toContain('3301: could not write');
  });
});

describe('the opener of a ticket', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('hands each new identifier over once, and a retry opens no second ticket', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'plot-sprint-record-'));
    roots.push(root);
    const stateFile = path.join(root, 'verify', 'p.json');
    const fold = foldVerification(['one'], [{ lens: 'a', text: 'Claim-1: refuted\n' }]);
    if (fold.fold !== 'record') throw new Error('expected a record');
    const opened: unknown[] = [];
    const tracker = trackerFixture({ scheme: 'jira', opened: opened as never });
    const ids: string[] = [];
    await openRefutedIssues(tracker, stateFile, 'p', 'abc1234', fold.verdicts, [], undefined, (id) => ids.push(id));
    await openRefutedIssues(tracker, stateFile, 'p', 'abc1234', fold.verdicts, [], undefined, (id) => ids.push(id));
    expect(opened).toHaveLength(1);
    expect(ids).toHaveLength(1);
    expect(Object.keys(JSON.parse(readFileSync(stateFile, 'utf8')))).toEqual(['issues']);
  });
});

describe('the ticket mark', () => {
  it('shows for a recorded ticket and stays absent for a ticket with no record', async () => {
    const { ticketMarkFor } = await import('../../src/app/lib/agent-rows/delivery-readings.js');
    const { recordOpenedTicket } = await import('@plot-pm/domain/rules/sprint-ticket-record');
    const { content } = recordOpenedTicket(sprintText('Active', '- [ ] [p] P'), '2026-11-10', '3301', 'feature/x');
    expect(ticketMarkFor([content], '3301')).toBe('opened by sprint');
    expect(ticketMarkFor([content], '330')).toBeNull();
    expect(ticketMarkFor([], '3301')).toBeNull();
  });
});
