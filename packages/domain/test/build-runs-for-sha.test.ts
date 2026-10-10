import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { buildActions } from '../src/adapters/build/build-actions.js';
import { buildFixture } from '../src/adapters/build/build-fixture.js';
import { buildJenkins, jenkinsConclusion } from '../src/adapters/build/build-jenkins.js';
import { foldRuns } from '../src/rules/default-branch.js';
import { buildNone } from '../src/adapters/build/build-none.js';
import type { ShellContext } from '../src/adapters/scripts.js';

const roots: string[] = [];

/** A context whose `plot-host.sh` is the given body, as `build-shell.test.ts` builds one. */
const hostThat = (body: string): ShellContext => {
  const root = mkdtempSync(join(tmpdir(), 'plot-runs-for-sha-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return { repoRoot: root, scriptDir };
};

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const SHA = 'a'.repeat(40);

describe('buildActions.runsForSha', () => {
  it('asks `runs-for-sha <branch> <sha>` and reads every entry', async () => {
    const listing = JSON.stringify([
      { sha: SHA, workflow: 'lint', status: 'completed', conclusion: 'success', url: 'u1', startedAt: 't1' },
      { sha: SHA, workflow: 'test', status: 'in_progress', conclusion: null, url: 'u2', startedAt: 't2' },
    ]);
    const context = hostThat(`[ "$1 $2 $3" = "runs-for-sha main ${SHA}" ] && printf '%s' '${listing}' || exit 9`);
    const result = await buildActions(context).runsForSha('main', SHA);
    expect(result).toEqual({
      ok: true,
      value: [
        { sha: SHA, workflow: 'lint', status: 'completed', conclusion: 'success', url: 'u1', startedAt: 't1' },
        { sha: SHA, workflow: 'test', status: 'in_progress', conclusion: null, url: 'u2', startedAt: 't2' },
      ],
    });
  });

  it('reads an empty array as an answer: CI has not reached the commit', async () => {
    const result = await buildActions(hostThat(`printf '[]'`)).runsForSha('main', SHA);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('reads exit 4 as unaskable', async () => {
    const result = await buildActions(hostThat('exit 4')).runsForSha('main', SHA);
    expect(result).toEqual({ ok: false, why: 'unaskable' });
  });

  it('reads any other failing exit as failed', async () => {
    const result = await buildActions(hostThat('exit 1')).runsForSha('main', SHA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toBe('failed');
  });
});

describe('Jenkins word mapping', () => {
  it.each([
    ['SUCCESS', 'success'],
    ['FAILURE', 'failure'],
    ['UNSTABLE', 'failure'],
    ['ABORTED', 'cancelled'],
    ['NOT_BUILT', 'unknown'],
    [null, null],
  ] as const)('%s becomes %s', (word, mapped) => {
    expect(jenkinsConclusion(word)).toBe(mapped);
  });

  it.each([
    ['SUCCESS', 'success'],
    ['FAILURE', 'failure'],
    ['UNSTABLE', 'failure'],
    ['ABORTED', 'cancelled'],
    ['NOT_BUILT', 'unknown'],
  ] as const)('the connector maps a %s build to %s', async (word, mapped) => {
    const listing = JSON.stringify([{ sha: SHA, status: 'completed', conclusion: word, url: 'u', startedAt: 't' }]);
    const result = await buildJenkins(hostThat(`printf '%s' '${listing}'`)).runsForSha('main', SHA);
    expect(result.ok && result.value.map((r) => r.conclusion)).toEqual([mapped]);
  });

  it('folds a failed build and its later green rebuild of one commit to the rebuild', async () => {
    // The failed build is listed FIRST and started EARLIER: taking runs as
    // given, or the first of them, answers FAILURE.
    const listing = JSON.stringify([
      { sha: SHA, status: 'completed', conclusion: 'FAILURE', url: 'u41', startedAt: '2026-10-10T09:00:00Z' },
      { sha: SHA, status: 'completed', conclusion: 'SUCCESS', url: 'u42', startedAt: '2026-10-10T09:30:00Z' },
    ]);
    const result = await buildJenkins(hostThat(`printf '%s' '${listing}'`)).runsForSha('main', SHA);
    expect(result.ok && result.value.map((r) => r.url)).toEqual(['u42']);
    expect(result.ok && foldRuns(result.value)).toBe('green');
  });

  it('keeps the newest build when Jenkins lists it first', async () => {
    const listing = JSON.stringify([
      { sha: SHA, status: 'completed', conclusion: 'SUCCESS', url: 'u42', startedAt: '2026-10-10T09:30:00Z' },
      { sha: SHA, status: 'completed', conclusion: 'FAILURE', url: 'u41', startedAt: '2026-10-10T09:00:00Z' },
    ]);
    const result = await buildJenkins(hostThat(`printf '%s' '${listing}'`)).runsForSha('main', SHA);
    expect(result.ok && result.value.map((r) => r.url)).toEqual(['u42']);
  });

  it.each([
    ['equal', '2026-10-10T09:00:00Z', '2026-10-10T09:00:00Z'],
    ['empty', '', ''],
  ])('keeps the first-listed build where startedAt is %s', async (_name, first, second) => {
    const listing = JSON.stringify([
      { sha: SHA, status: 'completed', conclusion: 'FAILURE', url: 'u1', startedAt: first },
      { sha: SHA, status: 'completed', conclusion: 'SUCCESS', url: 'u2', startedAt: second },
    ]);
    const result = await buildJenkins(hostThat(`printf '%s' '${listing}'`)).runsForSha('main', SHA);
    expect(result.ok && result.value.map((r) => r.url)).toEqual(['u1']);
  });

  it('keeps a build still running without a conclusion', async () => {
    const listing = JSON.stringify([{ sha: SHA, status: 'in_progress', conclusion: null, url: 'u', startedAt: 't' }]);
    const result = await buildJenkins(hostThat(`printf '%s' '${listing}'`)).runsForSha('main', SHA);
    expect(result.ok && result.value[0].conclusion).toBeNull();
  });
});

describe('the other builds', () => {
  it('buildNone cannot be asked', async () => {
    expect(await buildNone().runsForSha('main', SHA)).toEqual({ ok: false, why: 'unaskable' });
  });

  it('buildFixture answers from values and counts the calls', async () => {
    const seen: string[] = [];
    const run = { sha: SHA, workflow: 'CI', status: 'completed', conclusion: 'failure', url: 'u', startedAt: 't' };
    const port = buildFixture({ workflowRuns: { main: { [SHA]: [run] } }, onRunsForSha: (b, s) => seen.push(`${b}@${s}`) });
    expect(await port.runsForSha('main', SHA)).toEqual({ ok: true, value: [run] });
    expect(await port.runsForSha('main', 'other')).toEqual({ ok: true, value: [] });
    expect(seen).toEqual([`main@${SHA}`, 'main@other']);
  });

  it('buildFixture told to fail answers failed', async () => {
    const result = await buildFixture({ fails: true }).runsForSha('main', SHA);
    expect(result.ok).toBe(false);
  });
});
