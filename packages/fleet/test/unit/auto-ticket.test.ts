import { describe, expect, it } from 'vitest';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { FixerAttemptsRecord } from '@plot-pm/domain/entities/fixer-attempts';
import type { TicketRecord } from '@plot-pm/domain/entities/ticket-record';
import { runLogFixture } from '@plot-pm/domain/adapters';
import { ticketTick, type TicketTickReadings, type TicketTickWorld } from '../../src/shared/auto-ticket.js';

const HEAD = 'a'.repeat(40);
const HEAD2 = 'b'.repeat(40);
const NOW = 5_000_000_000;
const FINDINGS = '- [HIGH] leaks a token\nFindings: HIGH 2, MEDIUM 1, LOW 0\n';

const attempt = (n: number) => ({ headSha: HEAD, finding: { kind: 'high' as const, hash: `h${n}` } });
const spent: FixerAttemptsRecord = { v: 1, pr: 7, attempts: [attempt(1), attempt(2)] };

const rowAt = (head: string): PrIndexRow => ({
  number: 7,
  head: 'feature/x',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'https://host/pr/7',
  headSha: head,
  plotReview: 'failure',
  plotReviewSha: head,
});

const readings: TicketTickReadings = {
  newestMerged: null,
  scope: { read: 'scope', sprint: {} as never, slugs: ['x'], branches: ['feature/x'] },
  reviewRun: null,
  reviewStarts: null,
  verdict: { read: 'absent' },
  defaultBranch: null,
  config: { autoReview: false, reviewBoundMs: 0, startBudget: 0, checksWaitMs: 0 },
  now: NOW,
};

interface Opts {
  attempts?: FixerAttemptsRecord | 'none' | 'unreadable';
  record?: TicketRecord | 'none' | 'unreadable';
  verdict?: string | null;
  open?: 'opened' | 'unaskable' | 'failed' | 'may-exist';
  status?: 'ok' | 'unaskable';
}

const rig = (opts: Opts = {}) => {
  let record: TicketRecord | 'none' | 'unreadable' = opts.record ?? 'none';
  const calls = { open: [] as { title: string; body: string; labels: readonly string[] }[], comment: [] as { id: string; body: string }[], status: [] as { sha: string; state: string; description: string; context: string }[], notes: [] as string[], writes: [] as string[] };
  let refusal: string | null = null;
  const world: TicketTickWorld = {
    attempts: () => ({ read: async () => ({ ok: true, value: opts.attempts ?? spent }) }),
    tickets: () => ({
      read: async () => ({ ok: true, value: record }),
      write: async (_pr, next) => {
        calls.writes.push(next.ticket);
        record = next;
        return { ok: true, value: undefined };
      },
      clear: async () => {
        calls.writes.push('clear');
        record = 'none';
        return { ok: true, value: undefined };
      },
    }),
    tracker: async () => ({
      issueOpen: async (write) => {
        calls.open.push(write);
        if (opts.open === 'unaskable') return { ok: false, why: 'unaskable' };
        if (opts.open === 'failed') { refusal = 'refused'; return { ok: false, why: 'failed' }; }
        if (opts.open === 'may-exist') { refusal = 'the issue may exist: timed out'; return { ok: false, why: 'failed' }; }
        return { ok: true, value: { outcome: 'opened', id: '#12' } };
      },
      issueComment: async (id, body) => {
        calls.comment.push({ id, body });
        return { ok: true, value: { outcome: 'commented' } };
      },
      lastRefusal: () => refusal,
    }),
    host: () => ({
      commitStatus: async (write) => {
        calls.status.push(write);
        return opts.status === 'unaskable' ? { ok: false, why: 'unaskable' } : { ok: true, value: true };
      },
    }),
    readVerdictFile: () => (opts.verdict === undefined ? FINDINGS : opts.verdict),
    notify: (m) => calls.notes.push(m),
  };
  return { world, calls, record: () => record };
};

const optsFor = () => ({ repoRoot: '/nonexistent', scriptsDir: '/nonexistent', runLog: runLogFixture().port });

describe('ticketTick', () => {
  it('opens one ticket, records its id, and next tick writes the accepted success', async () => {
    const r = rig();
    const [first] = await ticketTick([rowAt(HEAD)], readings, optsFor(), r.world);
    expect(first!.acted).toEqual({ done: true });
    expect(r.calls.writes).toEqual(['pending', 'opened']);
    expect(r.calls.open).toHaveLength(1);
    expect(r.calls.open[0]).toMatchObject({ title: 'plot-review: findings on PR #7', labels: ['ai-generated'] });
    expect(r.calls.open[0]!.body).toContain('HIGH 2, MEDIUM 1, LOW 0 on https://host/pr/7');

    const [second] = await ticketTick([rowAt(HEAD)], readings, optsFor(), r.world);
    expect(second!.step).toMatchObject({ step: 'write-status', why: 'ticket-accepted' });
    expect(r.calls.status).toEqual([
      { sha: HEAD, state: 'success', context: 'plot/review', description: '2 HIGH findings; ticketed #12', targetUrl: 'https://host/pr/7' },
    ]);
  });

  it('holds on a pending record: no second open, no success', async () => {
    const r = rig({ record: { v: 1, pr: 7, ticket: 'pending', at: 'x' } });
    const [result] = await ticketTick([rowAt(HEAD)], readings, optsFor(), r.world);
    expect(result!.step).toEqual({ step: 'hold', reason: 'ticket-pending' });
    expect(r.calls.open).toHaveLength(0);
    expect(r.calls.status).toHaveLength(0);
  });

  it('opens one ticket across two heads; the second head lands as a comment', async () => {
    const r = rig();
    await ticketTick([rowAt(HEAD)], readings, optsFor(), r.world);
    await ticketTick([rowAt(HEAD2)], readings, optsFor(), r.world);
    expect(r.calls.open).toHaveLength(1);
    expect(r.calls.comment).toHaveLength(1);
    expect(r.calls.comment[0]!.id).toBe('#12');
    expect(r.calls.comment[0]!.body).toContain(`at ${HEAD2}`);
    expect(r.calls.comment[0]!.body).toContain('HIGH 2');
    expect(r.record()).toMatchObject({ ticket: 'opened', heads: [HEAD, HEAD2] });
  });

  it('writes no ticket while the attempts are not spent', async () => {
    const r = rig({ attempts: 'none' });
    const [result] = await ticketTick([rowAt(HEAD)], readings, optsFor(), r.world);
    expect(result!.step.step).toBe('fixer');
    expect(r.calls.open).toHaveLength(0);
  });

  it('holds on an unaskable tracker, clears the mark and writes no success', async () => {
    const r = rig({ open: 'unaskable' });
    const [result] = await ticketTick([rowAt(HEAD)], readings, optsFor(), r.world);
    expect(result!.acted).toEqual({ done: false, why: 'tracker-unaskable' });
    expect(r.record()).toBe('none');
    expect(r.calls.status).toHaveLength(0);
  });

  it('keeps the pending mark where the issue may exist, and tells a person', async () => {
    const r = rig({ open: 'may-exist' });
    const [result] = await ticketTick([rowAt(HEAD)], readings, optsFor(), r.world);
    expect(result!.acted).toEqual({ done: false, why: 'ticket-pending' });
    expect(r.record()).toMatchObject({ ticket: 'pending' });
    expect(r.calls.notes[0]).toContain('.plot/state/tickets/7.json');
  });

  it('holds and tells a person where the host cannot write a commit status', async () => {
    const r = rig({ record: { v: 1, pr: 7, ticket: 'opened', id: '#12', heads: [HEAD] }, status: 'unaskable' });
    const [result] = await ticketTick([rowAt(HEAD)], readings, optsFor(), r.world);
    expect(result!.acted).toEqual({ done: false, why: 'host-unaskable' });
    expect(r.calls.notes).toHaveLength(1);
  });

  it('opens nothing where the findings file cannot be read', async () => {
    const r = rig({ verdict: null });
    const [result] = await ticketTick([rowAt(HEAD)], readings, optsFor(), r.world);
    expect(result!.acted).toEqual({ done: false, why: 'findings-unread' });
    expect(r.calls.writes).toEqual([]);
  });
});
