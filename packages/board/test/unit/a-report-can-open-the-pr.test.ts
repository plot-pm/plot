// The one act a monitor finding takes, and the clause that stops it repeating.
//
// **NO SERVER AND NO BROWSER**, which is what puts this file in the parallel
// project: `parallel-project-takes-no-resource.test.ts` gates this directory
// against `startServer` and `chromium`, so an acting path that needed either
// could not live here. It does not need either — the controller takes ports and
// the domain takes values.
//
// **THE HOST FIXTURE RECORDS EVERY WRITE**, and that recording IS the
// idempotence assertion. The claim is that a second finding opens NOTHING, and
// the only evidence for it is how many times `prCreate` was attempted; a
// fixture that merely answered would discard exactly the fact under test.
import { describe, it, expect } from 'vitest';
import { hostFixture, refsFixture } from '@plot-pm/domain/adapters';
import type { Finding, PrCreateRequest } from '@plot-pm/domain';

import {
  actOnFinding,
  newActedMemory,
  openGateOf,
  type ActingPorts,
} from '../../src/server/controllers/acting.js';

const BRANCH = 'feature/the-ports-have-adapters';

const finding = (over: Partial<Finding> = {}): Finding => ({
  monitor: 'AgentMonitor',
  branch: BRANCH,
  worktree: '/w/ports',
  finding: 'owes a review',
  since: '2026-08-30T09:00:00Z',
  evidence: 'the branch carries commits, the tree is clean and no PR exists',
  measuredAt: '2026-08-30T09:05:00Z',
  ...over,
});

/** The ports, plus the list every `prCreate` was recorded into. */
const ports = (
  over: {
    prs?: Parameters<typeof hostFixture>[0] extends undefined ? never : NonNullable<Parameters<typeof hostFixture>[0]>['prs'];
    changedFiles?: Record<string, readonly string[]>;
    prCreateFails?: boolean;
  } = {},
): { ports: ActingPorts; opened: PrCreateRequest[] } => {
  const opened: PrCreateRequest[] = [];
  return {
    opened,
    ports: {
      host: hostFixture({ opened, prs: over.prs, prCreateFails: over.prCreateFails }),
      refs: refsFixture({ changedFiles: over.changedFiles ?? { [BRANCH]: ['.changeset/x.md', 'src/a.ts'] } }),
    },
  };
};

describe('an `owes a review` finding results in a PR without a person asking', () => {
  it('opens one', async () => {
    const { ports: p, opened } = ports();

    const outcome = await actOnFinding(p, newActedMemory(), finding());

    expect(outcome.opened).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0].head).toBe(BRANCH);
    expect(outcome.url).not.toBe('');
  });

  it('names the finding and its evidence in the body', async () => {
    const { opened, ports: p } = ports();

    await actOnFinding(p, newActedMemory(), finding());

    expect(opened[0].body).toContain('owes a review');
    expect(opened[0].body).toContain('the branch carries commits, the tree is clean and no PR exists');
    expect(opened[0].title).toBe('The ports have adapters');
  });

  it('opens nothing for a finding that is only a report', async () => {
    const { opened, ports: p } = ports();

    const outcome = await actOnFinding(p, newActedMemory(), finding({ finding: 'idle' }));

    expect(outcome.opened).toBe(false);
    expect(opened).toHaveLength(0);
  });
});

// THE CLAUSE THAT BITES. The finding holds until the PR appears and the channel
// republishes on every interval — an action that fired per MESSAGE rather than
// per STATE would open a PR a minute until somebody noticed.
describe('a second finding for the same branch opens nothing', () => {
  it('opens once for ten identical findings inside one run', async () => {
    const { opened, ports: p } = ports();
    const memory = newActedMemory();

    for (let i = 0; i < 10; i++) await actOnFinding(p, memory, finding());

    expect(opened).toHaveLength(1);
  });

  it('opens nothing when the host already holds a PR', async () => {
    const { opened, ports: p } = ports({
      prs: [
        {
          number: 7, repo: '', head: BRANCH, state: 'OPEN', mergedAt: null, mergeCommit: '',
          draft: false, mergeable: 'unknown', review: '', checks: 'unknown', failingChecks: [],
          url: 'https://example.invalid/pr/7',
        },
      ],
    });

    const outcome = await actOnFinding(p, newActedMemory(), finding());

    expect(outcome.opened).toBe(false);
    expect(opened).toHaveLength(0);
    expect(outcome.decision.act).toBe('nothing');
  });

  // A FAILED WRITE STILL COUNTS AS AN ATTEMPT. `prCreate` may have opened the
  // PR and failed on the way back, so a memory written only on success would
  // let the next message ask again for one that exists.
  it('does not retry a PR whose creation failed', async () => {
    const { opened, ports: p } = ports({ prCreateFails: true });
    const memory = newActedMemory();

    const first = await actOnFinding(p, memory, finding());
    await actOnFinding(p, memory, finding());

    expect(first.opened).toBe(false);
    expect(first.error).toContain(BRANCH);
    expect(opened).toHaveLength(1);
  });
});

// A BRANCH THAT ALSO OWES A GATE STILL GETS ITS PR. Withholding it would leave
// finished work invisible until somebody happens to write the changeset — the
// failure this plan ends, one step later in the process.
describe('the body names any open gate', () => {
  it('opens the PR and names the missing changeset', async () => {
    const { opened, ports: p } = ports({ changedFiles: { [BRANCH]: ['src/a.ts'] } });

    const outcome = await actOnFinding(p, newActedMemory(), finding());

    expect(outcome.opened).toBe(true);
    expect(opened[0].body).toContain('changeset');
    expect(opened[0].body).toContain('Open gate');
  });

  it('says nothing about a gate the branch satisfies', async () => {
    const { opened, ports: p } = ports();

    await actOnFinding(p, newActedMemory(), finding());

    expect(opened[0].body).not.toContain('Open gate');
  });

  // IT DOES NOT WRITE THE MISSING CHANGESET. A changeset says what changed and
  // why it matters; that is a judgement about the work, and an agent guessing
  // produces the `<!--` class of entry this repo is already fixing.
  it('writes no changeset of its own', async () => {
    const { opened, ports: p } = ports({ changedFiles: { [BRANCH]: ['src/a.ts'] } });

    await actOnFinding(p, newActedMemory(), finding());

    expect(opened[0].body).not.toMatch(/^---$/m);
  });

  it('claims no gate it could not measure', async () => {
    const refs = refsFixture({});
    // A fixture with no entry answers `[]`, which is a real empty diff. What
    // must not happen is a claim from a FAILED read, so the rule is asserted
    // where the failure is expressible.
    const gate = await openGateOf(
      { ...refs, changedFiles: async () => ({ ok: false, why: 'failed' }) },
      BRANCH,
    );

    expect(gate).toBe('');
  });
});

// SILENCE IS NEVER PERMISSION. A host that cannot be asked whether a PR exists
// must not be read as one that holds none — that is a PR opened on every
// finding for as long as the token is expired.
describe('an unaskable host opens nothing', () => {
  it('reads a failed lookup as a PR present', async () => {
    const opened: PrCreateRequest[] = [];
    const host = hostFixture({ opened });
    const p: ActingPorts = {
      host: { ...host, prState: async () => ({ ok: false, why: 'failed' }) },
      refs: refsFixture({}),
    };

    const outcome = await actOnFinding(p, newActedMemory(), finding());

    expect(outcome.opened).toBe(false);
    expect(opened).toHaveLength(0);
  });
});
