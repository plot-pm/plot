import { describe, it, expect } from 'vitest';
import {
  answer,
  inputFrom,
  itemsFrom,
  run,
  verdict,
} from '../../src/server/entry/release-gate.js';

/**
 * THE GATE WAS PROSE AND IS NOW A REFUSAL.
 *
 * `plot-sprint-release.sh` collected every MoSCoW item's state and decided
 * nothing; `/plot-release` applied the rule in skill text. `workflows/release.ts`
 * held the same rule, tested, and imported by nothing outside the domain
 * package. Each test below asks the wire for a verdict a paragraph used to give.
 *
 * **A release is the one action nobody can undo**, so a `pass` here is only the
 * sprint's answer: the operator still names the version, and nothing in this
 * file tags, writes or pushes.
 */

/** One sprint block as `plot-sprint-release.sh` writes it. */
const report = (
  items: { tier: 'must' | 'should' | 'could'; slug: string; state: string }[],
  release = '2.16.0',
  sprint = 'the-jenkins-team-sees-its-builds',
): string =>
  JSON.stringify({
    sprints: [
      {
        sprint,
        file: `docs/sprints/2026-W39-${sprint}.md`,
        phase: 'Active',
        release,
        must: items.filter((i) => i.tier === 'must').map((i) => ({ slug: i.slug, text: '', checked: false, delivered: false, state: i.state })),
        should: items.filter((i) => i.tier === 'should').map((i) => ({ slug: i.slug, text: '', checked: false, delivered: false, state: i.state })),
        could: items.filter((i) => i.tier === 'could').map((i) => ({ slug: i.slug, text: '', checked: false, delivered: false, state: i.state })),
      },
    ],
  });

const asked = { candidate: false, ignoreSprint: false, unattended: false };

describe('an open Must refuses, naming the item', () => {
  it('refuses and names the plan and its sprint', () => {
    const answered = answer(
      report([{ tier: 'must', slug: 'the-run-ops-ask-the-ci-backend', state: 'open' }]),
      [],
    );
    expect(answered.pass).toBe(false);
    expect(answered.reason).toBe('must-haves-open');
    expect(answered.detail).toContain('the-run-ops-ask-the-ci-backend');
    expect(answered.detail).toContain('the-jenkins-team-sees-its-builds');
  });

  it('names what clears it, so the refusal is actionable', () => {
    const answered = answer(report([{ tier: 'must', slug: 'alpha', state: 'open' }]), []);
    expect(answered.detail).toContain('--ignore-sprint');
  });

  // `disputed` is a checked box over an undelivered plan — /plot-sprint close
  // refuses on exactly this, and a release that read it as finished would be
  // the lenient one of the two.
  it('refuses a disputed Must and says which it is', () => {
    const answered = answer(report([{ tier: 'must', slug: 'beta', state: 'disputed' }]), []);
    expect(answered.pass).toBe(false);
    expect(answered.detail).toContain('checked in the sprint, but the plan is not delivered');
  });

  it('names every open Must, not the first', () => {
    const answered = answer(
      report([
        { tier: 'must', slug: 'alpha', state: 'open' },
        { tier: 'must', slug: 'beta', state: 'disputed' },
      ]),
      [],
    );
    expect(answered.detail).toContain('alpha');
    expect(answered.detail).toContain('beta');
    expect(answered.detail).toContain('2 unfinished');
  });

  it('names the sprint per item, since two teams may share one train', () => {
    const two = JSON.parse(report([])) as { sprints: unknown[] };
    two.sprints = [
      JSON.parse(report([{ tier: 'must', slug: 'alpha', state: 'open' }], '2.16.0', 'one')).sprints[0],
      JSON.parse(report([{ tier: 'must', slug: 'beta', state: 'open' }], '2.16.0', 'two')).sprints[0],
    ];
    const answered = answer(JSON.stringify(two), []);
    expect(answered.detail).toContain('sprint one');
    expect(answered.detail).toContain('sprint two');
  });
});

describe('what does not refuse', () => {
  it('passes a sprint whose Musts are done', () => {
    expect(answer(report([{ tier: 'must', slug: 'alpha', state: 'done' }]), []).pass).toBe(true);
  });

  it('passes a sprint declaring no release target — the majority case', () => {
    expect(
      answer(report([{ tier: 'must', slug: 'alpha', state: 'open' }], ''), []).pass,
    ).toBe(true);
  });

  it('passes an empty report', () => {
    expect(answer('{}', []).pass).toBe(true);
  });

  // The RC is how a sprint's remaining work gets verified, so gating it would
  // take away the tool operators use to finish the very items being gated on.
  it('passes a candidate over an open Must', () => {
    expect(
      answer(report([{ tier: 'must', slug: 'alpha', state: 'open' }]), ['--candidate']).pass,
    ).toBe(true);
  });

  it('passes with --ignore-sprint, the named escape', () => {
    expect(
      answer(report([{ tier: 'must', slug: 'alpha', state: 'open' }]), ['--ignore-sprint']).pass,
    ).toBe(true);
  });

  // A plan somebody decided against is not work the release waits on. Gating on
  // it holds a release forever over work nobody is doing.
  it('passes over a withdrawn Must and names it', () => {
    const answered = answer(report([{ tier: 'must', slug: 'gamma', state: 'withdrawn' }]), []);
    expect(answered.pass).toBe(true);
    expect(answered.withdrawn.join(' ')).toContain('gamma');
  });

  it('names a withdrawn item in any tier', () => {
    const answered = answer(report([{ tier: 'could', slug: 'delta', state: 'withdrawn' }]), []);
    expect(answered.withdrawn.join(' ')).toContain('delta');
  });
});

describe('the tiers below Must', () => {
  // There is no flag for the Should tier, deliberately: a hard gate on stretch
  // goals is one operators learn to force past. The gate reports; the skill asks.
  it('reports an open Should without refusing', () => {
    const answered = answer(report([{ tier: 'should', slug: 'epsilon', state: 'open' }]), []);
    expect(answered.pass).toBe(true);
    expect(answered.openShoulds).toContain('epsilon');
  });

  it('reports a disputed Should among the open ones', () => {
    expect(
      answer(report([{ tier: 'should', slug: 'zeta', state: 'disputed' }]), []).openShoulds,
    ).toContain('zeta');
  });

  it('reports an open Could and neither blocks nor prompts', () => {
    const answered = answer(report([{ tier: 'could', slug: 'eta', state: 'open' }]), []);
    expect(answered.pass).toBe(true);
    expect(answered.openCoulds).toContain('eta');
    expect(answered.openShoulds).toEqual([]);
  });

  it('leaves a done tier empty', () => {
    const answered = answer(
      report([
        { tier: 'should', slug: 'theta', state: 'done' },
        { tier: 'could', slug: 'iota', state: 'done' },
      ]),
      [],
    );
    expect(answered.openShoulds).toEqual([]);
    expect(answered.openCoulds).toEqual([]);
  });
});

describe('reading the collector', () => {
  it('reads a lightweight task that names no plan', () => {
    const items = itemsFrom(report([{ tier: 'must', slug: '', state: 'open' }]));
    expect(items).toHaveLength(1);
    expect(items[0]!.plan).toBe('');
  });

  it('reads an item whose slug is absent as naming no plan', () => {
    const items = itemsFrom(
      JSON.stringify({
        sprints: [{ sprint: 's', release: '2.16.0', must: [{ state: 'open' }] }],
      }),
    );
    expect(items[0]!.plan).toBe('');
  });

  it('reads a tier the collector omitted as empty', () => {
    expect(itemsFrom(JSON.stringify({ sprints: [{ sprint: 's', release: '1.0.0' }] }))).toEqual([]);
  });

  // A status the collector could not produce is not coerced. The permissive
  // direction reports a promise as kept, and a release cut over it stands.
  it('refuses a status this wire does not carry', () => {
    expect(() =>
      itemsFrom(
        JSON.stringify({
          sprints: [{ sprint: 's', release: '1.0.0', must: [{ slug: 'a', state: 'probably' }] }],
        }),
      ),
    ).toThrow(/probably/);
  });

  it('refuses an item carrying no status at all', () => {
    expect(() =>
      itemsFrom(
        JSON.stringify({ sprints: [{ sprint: 's', release: '1.0.0', must: [{ slug: 'a' }] }] }),
      ),
    ).toThrow(/expected done, open, disputed or withdrawn/);
  });

  it('refuses a tier that is not a list', () => {
    expect(() =>
      itemsFrom(JSON.stringify({ sprints: [{ sprint: 's', release: '1.0.0', must: 'all done' }] })),
    ).toThrow(/not a list/);
  });

  it("refuses a 'sprints' that is not a list", () => {
    expect(() => itemsFrom(JSON.stringify({ sprints: 'none' }))).toThrow(/not a list/);
  });

  it('refuses unreadable JSON rather than guessing', () => {
    expect(() => itemsFrom('not json')).toThrow(/could not read the sprint report/);
  });

  it('reads a sprint whose slug is absent', () => {
    const items = itemsFrom(
      JSON.stringify({ sprints: [{ release: '1.0.0', must: [{ slug: 'a', state: 'open' }] }] }),
    );
    expect(items[0]!.sprint).toBe('');
  });

  it('skips a sprint carrying no release field at all', () => {
    expect(
      itemsFrom(JSON.stringify({ sprints: [{ sprint: 's', must: [{ slug: 'a', state: 'open' }] }] })),
    ).toEqual([]);
  });
});

describe('the arguments', () => {
  it('reads each escape off argv', () => {
    expect(inputFrom(['--candidate', '--ignore-sprint', '--unattended'])).toEqual({
      candidate: true,
      ignoreSprint: true,
      unattended: true,
    });
  });

  it('defaults every escape to unused', () => {
    expect(inputFrom([])).toEqual({ candidate: false, ignoreSprint: false, unattended: false });
  });
});

describe('the verdict is asked of the domain', () => {
  it('answers a pass with no reason and no sentence', () => {
    const answered = verdict([], asked);
    expect(answered).toEqual({
      pass: true,
      reason: '',
      detail: '',
      openShoulds: [],
      openCoulds: [],
      withdrawn: [],
    });
  });

  // The version is step 1's question and this gate precedes it. A bundle that
  // reported `version-underivable` would refuse a release the sprint permits.
  it('does not refuse for the version it was never given', () => {
    expect(verdict([], asked).reason).not.toBe('version-underivable');
  });
});

describe('the process', () => {
  it('exits 0 and prints the verdict when the sprint permits', () => {
    const out: string[] = [];
    expect(run(report([]), (s) => out.push(s), [])).toBe(0);
    expect(JSON.parse(out.join('')).pass).toBe(true);
  });

  it('exits 1 and writes the refusal sentence to stderr', () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = run(
      report([{ tier: 'must', slug: 'alpha', state: 'open' }]),
      (s) => out.push(s),
      [],
      (s) => err.push(s),
    );
    expect(code).toBe(1);
    // The verdict is still on stdout, whole: a caller reading the tier lists
    // gets them on a refusal too.
    expect(JSON.parse(out.join('')).reason).toBe('must-haves-open');
    expect(err.join('')).toContain('must-haves-open');
    expect(err.join('')).toContain('alpha');
  });

  // Exit 2 is this script's own bug, not the sprint's state, and no operator
  // can act on it.
  it('exits 2 on an unreadable report and prints nothing to stdout', () => {
    const out: string[] = [];
    const err: string[] = [];
    expect(run('not json', (s) => out.push(s), [], (s) => err.push(s))).toBe(2);
    expect(out).toEqual([]);
    expect(err.join('')).toContain('plot-release-gate');
  });
});
