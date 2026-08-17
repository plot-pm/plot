import { describe, it, expect } from 'vitest';
import {
  PlanMetaSchema, CardSchema, FleetBranchSchema, AgentRowSchema,
} from '../../src/contract/schema';

describe('PlanMetaSchema — waves', () => {
  const base = { file: 'docs/plans/x.md', format: 'canonical', phase: 'approved' };

  it('accepts the waves array emitted by plot-plan-meta.sh', () => {
    const parsed = PlanMetaSchema.parse({
      ...base,
      branches: ['feature/a', 'feature/b'],
      waves: [
        { name: 'Tracer', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] },
        {
          name: 'Implementation',
          branches: [{ branch: 'feature/b', deferred: true, claimed: '2026-08-14T10:22Z, s-3' }],
        },
      ],
    });
    expect(parsed.waves).toHaveLength(2);
    expect(parsed.waves[0].name).toBe('Tracer');
    expect(parsed.waves[1].branches[0].deferred).toBe(true);
    expect(parsed.waves[1].branches[0].claimed).toBe('2026-08-14T10:22Z, s-3');
  });

  it('defaults waves to empty so pre-wave helper output still validates', () => {
    // The board must keep working against an older plot-plan-meta.sh that
    // emits no waves field at all.
    const parsed = PlanMetaSchema.parse({ ...base, branches: ['feature/a'] });
    expect(parsed.waves).toEqual([]);
  });

  it('keeps the flat branches list as the whole set, independent of waves', () => {
    // waves[] groups; branches[] remains the complete, sorted set that existing
    // consumers read. One must never be derived from the other at this layer.
    const parsed = PlanMetaSchema.parse({
      ...base,
      branches: ['feature/a', 'feature/b'],
      waves: [{ name: '', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    expect(parsed.branches).toEqual(['feature/a', 'feature/b']);
  });
});

describe('WaveSummarySchema — plan shape and git occupancy, kept apart', () => {
  const base = {
    slug: 'x', title: 'X', type: 'feature', phase: 'Development', path: 'docs/plans/x.md',
  } as const;

  it('is carried on the card as an optional field', () => {
    // Optional: pre-wave plans and older helper output must still produce a
    // valid card.
    const card = CardSchema.parse({
      ...base,
      waveSummary: { waves: 2, branches: 3, claimed: 1, eligible: 2, deferred: 0 },
    });
    expect(card.waveSummary?.claimed).toBe(1);
    expect(card.waveSummary?.eligible).toBe(2);
    const bare = CardSchema.parse({
      slug: 'y', title: 'Y', type: 'docs', phase: 'Design', path: 'docs/plans/y.md',
    });
    expect(bare.waveSummary).toBeUndefined();
  });

  it('accepts a summary with NO occupancy counts — absent is not zero', () => {
    // The contract's load-bearing case. A card built before the fleet scan
    // landed knows the plan's shape and knows nothing about claims; it must be
    // able to say so. Defaulting these to 0 at the boundary would re-create the
    // exact confusion this schema was changed to remove — a card asserting
    // "nobody is working on this" when it has not looked.
    const card = CardSchema.parse({
      ...base, waveSummary: { waves: 1, branches: 2, deferred: 0 },
    });
    expect(card.waveSummary?.claimed).toBeUndefined();
    expect(card.waveSummary?.eligible).toBeUndefined();
    // Shape survives without git: these come from the plan file and stay true
    // when the scan cannot run at all.
    expect(card.waveSummary?.branches).toBe(2);
  });
});

describe('CardSchema — pull requests', () => {
  const base = { slug: 'x', title: 'X', type: 'feature', path: 'docs/plans/x.md' };

  it('carries each PR as a number plus the host-supplied url', () => {
    const card = CardSchema.parse({
      ...base, phase: 'Endgame',
      prs: [{ number: 113, url: 'https://example.test/pr/113' }],
    });
    expect(card.prs).toEqual([{ number: 113, url: 'https://example.test/pr/113' }]);
  });

  it('accepts a PR with no url — the board renders no link rather than guessing', () => {
    // The host adapter is the only thing that knows a PR's address. Where it
    // reports none (older CLI, PR data not fetched yet), the number stands
    // alone. A URL composed here would be wrong on GitHub Enterprise and on
    // every self-hosted Bitbucket.
    const card = CardSchema.parse({ ...base, phase: 'Development', prs: [{ number: 9 }] });
    expect(card.prs[0]).toEqual({ number: 9, url: '' });
  });

  it('defaults to no PRs, so a plan that names none is not a degraded card', () => {
    const card = CardSchema.parse({ ...base, phase: 'Design' });
    expect(card.prs).toEqual([]);
  });
});

describe('FleetBranchSchema — the worker', () => {
  const base = { branch: 'feature/x', state: 'claimed', deferred: false, claimed: '' };

  it('defaults an absent worker to `elsewhere` — could not look, not "nobody"', () => {
    // A pulse from a scan predating the field must still validate, and the
    // default has to be the value that licenses no claim about a worker either
    // way. `elsewhere` says *this machine has nowhere to look*, which is exactly
    // what a scan that reports nothing means. Defaulting to `none` would assert
    // a local absence the scan never observed.
    const b = FleetBranchSchema.parse(base);
    expect(b.worker).toBe('elsewhere');
    expect(b.worker_pid).toBe('');
    expect(b.worker_exit).toBe('');
  });

  it('keeps all six values, so `failed` and `finished` cannot collapse', () => {
    for (const w of ['running', 'finished', 'failed', 'ended', 'none', 'elsewhere']) {
      expect(FleetBranchSchema.parse({ ...base, worker: w }).worker).toBe(w);
    }
  });

  it('carries the pid as a STRING — an identifier to show, never arithmetic', () => {
    // And "" is the honest rendering of "no pid was recorded", which a number
    // has no room for: 0 is a real-looking pid, and `kill -0 0` succeeds.
    expect(FleetBranchSchema.parse({ ...base, worker_pid: '4242' }).worker_pid).toBe('4242');
  });
});

describe('AgentRowSchema.pr', () => {
  const row = (pr: unknown) => AgentRowSchema.parse({
    repo: 'plot', branch: 'feature/x', plan: 'p', wave: 'One', state: 'wip',
    group: 'waiting-on-you', ageMinutes: 3, note: 'n', pr,
  });

  it('carries the PR condition as fields, not only as a number and a url', () => {
    const parsed = row({
      number: 42, url: 'https://host/pr/42', draft: true, state: 'conflicts',
    });
    expect(parsed.pr).toEqual({
      number: 42, url: 'https://host/pr/42', draft: true, state: 'conflicts',
    });
  });

  it('defaults an older pulse to unknown rather than to clean', () => {
    // A payload written before the field existed cannot claim a state. Absent
    // is not green, and it is not "not a draft that passes" either — `unknown`
    // is the honest reading, the same one Bitbucket gets.
    const parsed = row({ number: 42, url: '' });
    expect(parsed.pr!.state).toBe('unknown');
    expect(parsed.pr!.draft).toBe(false);
  });

  it('rejects a state outside the six', () => {
    // The enum is the contract. A seventh value — `draft`, most temptingly —
    // would rebuild the short-circuit that kept WAITING ON A MACHINE empty.
    expect(() => row({ number: 42, url: '', state: 'draft' })).toThrow();
    expect(() => row({ number: 42, url: '', state: 'merged' })).toThrow();
  });

  it('accepts each of the six states', () => {
    for (const s of ['green', 'pending', 'failing', 'none', 'conflicts', 'unknown']) {
      expect(row({ number: 1, url: '', state: s }).pr!.state).toBe(s);
    }
  });
});
