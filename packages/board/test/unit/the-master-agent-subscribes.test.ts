// The master agent subscribes with a purpose and acts on what it hears.
//
// **A REAL CHANNEL AND NO SERVER.** The socket is a unix path under a temp
// directory, not a port — which is why this belongs in the parallel project:
// `parallel-project-takes-no-resource.test.ts` gates the directory on
// `startServer` and `chromium`, and a filesystem socket contends for neither.
//
// **THIS IS WHERE THE PROCESS BOUNDARY IS ASSERTED.** The controller's own
// tests hand it findings as values; what cannot be seen there is that a finding
// published on the wire reaches the act at all, and that the channel
// REPUBLISHING one does not open a second PR. Both claims cross the socket.
import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hostFixture, refsFixture, startChannel, type RunningChannel } from '@plot-pm/domain/adapters';
import type { Finding, PrCreateRequest } from '@plot-pm/domain';

import { actOnFindings, type ActingAgent } from '../../src/server/entry/act.js';
import type { ActingPorts } from '../../src/server/controllers/acting.js';

const BRANCH = 'feature/the-domain-agrees-with-production';

const finding = (over: Partial<Finding> = {}): Finding => ({
  monitor: 'AgentMonitor',
  branch: BRANCH,
  worktree: '/w/agrees',
  finding: 'owes a review',
  since: '2026-08-30T09:00:00Z',
  evidence: '4 commits, tests green, no PR',
  measuredAt: '2026-08-30T09:05:00Z',
  ...over,
});

/** A monitor connecting, publishing, and leaving. */
const publish = async (address: string, f: Finding): Promise<void> => {
  const socket: Socket = connect(address);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  socket.write(`${JSON.stringify({ type: 'publish', finding: f })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  socket.destroy();
};

const until = async (holds: () => boolean, ms = 3000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const socketPath = (): string => join(mkdtempSync(join(tmpdir(), 'plot-act-')), 'c.sock');

let channel: RunningChannel | undefined;
const agents: ActingAgent[] = [];

afterEach(async () => {
  for (const agent of agents.splice(0)) agent.close();
  await channel?.stop();
  channel = undefined;
});

/** Ports whose every `prCreate` is recorded, and a branch that fails no gate. */
const ports = (): { ports: ActingPorts; opened: PrCreateRequest[] } => {
  const opened: PrCreateRequest[] = [];
  return {
    opened,
    ports: {
      host: hostFixture({ opened }),
      refs: refsFixture({ changedFiles: { [BRANCH]: ['.changeset/x.md'] } }),
    },
  };
};

describe('an `owes a review` finding results in a PR without a person asking', () => {
  it('opens one for a finding published after it subscribed', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    const { ports: p, opened } = ports();

    const agent = actOnFindings(p, { address });
    agents.push(agent);
    await until(() => channel!.subscriberCount() === 1);
    await publish(address, finding());
    await until(() => opened.length > 0);

    expect(opened[0].head).toBe(BRANCH);
    expect(opened[0].body).toContain('4 commits, tests green, no PR');
  });

  // THE WELCOME CARRIES CURRENT STATE, not a replay — which is what makes a
  // late subscriber useful. Both measured stalls had been finished for minutes
  // before anybody looked.
  it('opens one for a debt that was already true when it joined', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    await publish(address, finding());
    const { ports: p, opened } = ports();

    agents.push(actOnFindings(p, { address }));
    await until(() => opened.length > 0);

    expect(opened).toHaveLength(1);
  });
});

// THE IDEMPOTENCE CLAUSE, ACROSS THE WIRE. The channel republishes and the
// finding holds until the PR appears, so an act firing per MESSAGE opens a PR
// a minute until somebody notices.
describe('a second finding for the same branch opens nothing', () => {
  it('opens once however many times the finding is published', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    const { ports: p, opened } = ports();

    // `everything`, so the subscription is not ended by the first finding and
    // keeps hearing the republished ones — the shape that could open a PR a
    // minute, asserted against.
    agents.push(actOnFindings(p, { address, branch: '' }));
    await until(() => channel!.subscriberCount() === 1);
    for (let i = 0; i < 5; i++) {
      await publish(address, finding({ measuredAt: `2026-08-30T09:0${i}:00Z` }));
    }
    await until(() => opened.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(opened).toHaveLength(1);
  });

  it('opens nothing at all when the branch already has a PR', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    const opened: PrCreateRequest[] = [];
    const p: ActingPorts = {
      host: hostFixture({
        opened,
        prs: [
          {
            number: 9, repo: '', head: BRANCH, state: 'OPEN', mergedAt: null, mergeCommit: '',
            draft: false, mergeable: 'unknown', review: '', checks: 'unknown', failingChecks: [],
            url: '',
          },
        ],
      }),
      refs: refsFixture({}),
    };

    const agent = actOnFindings(p, { address });
    agents.push(agent);
    await until(() => channel!.subscriberCount() === 1);
    await publish(address, finding());
    await until(() => agent.outcomes().length > 0);

    expect(opened).toHaveLength(0);
    expect(agent.outcomes()[0].decision.act).toBe('nothing');
  });
});

// THE MONITORS THEMSELVES STILL ACT ON NOTHING. The action belongs to the agent
// reading the channel, and keeping the watcher inert is what lets it run
// unsupervised. Asserted by the channel: nothing on its side writes.
describe('nothing else acts on anything', () => {
  it('opens nothing for the other nine findings', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    const { ports: p, opened } = ports();

    const agent = actOnFindings(p, { address, branch: '' });
    agents.push(agent);
    await until(() => channel!.subscriberCount() === 1);
    for (const name of ['idle', 'gone', 'owes an answer', 'owes a gate',
      'holds unlanded work', 'build passed', 'build failed', 'build needs approval',
      'head moved'] as const) {
      await publish(address, finding({ finding: name, monitor: 'WorkerMonitor' }));
    }
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(opened).toHaveLength(0);
  });

  it('leaves the channel holding findings and nothing else', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    const { ports: p } = ports();

    agents.push(actOnFindings(p, { address }));
    await until(() => channel!.subscriberCount() === 1);
    await publish(address, finding());
    await until(() => channel!.findings().length > 0);

    expect(channel.findings()).toHaveLength(1);
    expect(channel.findings()[0].finding).toBe('owes a review');
  });
});
