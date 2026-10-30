import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The corpus tier reads the host with no credential, locally and in CI.
 *
 * `corpus/no-host-token.ts` sets this up before every corpus file. This file
 * proves the setup reached the processes a corpus test spawns: a `plot-host.sh`
 * call answers the way it answers on CI's runner, which has no token. Without
 * this file, a removed `setupFiles` entry leaves every other corpus test green
 * on an operator's machine and the local and CI readings apart again.
 *
 * It does not import the setup file: an import would run the setup and pass
 * with the `setupFiles` entry removed. So it names the variables itself.
 */

/** The variables `gh` reads a token from, and the two that hand a scan host answers. */
const HOST_VARIABLES: readonly string[] = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'PLOT_PR_LISTING',
  'PLOT_TERMINAL_CACHE',
];

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

describe('the corpus tier reads the host with no credential', () => {
  it('removes every token variable and every handed-in host answer', () => {
    const present = HOST_VARIABLES.filter((name) => process.env[name] !== undefined);
    expect(present).toEqual([]);
  });

  it('points gh at an empty config directory', () => {
    const dir = process.env.GH_CONFIG_DIR;
    expect(dir).toBeTruthy();
    expect(readdirSync(dir as string)).toEqual([]);
  });

  it('gets the unauthenticated refusal from plot-host.sh, as CI does', () => {
    // Exit 3 with gh's own login hint is what CI's runner answers: the scan
    // classifies that `unasked`. An operator's login would answer exit 0.
    const run = spawnSync(
      'bash',
      [`${ROOT}/skills/plot/scripts/plot-host.sh`, 'pr-list', '--state', 'open', '--limit', '1'],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PLOT_HOST: 'github', PLOT_BUDGET_OFF: '1' } },
    );
    expect({ status: run.status, stdout: run.stdout }).toEqual({ status: 3, stdout: '' });
    expect(run.stderr).toMatch(/gh auth login|GH_TOKEN/);
  });
});
