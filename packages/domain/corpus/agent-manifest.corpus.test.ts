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

/**
 * THE SECOND DECLARED DUPLICATE (#1373): `agentsFs(...).register` and
 * `@plot-pm/fleet`'s `writeDeskManifest` (`packages/fleet/src/shared/manifest-stamp.ts`)
 * both write a fresh manifest naming a desk no manifest names yet.
 *
 * `writeDeskManifest` cannot be imported here directly — `@plot-pm/fleet`
 * depends on `@plot-pm/domain`, never the other way, and this package's own
 * layering rule (`controller → domain → port ← adapter`) holds even inside a
 * test file. So it runs the way the shell side already does: as a separate
 * process, invoked through `node`'s own ESM resolution hook rather than a
 * static `import`. The hook rewrites only RELATIVE `./foo.js` specifiers to
 * `./foo.ts` — `manifest-stamp.ts` names its siblings that way, matching the
 * source's own `.js`-suffixed relative imports — and leaves bare specifiers
 * (`@plot-pm/domain/...`) to Node's normal workspace resolution, which already
 * finds them through the symlinks `pnpm install` wrote.
 *
 * Two fields never line up and are deliberately left out of the comparison:
 * `session` (each side mints its own, and {@link writeDeskManifest} never
 * takes one as input — only its UUID SHAPE is checked, as `startedAt` already
 * is above) and `loop`/`slug` (fields `writeDeskManifest` writes that
 * `register` has no equivalent for — `register` names a fresh dispatch,
 * `writeDeskManifest` a continuation naming its own loop implementation).
 */
const FLEET_SIDES: Sides = { left: 'register', right: 'writeDeskManifest' };
const fleetReport = describingAs(FLEET_SIDES);

const resolverHookModule =
  'data:text/javascript,' +
  encodeURIComponent(
    [
      'export async function resolve(specifier, context, nextResolve) {',
      "  if (specifier.startsWith('.') && specifier.endsWith('.js')) {",
      "    try { return await nextResolve(specifier.replace(/\\.js$/, '.ts'), context); } catch {}",
      '  }',
      '  return nextResolve(specifier, context);',
      '}',
    ].join('\n'),
  );

/** Runs `writeDeskManifest` in a fresh process and returns the manifest it wrote. */
const fleetWrite = (
  dir: string,
  fields: { worktree: string; branch: string; command: string; resumeId: string },
): Record<string, unknown> => {
  const manifestStampPath = path.resolve(here, '../../fleet/src/shared/manifest-stamp.ts');
  const script = [
    `import { register } from 'node:module';`,
    `register(${JSON.stringify(resolverHookModule)}, import.meta.url);`,
    `const { writeDeskManifest } = await import(${JSON.stringify(manifestStampPath)});`,
    `const file = writeDeskManifest(${JSON.stringify(dir)}, ${JSON.stringify(fields)});`,
    `if (file === null) throw new Error('writeDeskManifest returned null');`,
    `process.stdout.write(file);`,
  ].join('\n');
  const file = execFileSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: path.resolve(here, '../../..'),
  }).trim();
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
};

const FLEET_CASES: ReadonlyArray<{ name: string; branch: string; command: string; resumeId: string }> = [
  { name: 'a plain command', branch: 'feature/x', command: 'plot-worker-loop.sh', resumeId: 'resume-abc' },
  { name: 'a free agent with no branch', branch: '', command: 'plot-worker-loop.sh', resumeId: 'resume-def' },
  { name: 'an empty resumeId — a fresh session', branch: 'bug/y', command: 'claude -p', resumeId: '' },
];

describe('register against writeDeskManifest', () => {
  it('writes the same fields, for every case except session, loop and slug', async () => {
    const disagreements: Disagreement[] = [];
    for (const one of FLEET_CASES) {
      const dir = mkdtempSync(path.join(tmpdir(), 'plot-manifest-fleet-corpus-'));
      made.push(dir);
      const worktree = '/estate/.worktrees/feature-x';
      const session = '1b7e2d63-ab4f-5e2c-9b88-3f5da6e2b321';

      const fleet = fleetWrite(dir, { worktree, branch: one.branch, command: one.command, resumeId: one.resumeId });
      const registered = await agentsFs(
        { repoRoot: dir, scriptDir: dir },
        { manifestDir: dir },
      ).register({ session, branch: one.branch, worktree, command: one.command, resumeId: one.resumeId });
      expect(registered.ok).toBe(true);
      const ours = JSON.parse(readFileSync(path.join(dir, `${session}.json`), 'utf8')) as Record<string, unknown>;

      const SHARED_KEYS = ['resumeId', 'branch', 'worktree', 'command', 'pid', 'attempts'];
      for (const key of SHARED_KEYS) {
        compareField(disagreements, one.name, key, ours[key], fleet[key]);
      }
      compareField(disagreements, one.name, 'startedAt shape', STARTED.test(String(ours.startedAt)), true);
      // `writeDeskManifest` writes `new Date().toISOString()` unrounded — unlike
      // `register`, which strips the milliseconds `STARTED` above requires none
      // of. Full ISO-8601 is the field it actually promises, so that is what is
      // checked here rather than reusing `STARTED` and reporting a false
      // disagreement on every run.
      const FLEET_STARTED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      compareField(disagreements, one.name, 'startedAt shape (fleet)', FLEET_STARTED.test(String(fleet.startedAt)), true);
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      compareField(disagreements, one.name, 'session shape (fleet)', UUID.test(String(fleet.session)), true);
    }
    expect(disagreements.map(fleetReport)).toEqual([]);
  });
});
