import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKTREE_ROOT,
  composeAdoption,
  ignoreLineFor,
  isAdoptionRefusal,
  type AdoptionAnswers,
  type AdoptionInput,
  type AdoptionReadings,
} from '../src/rules/adoption.js';
import { proposeCi, proposeStack, type StackProposal } from '../src/rules/stack.js';

const readings = (over: Partial<AdoptionReadings> = {}): AdoptionReadings => ({
  hasPlotConfig: false,
  hubDocs: ['CLAUDE.md'],
  gitHost: 'github',
  ...over,
});

const answers = (over: Partial<AdoptionAnswers> = {}): AdoptionAnswers => ({
  hub: '',
  definitionOfDone: ['test', 'lint'],
  tracker: '',
  trackerUrl: '',
  ci: '',
  worktreeRoot: '',
  ...over,
});

/** The proposals a repository with no signals at all produces. */
const bare = (): StackProposal =>
  proposeStack({
    nodeVersion: 'v24.20.0',
    nodeFloor: 24,
    commitStyleCounts: { colon: 0, dash: 0, conventional: 0 },
    ticketPrefix: '',
    ticketPrefixCount: 0,
    subjectsRead: 80,
    germanWordCount: 0,
    hasHubDoc: true,
    ciSignals: CI_SIGNALS.map((signal) => ({ ...signal, present: false })),
    ciHost: '',
    instanceKeyedCi: '',
  });

/**
 * The CI signals a collector looks for, as it would report them.
 *
 * THE VENDOR NAMES ARE THE COLLECTOR'S. `proposeCi` holds no list, so a test
 * that wants a CI answer supplies the signals — which is also what lets the
 * `buildkite` case below need no production edit.
 */
const CI_SIGNALS = [
  { proposes: 'jenkins', evidence: 'a `Jenkinsfile`' },
  { proposes: 'github-actions', evidence: '`.github/workflows/`' },
];

/** The proposal a repository showing exactly these systems produces. */
const showing = (...present: string[]): StackProposal => ({
  ...bare(),
  ci: proposeCi(
    (present.length === 0 ? CI_SIGNALS : present.map((proposes) => ({
      proposes,
      evidence: `evidence for ${proposes}`,
    }))).map((signal) => ({ ...signal, present: present.includes(signal.proposes) })),
  ),
});

/** The proposal a collector that never looked for CI at all produces. */
const unread = (): StackProposal => ({ ...bare(), ci: null });

const input = (over: Partial<AdoptionInput> = {}): AdoptionInput => ({
  readings: readings(),
  proposal: bare(),
  answers: answers(),
  unattended: false,
  ...over,
});

const valueOf = (result: ReturnType<typeof composeAdoption>, key: string): string | undefined => {
  if (isAdoptionRefusal(result)) throw new Error(`refused: ${result.detail}`);
  return result.keys.find((k) => k.key === key)?.value;
};

describe('composeAdoption — the refusals', () => {
  it('refuses a repository that already carries a `## Plot Config`, by name', () => {
    const result = composeAdoption(
      input({ readings: readings({ hasPlotConfig: true, hubDocs: ['AGENTS.md'] }) }),
    );
    expect(isAdoptionRefusal(result)).toBe(true);
    if (!isAdoptionRefusal(result)) return;
    expect(result.reason).toBe('already-adopted');
    expect(result.detail).toContain('AGENTS.md');
    expect(result.unasked).toEqual([]);
  });

  it('names a hub doc even where the probe listed none', () => {
    const result = composeAdoption(
      input({ readings: readings({ hasPlotConfig: true, hubDocs: [] }) }),
    );
    if (!isAdoptionRefusal(result)) throw new Error('expected a refusal');
    expect(result.detail).toContain('a hub doc');
  });

  it('refuses two hub docs rather than choosing one', () => {
    const result = composeAdoption(
      input({ readings: readings({ hubDocs: ['CLAUDE.md', 'AGENTS.md'] }) }),
    );
    if (!isAdoptionRefusal(result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('hub-ambiguous');
    expect(result.detail).toContain('CLAUDE.md and AGENTS.md');
    expect(result.unasked).toEqual(['Which hub doc is canonical?']);
  });

  it('refuses a missing Definition of Done, and names the question', () => {
    const result = composeAdoption(input({ answers: answers({ definitionOfDone: [] }) }));
    if (!isAdoptionRefusal(result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('answer-missing');
    expect(result.unasked).toEqual(['Which gates make the Definition of Done?']);
    expect(result.detail).not.toContain('PLOT-UNASKED');
  });

  it('reports the same gap as PLOT-UNASKED where no person is present', () => {
    const result = composeAdoption(
      input({ answers: answers({ definitionOfDone: [] }), unattended: true }),
    );
    if (!isAdoptionRefusal(result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('answer-missing');
    expect(result.detail).toMatch(/^PLOT-UNASKED: Which gates make the Definition of Done\?/);
    expect(result.detail).toContain('no files created');
  });

  it('refuses an adopted repository before it looks at anything else', () => {
    // BOTH would refuse — an adopted repo AND a missing Definition of Done. The
    // order matters: nothing about the proposal is worth saying once the answer
    // is that the repository is already adopted.
    const result = composeAdoption(
      input({
        readings: readings({ hasPlotConfig: true }),
        answers: answers({ definitionOfDone: [] }),
      }),
    );
    if (!isAdoptionRefusal(result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('already-adopted');
  });
});

describe('composeAdoption — the keys', () => {
  it('writes the structural keys, the confirmed gates and the host', () => {
    const result = composeAdoption(input());
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(result.hub).toBe('CLAUDE.md');
    expect(result.creates).toBe(false);
    expect(result.keys.map((k) => k.key)).toEqual([
      'Branch prefixes',
      'Plan directory',
      'Active index',
      'Delivered index',
      'Definition of Done',
      'Git host',
      'Tracker',
      'Worktree root',
    ]);
    expect(valueOf(result, 'Definition of Done')).toBe('test, lint');
    expect(valueOf(result, 'Git host')).toBe('github');
  });

  it('creates CLAUDE.md where no hub doc exists', () => {
    const result = composeAdoption(input({ readings: readings({ hubDocs: [] }) }));
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(result.hub).toBe('CLAUDE.md');
    expect(result.creates).toBe(true);
  });

  it('takes a chosen hub, and says whether it has to be created', () => {
    const chosen = composeAdoption(
      input({
        readings: readings({ hubDocs: ['CLAUDE.md', 'AGENTS.md'] }),
        answers: answers({ hub: 'AGENTS.md' }),
      }),
    );
    if (isAdoptionRefusal(chosen)) throw new Error(chosen.detail);
    expect(chosen.hub).toBe('AGENTS.md');
    expect(chosen.creates).toBe(false);

    const invented = composeAdoption(input({ answers: answers({ hub: 'docs/HUB.md' }) }));
    if (isAdoptionRefusal(invented)) throw new Error(invented.detail);
    expect(invented.creates).toBe(true);
  });

  it('writes no `Git host` key where the probe read none', () => {
    const result = composeAdoption(input({ readings: readings({ gitHost: '' }) }));
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(result.keys.map((k) => k.key)).not.toContain('Git host');
  });

  it('falls back to `Tracker: plot` and never proposes `none` from silence', () => {
    const result = composeAdoption(input());
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(valueOf(result, 'Tracker')).toBe('plot');
    // No tracker gap — a fallback announces nothing. The one gap here is the
    // fixture's CI signals, all absent, which the CI tests own.
    expect(result.gaps.filter((g) => g.startsWith('Tracker'))).toEqual([]);
  });

  it('writes a confirmed tracker with its base URL and its evidence', () => {
    const result = composeAdoption(
      input({
        proposal: proposeStack({
          nodeVersion: 'v24.20.0',
          nodeFloor: 24,
          commitStyleCounts: { colon: 0, dash: 0, conventional: 0 },
          ticketPrefix: 'QUACDS',
          ticketPrefixCount: 38,
          subjectsRead: 80,
          germanWordCount: 0,
          hasHubDoc: true,
          ciSignals: [{ proposes: 'jenkins', evidence: 'a `Jenkinsfile`', present: true }],
          ciHost: '',
          instanceKeyedCi: '',
        }),
        answers: answers({ tracker: 'jira', trackerUrl: 'https://acme.atlassian.net' }),
      }),
    );
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(valueOf(result, 'Tracker')).toBe('jira https://acme.atlassian.net');
    expect(result.keys.find((k) => k.key === 'Tracker')?.evidence)
      .toBe('QUACDS in 38 of 80 subjects');
    // A fully answered tracker AND a single CI signal — nothing is owed.
    expect(result.gaps).toEqual([]);
  });

  it('writes a confirmed tracker with no URL, and announces the gap', () => {
    const result = composeAdoption(
      input({
        proposal: showing('jenkins'),
        answers: answers({ tracker: 'jira' }),
      }),
    );
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(valueOf(result, 'Tracker')).toBe('jira');
    expect(result.keys.find((k) => k.key === 'Tracker')?.evidence).toBe('');
    expect(result.gaps).toEqual([
      'Tracker: jira carries no base URL — issue operations answer unaskable until one is added',
    ]);
  });
});

describe('composeAdoption — the CI key', () => {
  it('writes the system the collector named, whatever it is', () => {
    // THE RULE KNOWS NO VENDOR, and the third name below is what proves it: no
    // list here admits it, and it still becomes a key. `ciKey` branched on two
    // vendor names when it was first written and the *domain names no vendor*
    // gate refused it — a rule that knows which systems exist needs editing when
    // the next one arrives.
    for (const named of ['jenkins', 'github-actions', 'buildkite'] as const) {
      const result = composeAdoption(input({ proposal: showing(named) }));
      if (isAdoptionRefusal(result)) throw new Error(result.detail);
      expect(valueOf(result, 'CI')).toBe(named);
      expect(result.keys.find((k) => k.key === 'CI')?.evidence).toBe(`evidence for ${named}`);
      expect(result.gaps).toEqual([]);
    }
  });

  it('writes no key on two signals, and never tie-breaks on the host', () => {
    const result = composeAdoption(input({ proposal: showing('jenkins', 'github-actions') }));
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(result.keys.map((k) => k.key)).not.toContain('CI');
    expect(result.gaps[0]).toContain('two CI systems left evidence');
    expect(result.gaps[0]).toContain('the git host does not decide');
  });

  it('separates `none` from a reading nobody took', () => {
    const none = composeAdoption(input({ proposal: showing() }));
    if (isAdoptionRefusal(none)) throw new Error(none.detail);
    expect(none.gaps).toEqual(['no CI key written — no CI evidence in the tree']);

    const notRead = composeAdoption(input({ proposal: unread() }));
    if (isAdoptionRefusal(notRead)) throw new Error(notRead.detail);
    expect(notRead.gaps).toEqual(['no CI key written — the CI system was not read']);
  });

  it('reads a proposal that carries no `ci` at all as not read', () => {
    // NOT DEAD CODE. `/plot-adopt` takes a proposal the caller already has, so
    // a client that never asked about CI sends an object with no `ci` field —
    // measured by `adopt.test.ts`'s own wire fixture. Absent and `null` are one
    // answer, and neither may read as *no CI evidence in the tree*.
    const { ci: _dropped, ...withoutCi } = bare();
    const result = composeAdoption(input({ proposal: withoutCi as StackProposal }));
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(result.gaps).toEqual(['no CI key written — the CI system was not read']);
  });

  it('takes a confirmed answer over every reading', () => {
    const result = composeAdoption(
      input({
        proposal: showing('jenkins', 'github-actions'),
        answers: answers({ ci: 'jenkins' }),
      }),
    );
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(valueOf(result, 'CI')).toBe('jenkins');
    expect(result.gaps).toEqual([]);
  });
});

describe('composeAdoption — the worktree root and its ignore line', () => {
  it('proposes `.worktrees` with the matching ignore line', () => {
    const result = composeAdoption(input());
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(valueOf(result, 'Worktree root')).toBe(DEFAULT_WORKTREE_ROOT);
    expect(result.ignoreLine).toBe('.worktrees/');
  });

  it('keeps a repository’s own convention and ignores that instead', () => {
    const result = composeAdoption(input({ answers: answers({ worktreeRoot: 'trees/' }) }));
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(valueOf(result, 'Worktree root')).toBe('trees/');
    expect(result.ignoreLine).toBe('trees/');
  });

  it('writes no ignore line for a root outside the repository', () => {
    const result = composeAdoption(input({ answers: answers({ worktreeRoot: '/srv/desks' }) }));
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(result.ignoreLine).toBe('');
  });
});

describe('composeAdoption — the commit style', () => {
  it('records a proposed notation with its count', () => {
    const result = composeAdoption(
      input({
        proposal: proposeStack({
          nodeVersion: 'v24.20.0',
          nodeFloor: 24,
          commitStyleCounts: { colon: 0, dash: 0, conventional: 44 },
          ticketPrefix: '',
          ticketPrefixCount: 0,
          subjectsRead: 80,
          germanWordCount: 0,
          hasHubDoc: true,
                  ciSignals: null,
                  ciHost: '',
                  instanceKeyedCi: '',
        }),
      }),
    );
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(valueOf(result, 'Commit style')).toBe('conventional');
    expect(result.keys.find((k) => k.key === 'Commit style')?.evidence).toBe('44 of 80 subjects');
  });

  it('writes no key where no count cleared the rule’s threshold', () => {
    const result = composeAdoption(input());
    if (isAdoptionRefusal(result)) throw new Error(result.detail);
    expect(result.keys.map((k) => k.key)).not.toContain('Commit style');
  });
});

describe('ignoreLineFor', () => {
  it('normalises a trailing slash so the line is written once', () => {
    expect(ignoreLineFor('.worktrees')).toBe('.worktrees/');
    expect(ignoreLineFor('.worktrees//')).toBe('.worktrees/');
  });

  it('answers `’’` for an absolute root, which needs no rule', () => {
    expect(ignoreLineFor('/var/plot/desks')).toBe('');
  });
});
