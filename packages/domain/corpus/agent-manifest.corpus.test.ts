import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { agentsFs } from '../src/adapters/agents/agents-fs.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * THE DECLARED DUPLICATE: `agentsFs(...).register` and the dispatcher's
 * `write_agent_manifest` write one manifest format.
 *
 * The supervisor registers a fresh agent for a desk whose manifest the exit
 * trap removed, and no shell survives to call the dispatcher's function, so
 * the adapter writes its own copy. Neither side is authoritative: this test
 * says they agree, field by field, and a disagreement stops the branch rather
 * than being adjusted on either side. The dispatcher carries no pointer to
 * this file, because a comment there would grow the shell past the line ratchet.
 *
 * The shell functions are extracted from the script by name and run in bash,
 * so the comparison is against the real writer and not a copy of it.
 */
const SIDES: Sides = { left: 'register', right: 'shell' };
const report = describingAs(SIDES);

const here = path.dirname(new URL(import.meta.url).pathname);
const dispatcher = path.resolve(here, '../../../skills/plot/scripts/plot-dispatch.sh');

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** The text of one top-level shell function, from its `name() {` line to its closing `}`. */
const functionText = (script: string, name: string): string => {
  const lines = script.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${name}() {`));
  if (start === -1) throw new Error(`${name} is not defined in plot-dispatch.sh`);
  const end = lines.findIndex((line, i) => i > start && line === '}');
  return lines.slice(start, end + 1).join('\n');
};

const shellWrite = (dir: string, session: string, branch: string, worktree: string, command: string): string => {
  const script = readFileSync(dispatcher, 'utf8');
  const out = path.join(dir, 'shell.json');
  execFileSync(
    'bash',
    [
      '-c',
      `${functionText(script, 'json_escape')}\n${functionText(script, 'write_agent_manifest')}\nwrite_agent_manifest "$1" "$2" "$3" "$4" "$5"`,
      'bash',
      out,
      session,
      branch,
      worktree,
      command,
    ],
    { encoding: 'utf8' },
  );
  return readFileSync(out, 'utf8');
};

const CASES: ReadonlyArray<{ name: string; branch: string; command: string }> = [
  { name: 'a plain command', branch: 'feature/x', command: 'plot-worker-loop.sh' },
  { name: 'a free agent with no branch', branch: '', command: 'plot-worker-loop.sh' },
  { name: 'quotes and backslashes', branch: 'bug/y', command: 'claude -p "go \\ now"' },
  { name: 'a tab', branch: 'bug/y', command: 'a\tb' },
  { name: 'a newline', branch: 'bug/y', command: 'line one\nline two' },
];

const STARTED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

describe('register against write_agent_manifest', () => {
  it('writes the same fields, in the same order, for every case', async () => {
    const disagreements: Disagreement[] = [];
    for (const one of CASES) {
      const dir = mkdtempSync(path.join(tmpdir(), 'plot-manifest-corpus-'));
      made.push(dir);
      const session = '0b6f1c52-9a3e-4d1b-8a77-2f4c9e5d1a10';
      const worktree = '/estate/.worktrees/feature-x';
      const shell = shellWrite(dir, session, one.branch, worktree, one.command);
      const written = await agentsFs({ repoRoot: dir, scriptDir: dir }, { manifestDir: dir }).register({
        session,
        branch: one.branch,
        worktree,
        command: one.command,
      });
      expect(written.ok).toBe(true);
      const ours = readFileSync(path.join(dir, `${session}.json`), 'utf8');

      const a = JSON.parse(ours) as Record<string, unknown>;
      const b = JSON.parse(shell) as Record<string, unknown>;
      compareField(disagreements, one.name, 'keys', Object.keys(a), Object.keys(b));
      for (const key of Object.keys(b).filter((k) => k !== 'startedAt')) {
        compareField(disagreements, one.name, key, a[key], b[key]);
      }
      compareField(disagreements, one.name, 'startedAt shape', STARTED.test(String(a.startedAt)), true);
      compareField(disagreements, one.name, 'startedAt shape (shell)', STARTED.test(String(b.startedAt)), true);
      // THE BYTES, with the one field that is the clock's, so a difference in
      // layout, escaping or the trailing newline is a named disagreement too.
      const norm = (text: string): string => text.replace(/"startedAt": "[^"]*"/, '"startedAt": "T"');
      compareField(disagreements, one.name, 'bytes', norm(ours), norm(shell));
    }
    expect(disagreements.map(report)).toEqual([]);
  });
});
