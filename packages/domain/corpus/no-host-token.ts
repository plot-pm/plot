import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll } from 'vitest';

/**
 * The corpus tier's host environment: no host credential, locally and in CI.
 *
 * CI's `corpus` job sets no `GH_TOKEN`, so every `gh` call a scan makes there
 * fails to authenticate and the scan reads the host as `unasked`. A local run
 * inherits the operator's `gh` login and reads `ok`. A reading that depends on
 * a host answer then passes locally and fails in CI. Measured 2026-10-30:
 * `corpus/eligible.corpus.test.ts` failed on `main` only in CI, because the
 * scan's `host_pr_state --ask` answered `-` there and `OPEN` locally (#2942).
 *
 * This setup file runs before every corpus test file. It removes the token
 * variables `gh` reads and points `GH_CONFIG_DIR` at a new empty directory, so
 * `gh` finds no stored login either (on macOS the login is in the keychain,
 * and `hosts.yml` in the config directory names it). Every child process a
 * corpus test spawns inherits `process.env`, so the scan reads the host the
 * way CI reads it.
 *
 * It also removes the two variables through which a fleet process hands a scan
 * host answers it bought earlier: `PLOT_PR_LISTING` and `PLOT_TERMINAL_CACHE`.
 * CI sets neither.
 *
 * Git is not affected: `git fetch` authenticates through git's own credential
 * helper, and this repository is public.
 */

/** The variables `gh` reads a token from, in its own precedence order. */
const HOST_TOKEN_VARIABLES: readonly string[] = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
];

/** The variables through which a fleet process passes host answers to a scan. */
const HOST_ANSWER_VARIABLES: readonly string[] = ['PLOT_PR_LISTING', 'PLOT_TERMINAL_CACHE'];

for (const name of [...HOST_TOKEN_VARIABLES, ...HOST_ANSWER_VARIABLES]) delete process.env[name];

const emptyConfig = mkdtempSync(join(tmpdir(), 'plot-corpus-gh-'));
process.env.GH_CONFIG_DIR = emptyConfig;

afterAll(() => {
  rmSync(emptyConfig, { recursive: true, force: true });
});
