import { describe, expect, it } from 'vitest';
import {
  GERMAN_WORDS,
  STYLE_SUBJECTS,
  TICKET_OCCURRENCES,
  fromSignals,
  isProposal,
  isQuestion,
  nodeMajor,
  proposeCi,
  proposeCommitStyle,
  proposeLanguage,
  proposeNode,
  proposeStack,
  proposeTicket,
  type CommitStyleCounts,
  type Signal,
  type StackReadings,
} from '../src/rules/stack.js';

const counts = (over: Partial<CommitStyleCounts> = {}): CommitStyleCounts => ({
  colon: 0,
  dash: 0,
  conventional: 0,
  ...over,
});

const readings = (over: Partial<StackReadings> = {}): StackReadings => ({
  nodeVersion: 'v24.20.0',
  nodeFloor: 24,
  commitStyleCounts: counts(),
  ticketPrefix: '',
  ticketPrefixCount: 0,
  subjectsRead: 30,
  germanWordCount: 0,
  hasHubDoc: false,
  ciSignals: null,
  ...over,
});

describe('nodeMajor', () => {
  it('reads the major from what `node --version` prints', () => {
    expect(nodeMajor('v24.20.0')).toBe(24);
    expect(nodeMajor('  v20.11.1\n')).toBe(20);
  });

  it('reads a bare major', () => {
    expect(nodeMajor('24')).toBe(24);
  });

  it('answers nothing for a string that names no version', () => {
    // The reassuring direction is a machine reported as supported that nobody
    // checked, so anything unparseable must answer `null` rather than a number.
    expect(nodeMajor('')).toBeNull();
    expect(nodeMajor('node 24')).toBeNull();
    expect(nodeMajor('v')).toBeNull();
  });
});

describe('proposeNode', () => {
  it('supports a major at or above the pinned floor', () => {
    expect(proposeNode({ nodeVersion: 'v24.20.0', nodeFloor: 24 }).supported).toBe(true);
    expect(proposeNode({ nodeVersion: 'v26.0.0', nodeFloor: 24 }).supported).toBe(true);
  });

  it('refuses a major below the floor', () => {
    expect(proposeNode({ nodeVersion: 'v20.11.1', nodeFloor: 24 }).supported).toBe(false);
  });

  it('carries the major and the floor it judged against', () => {
    const p = proposeNode({ nodeVersion: 'v20.11.1', nodeFloor: 24 });
    expect(p.major).toBe(20);
    expect(p.floor).toBe(24);
  });

  it('cannot verify without a node', () => {
    // Neither of the answers it might have had. `plot-board-probe.sh` already
    // takes this shape for auth: an unreadable reading is never a green light.
    expect(proposeNode({ nodeVersion: '', nodeFloor: 24 }).supported).toBeNull();
  });

  it('cannot verify without a pinned floor', () => {
    // A repository pinning nothing is the case a literal would have hidden: the
    // old probe answered `true` against a 20 nobody wrote down.
    const p = proposeNode({ nodeVersion: 'v24.20.0', nodeFloor: null });
    expect(p.supported).toBeNull();
    expect(p.floor).toBeNull();
  });

  it('takes the floor from the reading and never from a literal', () => {
    // The whole point of the field: one answer where the estate had three.
    expect(proposeNode({ nodeVersion: 'v20.0.0', nodeFloor: 20 }).supported).toBe(true);
    expect(proposeNode({ nodeVersion: 'v20.0.0', nodeFloor: 24 }).supported).toBe(false);
  });
});

describe('proposeCommitStyle', () => {
  it('proposes a notation once it clears the threshold', () => {
    expect(proposeCommitStyle(counts({ colon: STYLE_SUBJECTS }), 30).style).toBe('arlo-colon');
    expect(proposeCommitStyle(counts({ dash: STYLE_SUBJECTS }), 30).style).toBe('arlo-dash');
    expect(proposeCommitStyle(counts({ conventional: STYLE_SUBJECTS }), 30).style)
      .toBe('conventional');
  });

  it('proposes nothing on one matching subject', () => {
    // One commit is not a pattern, and a proposal the user must notice and undo
    // is what makes people distrust the whole probe.
    expect(proposeCommitStyle(counts({ colon: 1, dash: 1, conventional: 1 }), 30).style)
      .toBeNull();
  });

  it('carries the count and the sample size as its evidence', () => {
    const p = proposeCommitStyle(counts({ conventional: 12 }), 30);
    expect(p.matched).toBe(12);
    expect(p.outOf).toBe(30);
  });

  it('reports no evidence where it proposes nothing', () => {
    const p = proposeCommitStyle(counts({ colon: 1 }), 30);
    expect(p.matched).toBe(0);
    expect(p.outOf).toBe(30);
  });

  it('prefers conventional where both it and the colon form clear the bar', () => {
    // `feat: a thing` is conventional first; a repository writing both is
    // writing conventional commits with the occasional `F:`.
    expect(proposeCommitStyle(counts({ colon: 5, conventional: 5 }), 30).style)
      .toBe('conventional');
  });

  it('prefers the colon form where it outnumbers conventional', () => {
    expect(proposeCommitStyle(counts({ colon: 9, conventional: 3 }), 30).style)
      .toBe('arlo-colon');
  });

  it('reaches the dash form only when neither other clears the bar', () => {
    expect(proposeCommitStyle(counts({ colon: 1, conventional: 1, dash: 8 }), 30).style)
      .toBe('arlo-dash');
  });
});

describe('proposeTicket', () => {
  it('proposes a prefix that recurs', () => {
    const p = proposeTicket('QUACDS', TICKET_OCCURRENCES, 80);
    expect(p.prefix).toBe('QUACDS');
    expect(p.matched).toBe(TICKET_OCCURRENCES);
    expect(p.outOf).toBe(80);
  });

  it('proposes nothing on a single occurrence', () => {
    expect(proposeTicket('ONEOFF', 1, 80).prefix).toBeNull();
  });

  it('proposes nothing where the probe found no prefix at all', () => {
    // Absence still proves nothing in the other direction: the skills ask about
    // the tracker rather than proposing none.
    expect(proposeTicket('', 0, 80).prefix).toBeNull();
  });

  it('keeps the sample size even where it proposes nothing', () => {
    expect(proposeTicket('', 0, 80).outOf).toBe(80);
  });
});

describe('proposeLanguage', () => {
  it('proposes German once the sample carries enough German words', () => {
    const p = proposeLanguage(GERMAN_WORDS, true);
    expect(p.language).toBe('de');
    expect(p.germanWords).toBe(GERMAN_WORDS);
  });

  it('proposes English below the threshold', () => {
    expect(proposeLanguage(GERMAN_WORDS - 1, true).language).toBe('en');
  });

  it('proposes nothing where there was no hub doc to read', () => {
    // Not the same answer as English: a confident `en` there would be a reading
    // nobody took.
    const p = proposeLanguage(0, false);
    expect(p.language).toBeNull();
    expect(p.germanWords).toBe(0);
  });
});

describe('fromSignals', () => {
  const signal = (
    proposes: 'a' | 'b' | 'c',
    present: boolean,
  ): Signal<'a' | 'b' | 'c'> => ({ proposes, evidence: `evidence for ${proposes}`, present });

  it('proposes what a lone present signal proposes, with its evidence', () => {
    const answer = fromSignals([signal('a', true), signal('b', false)]);
    expect(answer.answer).toBe('propose');
    expect(isProposal(answer)).toBe(true);
    if (!isProposal(answer)) throw new Error('unreachable');
    expect(answer.proposed).toBe('a');
    expect(answer.evidence).toBe('evidence for a');
  });

  it('asks rather than tie-breaking when two signals are present', () => {
    // The rule the plan exists to make assertable. The rejected design ranked
    // the signals and picked one, which is silently wrong for every repository
    // whose two signals disagree.
    const answer = fromSignals([signal('a', true), signal('b', true)]);
    expect(answer.answer).toBe('ask');
    expect(isQuestion(answer)).toBe(true);
    expect(isProposal(answer)).toBe(false);
  });

  it('names every present signal in the question', () => {
    // A question that says only *two signals disagree* leaves the person doing
    // the probe's work again. The evidence is what makes it answerable.
    const answer = fromSignals([signal('a', true), signal('b', false), signal('c', true)]);
    if (!isQuestion(answer)) throw new Error('expected a question');
    expect(answer.found).toEqual(['evidence for a', 'evidence for c']);
  });

  it('carries no proposed word on a question', () => {
    // THE POINT OF THE UNION. `jenkins` plus `uncertain: true` invites a caller
    // to read the first half; there is no first half to read here.
    const answer = fromSignals([signal('a', true), signal('b', true)]);
    expect(Object.hasOwn(answer, 'proposed')).toBe(false);
    expect(Object.hasOwn(answer, 'evidence')).toBe(false);
  });

  it('is silent where no signal is present', () => {
    // Not a proposal of the absent word, and not a question either. There is
    // nothing to ask about.
    expect(fromSignals([signal('a', false), signal('b', false)]).answer).toBe('silent');
    expect(fromSignals<'a'>([]).answer).toBe('silent');
  });

  it('carries no found list on a silence', () => {
    const answer = fromSignals([signal('a', false)]);
    expect(isQuestion(answer)).toBe(false);
    expect(isProposal(answer)).toBe(false);
  });
});

describe('proposeCi', () => {
  it('proposes jenkins from a lone Jenkinsfile', () => {
    const answer = proposeCi({ jenkinsfile: true, ghWorkflows: false });
    if (!isProposal(answer)) throw new Error('expected a proposal');
    expect(answer.proposed).toBe('jenkins');
    expect(answer.evidence).toBe('a `Jenkinsfile`');
  });

  it('proposes github-actions from lone workflows', () => {
    const answer = proposeCi({ jenkinsfile: false, ghWorkflows: true });
    if (!isProposal(answer)) throw new Error('expected a proposal');
    expect(answer.proposed).toBe('github-actions');
    expect(answer.evidence).toBe('`.github/workflows/`');
  });

  it('asks, naming both, where the tree shows both', () => {
    // A team on GitHub running Jenkins is this sprint's own user, and a
    // silently wrong `CI:` sends every build-status lookup to the wrong system.
    const answer = proposeCi({ jenkinsfile: true, ghWorkflows: true });
    if (!isQuestion(answer)) throw new Error('expected a question');
    expect(answer.found).toEqual(['a `Jenkinsfile`', '`.github/workflows/`']);
  });

  it('is silent where the tree shows neither', () => {
    // `none` is a reading, not a key: adoption writes nothing rather than
    // recording a `CI: none` the repository never chose.
    expect(proposeCi({ jenkinsfile: false, ghWorkflows: false }).answer).toBe('silent');
  });
});

describe('proposeStack', () => {
  it('answers all four questions from one set of readings', () => {
    const p = proposeStack(readings({
      nodeVersion: 'v24.20.0',
      nodeFloor: 24,
      commitStyleCounts: counts({ conventional: 18 }),
      ticketPrefix: 'QUACDS',
      ticketPrefixCount: 38,
      subjectsRead: 80,
      germanWordCount: 7,
      hasHubDoc: true,
    }));
    expect(p.node.supported).toBe(true);
    expect(p.commitStyle.style).toBe('conventional');
    expect(p.ticket.prefix).toBe('QUACDS');
    expect(p.language.language).toBe('de');
  });

  it('answers the CI question where the readings carried the signals', () => {
    const p = proposeStack(readings({ ciSignals: { jenkinsfile: true, ghWorkflows: false } }));
    if (p.ci === null || !isProposal(p.ci)) throw new Error('expected a proposal');
    expect(p.ci.proposed).toBe('jenkins');
  });

  it('leaves the CI question unanswered where the collector did not look', () => {
    // `null` IS NOT SILENCE. A collector that never reported `ci_signals` did
    // not look; one that reported two falses looked and found nothing. Only the
    // second licenses writing no `CI:` key on the repository's behalf.
    expect(proposeStack(readings({ ciSignals: null })).ci).toBeNull();
    expect(proposeStack(readings({ ciSignals: { jenkinsfile: false, ghWorkflows: false } })).ci)
      .toEqual({ answer: 'silent' });
  });

  it('proposes nothing from a repository that shows nothing', () => {
    const p = proposeStack(readings({ nodeVersion: '', nodeFloor: null, subjectsRead: 0 }));
    expect(p.node.supported).toBeNull();
    expect(p.commitStyle.style).toBeNull();
    expect(p.ticket.prefix).toBeNull();
    expect(p.language.language).toBeNull();
  });

  it('reads the ticket count from its own field, not the style counts', () => {
    // Two readings over one sample, and pairing the wrong count with the wrong
    // proposal is exactly the mistake a single collector-side `if` chain hid.
    const p = proposeStack(readings({
      commitStyleCounts: counts({ colon: 9 }),
      ticketPrefix: 'ABC',
      ticketPrefixCount: 4,
      subjectsRead: 30,
    }));
    expect(p.commitStyle.matched).toBe(9);
    expect(p.ticket.matched).toBe(4);
  });
});
