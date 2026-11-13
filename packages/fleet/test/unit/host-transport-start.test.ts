import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostFixture, type HostReads } from '@plot-pm/domain/adapters';

import { run } from '../../src/server/entry/registryd-main.js';

/** A directory with no estate to read, so `--once` reports and returns. */
const sandbox = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-host-transport-'));
  writeFileSync(join(dir, 'not-a-manifest.json'), '{ this is not json');
  return dir;
};

const startLines = async (seams: { hostReads?: HostReads }): Promise<string[]> => {
  const dir = sandbox();
  try {
    const warnings: string[] = [];
    await run(['--once'], dir, () => {}, async () => {}, () => true, (s) => warnings.push(s), dir, seams);
    return warnings.filter((w) => w.includes('host reads:'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('fleetd names its host transport at start', () => {
  it('logs the in-process transport, its reason and the token source, never a token', async () => {
    const lines = await startLines({
      hostReads: {
        choice: { transport: 'in-process', reason: 'the git host is github', tokenSource: 'gh auth token' },
        api: null,
        host: hostFixture({}),
      },
    });
    expect(lines).toEqual(['plot-fleetd: host reads: in-process (the git host is github; token from gh auth token)\n']);
  });

  it('logs the Bitbucket transport with its credential source, and the Jenkins split', async () => {
    const lines = await startLines({
      hostReads: {
        choice: {
          transport: 'in-process',
          reason: 'the git host is bitbucket; CI is jenkins, so the rich open read stays on the shell',
          tokenSource: 'worktree .env',
        },
        api: null,
        host: hostFixture({}),
      },
    });
    expect(lines).toEqual([
      'plot-fleetd: host reads: in-process (the git host is bitbucket; CI is jenkins, so the rich open read stays on the shell; token from worktree .env)\n',
    ]);
  });

  it('logs the shell and the missing credentials where Bitbucket has none', async () => {
    const lines = await startLines({
      hostReads: {
        choice: { transport: 'shell', reason: 'no credentials: BB_EMAIL and BB_TOKEN are unset', tokenSource: null },
        api: null,
        host: hostFixture({}),
      },
    });
    expect(lines).toEqual(['plot-fleetd: host reads: shell (no credentials: BB_EMAIL and BB_TOKEN are unset)\n']);
  });

  it('logs the shell and PLOT_HOST_TRANSPORT=shell where the switch is set', async () => {
    expect(process.env['PLOT_HOST_TRANSPORT']).toBe('shell');
    const lines = await startLines({});
    expect(lines).toEqual(['plot-fleetd: host reads: shell (PLOT_HOST_TRANSPORT=shell)\n']);
  });
});
