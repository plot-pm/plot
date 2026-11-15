import { describe, expect, it } from 'vitest';
import type { PrConversationReading, PrConversationRow } from '../src/ports/host.js';
import { humanCommentOpen } from '../src/rules/human-comment-open.js';

let id = 0;
const row = (over: Partial<PrConversationRow>): PrConversationRow => ({
  kind: 'issue', id: ++id, login: 'max', type: 'User', time: '2026-11-09T14:32:00Z', body: 'why not CC-0?', ...over,
});
const convo = (...rows: PrConversationRow[]): PrConversationReading => ({ prAuthor: 'jan', rows });
const at = (m: number) => `2026-11-09T14:${String(m).padStart(2, '0')}:00Z`;

describe('humanCommentOpen', () => {
  it('reads an empty conversation as no open comment', () => {
    expect(humanCommentOpen(convo())).toBeNull();
  });

  it('names an unanswered comment with its login, time and first line', () => {
    expect(humanCommentOpen(convo(row({ body: '\n  why not CC-0?\nsecond line' })))).toEqual({
      login: 'max', time: at(32), firstLine: 'why not CC-0?', others: 0, conversationAt: '2026-11-09T14:32:00.000Z',
    });
  });

  it('is answered by a later comment from a different login', () => {
    expect(humanCommentOpen(convo(row({}), row({ login: 'jan', time: at(40), body: 'MIT is the licence we chose' })))).toBeNull();
  });

  it('holds a third person’s reply until somebody else answers that reply', () => {
    expect(humanCommentOpen(convo(row({}), row({ login: 'lena', time: at(40), body: 'agreed' })))).toMatchObject({ login: 'lena' });
  });

  it('is not answered by the commenter themselves', () => {
    expect(humanCommentOpen(convo(row({}), row({ time: at(40), body: 'and another thing' })))?.others).toBe(1);
  });

  it('is answered by a later APPROVED review from any login, the commenter’s own included', () => {
    const review = (login: string) => row({ kind: 'review', login, state: 'APPROVED', body: '', time: at(45) });
    expect(humanCommentOpen(convo(row({}), review('lena')))).toBeNull();
    expect(humanCommentOpen(convo(row({}), review('max')))).toBeNull();
  });

  it('is not answered by an earlier reply, a tie, or a later commit', () => {
    expect(humanCommentOpen(convo(row({ login: 'jan', time: at(10) }), row({ login: 'lena', time: at(10) }), row({})))?.login).toBe('max');
    expect(humanCommentOpen(convo(row({ time: at(40) }), row({ login: 'lena', time: at(40), body: 'same second' })))?.login).toBe('max');
  });

  it('ignores a comment by the PR author', () => {
    expect(humanCommentOpen(convo(row({ login: 'jan' })))).toBeNull();
  });

  it('does not count a marked comment, and a marked comment does not answer', () => {
    const marked = row({ login: 'jan', time: at(50), body: '<!-- plot-review -->\nfindings' });
    expect(humanCommentOpen(convo(marked))).toBeNull();
    expect(humanCommentOpen(convo(row({}), { ...marked, login: 'lena' }))?.login).toBe('max');
  });

  it('does not count a Bot comment, and a Bot comment does not answer', () => {
    expect(humanCommentOpen(convo(row({ type: 'Bot' })))).toBeNull();
    expect(humanCommentOpen(convo(row({}), row({ login: 'ci', type: 'Bot', time: at(50) })))?.login).toBe('max');
  });

  it('counts an empty type as a person, as on Bitbucket', () => {
    expect(humanCommentOpen(convo(row({ type: '' })))?.login).toBe('max');
  });

  it('counts COMMENTED, CHANGES_REQUESTED and DISMISSED bodies, and not an empty body, a PENDING review or an APPROVED one', () => {
    const review = (state: string, body = 'looks off') => row({ kind: 'review', state, body, time: state === 'PENDING' ? '' : at(32) });
    for (const state of ['COMMENTED', 'CHANGES_REQUESTED', 'DISMISSED']) expect(humanCommentOpen(convo(review(state)))).not.toBeNull();
    expect(humanCommentOpen(convo(review('COMMENTED', '')))).toBeNull();
    expect(humanCommentOpen(convo(review('PENDING')))).toBeNull();
    expect(humanCommentOpen(convo(review('APPROVED')))).toBeNull();
  });

  it('answers nothing with a pending review and holds a comment whose time does not parse', () => {
    const pending = row({ kind: 'review', login: 'lena', state: 'APPROVED', time: '' });
    expect(humanCommentOpen(convo(row({}), pending))?.login).toBe('max');
    expect(humanCommentOpen(convo(row({ time: 'garbage' }), row({ login: 'lena', time: at(50) })))?.time).toBe('garbage');
  });

  it('names the oldest of two open comments and counts the other', () => {
    const out = humanCommentOpen(convo(row({ time: at(50), body: 'later' }), row({ time: at(20), body: 'earlier' })));
    expect(out).toMatchObject({ login: 'max', firstLine: 'earlier', others: 1 });
  });

  it('takes conversationAt over every row, marked and Bot rows included', () => {
    const out = humanCommentOpen(convo(row({}), row({ login: 'jan', type: 'Bot', time: at(55), body: '<!-- plot-x -->' })));
    expect(out?.conversationAt).toBe('2026-11-09T14:55:00.000Z');
  });

  it('words the detail inputs: a deleted account, a tie, and an unparseable newest time', () => {
    const out = humanCommentOpen(convo(row({ login: '', time: 'x' }), row({ login: '', time: 'y', body: 'b' })));
    expect(out).toMatchObject({ login: '', others: 1, conversationAt: '' });
  });

  it('sorts equal times by arrival order and an unparseable time before a parseable one', () => {
    const first = row({ body: 'first' });
    const second = row({ body: 'second' });
    expect(humanCommentOpen(convo(first, second))?.firstLine).toBe('first');
    expect(humanCommentOpen(convo(row({ time: at(10), body: 'dated' }), row({ time: 'x', body: 'undated' })))?.firstLine).toBe('undated');
    expect(humanCommentOpen(convo(row({ time: 'x', body: 'undated' }), row({ time: at(10), body: 'dated' })))?.firstLine).toBe('undated');
  });

  it('opens a comment by login when the PR author is unknown', () => {
    expect(humanCommentOpen({ prAuthor: '', rows: [row({ login: '' })] })).not.toBeNull();
  });
});
