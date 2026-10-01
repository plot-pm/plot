import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshIssues, freshCacheEntry } from '../../src/server/fleet.js';
import { rmTree } from '../helpers.mjs';

// #1131: the issue poll asks the source the domain names. A declared tracker no
// connector lists is not asked at all, and an adapter that cannot be asked
// hands the board its reason.

const QUATICO = "plot-host: bb 1.9.0 lists no issue command — Quatico bb has none, unlike craftamap/bb — so this repository's issues cannot be read through it; declare the issue tracker with the `Tracker` config key";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmTree(dir);
});

/**
 * A scripts directory whose `plot-config.sh` declares `tracker` and whose
 * `plot-host.sh` records each call in `host.calls`, then exits `exitCode`
 * with `stderr`.
 */
function scripts(tracker: string, exitCode: number, stderr = ''): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-issue-source-'));
  dirs.push(dir);
  const write = (name: string, body: string) => {
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}`);
    fs.chmodSync(path.join(dir, name), 0o755);
  };
  // Single-quoted for bash: the reason carries backticks, which double quotes
  // would run as a command substitution.
  const quoted = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
  // An empty plan directory, so the success path answers rather than failing
  // on plans it cannot read.
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  write('plot-config.sh', `if [ "$2" = Tracker ]; then printf '%s\\n' ${JSON.stringify(tracker)}; else printf '%s\\n' "$3"; fi\n`);
  write('plot-host.sh', `printf '%s\\n' "$*" >> ${JSON.stringify(path.join(dir, 'host.calls'))}\nprintf '%s\\n' ${quoted(stderr)} >&2\nexit ${exitCode}\n`);
  write('plot-plan-meta.sh', 'exit 0\n');
  return dir;
}

const hostCalls = (dir: string): string[] => {
  const file = path.join(dir, 'host.calls');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
};

describe('the issue poll asks the source the domain names', () => {
  it('asks nobody for a declared tracker no connector lists, and says why', async () => {
    const dir = scripts('linear https://linear.app/acme', 0);
    const entry = freshCacheEntry();
    entry.backend = 'bitbucket';

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(hostCalls(dir)).toEqual([]);
    expect(entry.issueAnswer).toBe('unsupported');
    expect(entry.issueError).toBeNull();
    expect(entry.issueAbsence).toBe(
      'Open issues are not listed: no connector lists issues from the declared tracker `linear`, and the git host is not asked in its place',
    );
  });

  it('keeps the adapter’s reason where the git host cannot be asked (exit 4)', async () => {
    const dir = scripts('', 4, QUATICO);
    const entry = freshCacheEntry();
    entry.backend = 'bitbucket';

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(hostCalls(dir)).toEqual(['issue-list --limit 50']);
    expect(entry.issueAnswer).toBe('unsupported');
    expect(entry.issueError).toBeNull();
    expect(entry.issueAbsence).toMatch(/^Open issues are not listed: bb 1\.9\.0 lists no issue command/);
    expect(entry.issueAbsence).not.toMatch(/could not be read/);
  });

  it('asks the adapter where Jira is declared, and clears an earlier absence', async () => {
    const dir = scripts('jira https://acme.atlassian.net', 0);
    const entry = freshCacheEntry();
    entry.backend = 'bitbucket';
    entry.issueAbsence = 'Open issues are not listed: stale';

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(hostCalls(dir)).toHaveLength(1);
    expect(entry.issueAnswer).toBe('answered');
    expect(entry.issueAbsence).toBeNull();
  });
});
