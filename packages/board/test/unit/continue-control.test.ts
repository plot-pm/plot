// The control is named as a CONTINUATION, not as a reply.
//
// **A naming test, and it earns its place** — this is the one requirement in
// the wave that no compiler, type or route check can hold. The plan states the
// reason: the agent that asked is gone, so what continues is the work rather
// than the conversation, and a UI implying otherwise would promise a channel
// that does not exist. That promise is broken by an ordinary, well-meant edit —
// "Reply" is shorter and reads more naturally — and nothing else in the suite
// would notice.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  CONTINUE_HINT,
  CONTINUE_LABEL,
  refusalWord,
} from '../../src/app/components/ContinueWithAnAnswer.js';
import type { ContinueRefusal } from '../../src/server/continue.js';

describe('the control is named as a continuation', () => {
  it('is called “Continue with an answer”, the plan’s own words', () => {
    assert.equal(CONTINUE_LABEL, 'Continue with an answer');
  });

  it('never uses conversational vocabulary', () => {
    // Each of these implies a recipient who will read it. `claude -p` has no
    // stdin after launch, so none of them can be honoured.
    const forbidden = ['reply', 'respond', 'send message', 'chat', 'thread', 'answer back'];
    const text = `${CONTINUE_LABEL} ${CONTINUE_HINT}`.toLowerCase();
    for (const word of forbidden) {
      assert.ok(!text.includes(word), `the control must not say “${word}”`);
    }
  });

  it('says the previous agent has exited, where the label cannot', () => {
    // The label is short by necessity; this is where the reader is told the
    // thing that would otherwise surprise them.
    assert.ok(/exited/i.test(CONTINUE_HINT), 'the hint must say the old agent is gone');
    assert.ok(/new worker/i.test(CONTINUE_HINT), 'and that a new one starts');
  });

  it('names what the new worker is given', () => {
    // The prompt's three parts, stated to the reader so the control's effect is
    // predictable rather than magical.
    for (const part of [/answer/i, /brief/i, /landed/i]) {
      assert.ok(part.test(CONTINUE_HINT), `the hint must name ${part}`);
    }
  });

  it('does not promise a conversation', () => {
    assert.ok(
      /not a conversation/i.test(CONTINUE_HINT),
      'the hint must rule out the reading it is most likely to invite',
    );
  });
});

describe('every refusal says something different', () => {
  const reasons: ContinueRefusal[] = [
    'unknown-branch',
    'no-worktree',
    'no-question',
    'no-worker-command',
  ];

  it('renders a distinct sentence for each', () => {
    // Four reasons collapsed into one message is the defect the three-way
    // answers elsewhere in this server exist to prevent: each of these sends
    // the reader to a different place.
    const said = reasons.map(refusalWord);
    assert.equal(new Set(said).size, reasons.length, 'two refusals read the same');
  });

  it('tells the reader what to do, not merely what failed', () => {
    for (const reason of reasons) {
      const word = refusalWord(reason);
      assert.ok(word.length > 20, `${reason} is too terse to act on`);
      assert.ok(/\.$/.test(word), `${reason} should read as a sentence`);
    }
  });

  it('sends a no-worktree reader to the machine that holds it', () => {
    assert.ok(/machine/i.test(refusalWord('no-worktree')));
  });

  it('explains a missing question as a possibly stale view', () => {
    // The precondition IS the state the control was offered for, so the likely
    // cause is that someone else answered it — not that the reader did anything
    // wrong.
    assert.ok(/already/i.test(refusalWord('no-question')));
  });
});
