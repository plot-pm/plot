import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TicketRecord } from '../src/entities/ticket-record.js';
import { ticketRecordFile, ticketRecordPath } from '../src/adapters/ticket-record/ticket-record-file.js';

const made: string[] = [];
afterEach(() => {
  while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true });
});
const root = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-record-'));
  made.push(dir);
  return dir;
};

describe('ticketRecordFile', () => {
  it('reads none for a missing file and unreadable for a foreign one', async () => {
    const dir = root();
    const store = ticketRecordFile(dir);
    expect(await store.read(7)).toEqual({ ok: true, value: 'none' });
    fs.mkdirSync(path.dirname(ticketRecordPath(dir, 7)), { recursive: true });
    fs.writeFileSync(ticketRecordPath(dir, 7), '{"v":9}');
    expect(await store.read(7)).toEqual({ ok: true, value: 'unreadable' });
  });

  it('writes, reads back and clears a record keyed by PR', async () => {
    const dir = root();
    const store = ticketRecordFile(dir);
    const record: TicketRecord = { v: 1, pr: 7, ticket: 'opened', id: '#12', heads: ['a'] };
    expect((await store.write(7, record)).ok).toBe(true);
    expect(ticketRecordPath(dir, 7)).toContain(path.join('.plot', 'state', 'tickets', '7.json'));
    expect(await store.read(7)).toEqual({ ok: true, value: record });
    expect((await store.clear(7)).ok).toBe(true);
    expect(await store.read(7)).toEqual({ ok: true, value: 'none' });
    expect((await store.clear(7)).ok).toBe(true);
  });
});
