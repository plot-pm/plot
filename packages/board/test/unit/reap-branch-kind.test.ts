import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answered, failed } from '@plot-pm/domain';
import type { Host, HostRefusal, Trees } from '@plot-pm/domain';
import { runBranchKind, type Context } from '../../src/server/entry/reap.js';

/**
 * What the branch kind keeps when the host's merge answer is degraded rather
 * than genuinely "not merged" — an `unknown` answer, or a failed call whose
 * refusal names why. Neither case may read as "unlanded work": that reason is
 * reserved for a host that affirmatively found no merged PR.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'reap-branch-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const hostAnswering = (prMerged: Host['prMerged'], lastRefusal: () => HostRefusal | null = () => null): Host =>
  ({ prMerged, prMergedHeads: async () => answered([]), lastRefusal }) as unknown as Host;

const ctxFor = (host: Host): Context =>
  ({
    repoRoot: root,
    invokedFrom: root,
    scriptDir: '/nowhere',
    refs: {
      listBranches: async () => answered(['feature/x']),
      contains: async () => answered('no'),
      resolve: async () => failed(),
      commitSubjects: async () => answered([]),
    },
    host,
    scripts: {},
    trees: { list: async () => answered([]), deleteBranch: async () => answered(undefined) } as unknown as Trees,
    processes: {},
    fetch: async () => undefined,
  }) as unknown as Context;

const reapArgs = { dryRun: true, yes: false, max: 0, sweepTemp: false };
const dryRunMode = { kind: 'dry-run' as const };

const reapOutput = async (ctx: Context): Promise<string> => {
  const lines: string[] = [];
  await runBranchKind(ctx, reapArgs, dryRunMode, 'main', (s) => lines.push(s));
  return lines.join('');
};

describe('runBranchKind — a degraded host answer is never "unlanded work"', () => {
  it('keeps a branch the host answered unknown, naming the host as why', async () => {
    const out = await reapOutput(ctxFor(hostAnswering(async () => answered('unknown'))));

    expect(out).toContain('keep');
    expect(out).toContain('the host could not answer');
    expect(out).not.toMatch(/unlanded work/);
  });

  it('keeps a branch whose host call failed with kind "throttled", naming the rate limit', async () => {
    const out = await reapOutput(
      ctxFor(hostAnswering(async () => failed(), () => ({ kind: 'throttled', said: 'rate limit exceeded' }))),
    );

    expect(out).toContain('keep');
    expect(out).toContain('the host could not answer, rate-limited');
    expect(out).not.toMatch(/unlanded work/);
  });

  it('keeps a branch whose host call failed with kind "secondary" as rate-limited too', async () => {
    const out = await reapOutput(
      ctxFor(hostAnswering(async () => failed(), () => ({ kind: 'secondary', said: 'secondary rate limit' }))),
    );

    expect(out).toContain('the host could not answer, rate-limited');
  });

  it('keeps a branch whose host call failed with kind "failed" as an unknown answer', async () => {
    const out = await reapOutput(
      ctxFor(hostAnswering(async () => failed(), () => ({ kind: 'failed', said: 'dial tcp: connection refused' }))),
    );

    expect(out).toContain('the host could not answer');
    expect(out).not.toContain('rate-limited');
    expect(out).not.toMatch(/unlanded work/);
  });

  it('still reports a genuine not-merged answer as unlanded work', async () => {
    const out = await reapOutput(ctxFor(hostAnswering(async () => answered('not-merged'))));

    expect(out).toContain('keep');
    expect(out).toMatch(/unlanded work/);
  });
});
