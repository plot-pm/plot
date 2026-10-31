import { describe, expect, it } from 'vitest';
import { decodeTicketRecord, encodeTicketRecord, type TicketRecord } from '../src/entities/ticket-record.js';
import { reviewStatus, ticketFindingsBody, ticketReading, type TicketReading } from '../src/rules/ticket.js';

const HEAD = 'a'.repeat(40);
const opened: TicketRecord = { v: 1, pr: 7, ticket: 'opened', id: '#12', heads: [HEAD] };
const counts = { high: 2, medium: 1, low: 0 };

describe('decodeTicketRecord', () => {
  it('keeps empty, unreadable and wrong-version text apart', () => {
    expect(decodeTicketRecord('')).toBe('none');
    expect(decodeTicketRecord('{')).toBe('unreadable');
    expect(decodeTicketRecord(JSON.stringify({ ...opened, v: 2 }))).toBe('unreadable');
  });

  it('round-trips pending and opened records', () => {
    const pending: TicketRecord = { v: 1, pr: 7, ticket: 'pending', at: '2026-10-31T00:00:00.000Z' };
    expect(decodeTicketRecord(encodeTicketRecord(pending))).toEqual(pending);
    expect(decodeTicketRecord(encodeTicketRecord(opened))).toEqual(opened);
  });
});

describe('ticketReading', () => {
  it('tells none, pending, opened and unreadable apart', () => {
    expect(ticketReading('none', HEAD)).toEqual({ read: 'record', ticket: 'none' });
    expect(ticketReading({ v: 1, pr: 7, ticket: 'pending', at: 'x' }, HEAD)).toEqual({ read: 'record', ticket: 'pending' });
    expect(ticketReading(opened, HEAD)).toEqual({ read: 'record', ticket: 'opened', id: '#12', coversHead: true });
    expect(ticketReading(opened, 'b'.repeat(40))).toMatchObject({ coversHead: false });
    expect(ticketReading('unreadable', HEAD)).toEqual({ read: 'unread' });
  });
});

describe('reviewStatus', () => {
  const confirmed: TicketReading = { read: 'record', ticket: 'opened', id: '#12', coversHead: true };

  it('accepts a HIGH only when the ticket is confirmed AND the attempts are spent', () => {
    expect(reviewStatus(counts, confirmed, true)).toEqual({ state: 'success', description: '2 HIGH findings; ticketed #12' });
    expect(reviewStatus(counts, confirmed, false).state).toBe('failure');
    expect(reviewStatus(counts, { read: 'record', ticket: 'pending' }, true).state).toBe('failure');
    expect(reviewStatus(counts, { read: 'record', ticket: 'none' }, true).state).toBe('failure');
    expect(reviewStatus(counts, { ...confirmed, coversHead: false }, true).state).toBe('failure');
    expect(reviewStatus(counts, { read: 'unread' }, true).state).toBe('failure');
  });

  it('words a single HIGH in the singular', () => {
    expect(reviewStatus({ high: 1, medium: 0, low: 0 }, confirmed, true).description).toBe('1 HIGH finding; ticketed #12');
    expect(reviewStatus({ high: 1, medium: 0, low: 0 }, confirmed, false).description).toBe('1 HIGH finding');
  });

  it('passes a review with no HIGH and keeps the description within 140 characters', () => {
    expect(reviewStatus({ high: 0, medium: 3, low: 1 }, { read: 'unread' }, false).state).toBe('success');
    const long = reviewStatus({ high: 99, medium: 0, low: 0 }, { ...confirmed, id: 'X'.repeat(400) }, true);
    expect(long.description.length).toBeLessThanOrEqual(140);
  });
});

describe('ticketFindingsBody', () => {
  it('names the count, the PR and the head, then the verdict text', () => {
    const body = ticketFindingsBody(HEAD, 'https://host/pr/7', counts, '- [HIGH] leaks a token\n');
    expect(body).toContain('HIGH 2, MEDIUM 1, LOW 0 on https://host/pr/7 at ' + HEAD);
    expect(body).toContain('- [HIGH] leaks a token');
  });
});
