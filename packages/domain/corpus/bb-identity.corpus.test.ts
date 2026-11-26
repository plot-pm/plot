import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { bbLineIsOther } from '../src/rules/stack.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * A RULE-VERSUS-SHELL COMPARISON: does `bbLineIsOther` refuse the `bb --version`
 * lines `bb_identity_check` refuses?
 *
 * `plot-host.sh` runs `bb_identity_check` before its first `bb` call of every
 * run, so the shell keeps its copy of the test, and `proposeBbCli` reads the
 * same line at adoption. The shell side is the SHIPPED function: its text is
 * read out of `plot-host.sh` and run against a stub `bb` on `PATH` that prints
 * each line. The script is not sourced, because sourcing it runs its dispatch.
 *
 * NEITHER SIDE IS AUTHORITATIVE. On a disagreement the branch stops, and
 * adjusting either side to make this pass is the one move forbidden.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST_SH = `${ROOT}/skills/plot/scripts/plot-host.sh`;

const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

/** Every version line either side has to tell apart. */
const LINES: readonly string[] = [
  'bb 1.15.1 (quatico-bb — brew install quatico-solutions/tap/quatico-bb)',
  'bb 1.13.0 (quatico-bb — brew install quatico-solutions/tap/quatico-bb)',
  'bb 1.12.1',
  'bb 1.12.0',
  'bb version 1.9.0',
  'bb 1.0.0',
  'bb version 0.6.0 (abc1234)',
  'bb version 0.5.2 (deadbeef0123)',
  '',
];

/**
 * The text of one shell function, from its `name() {` line to its closing `}`.
 *
 * @param source the script's text.
 * @param name the function's name.
 * @returns the definition, or `''` where the script defines no such function.
 */
const functionText = (source: string, name: string): string => {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${name}() {`));
  if (start === -1) return '';
  if (lines[start]!.trimEnd().endsWith('}')) return lines[start]!;
  const end = lines.findIndex((line, i) => i > start && line === '}');
  return lines.slice(start, end + 1).join('\n');
};

const source = readFileSync(HOST_SH, 'utf8');
const definitions = ['bb_strip_ansi', 'die3', 'bb_identity_check'].map((name) => functionText(source, name));

const stubDir = mkdtempSync(join(tmpdir(), 'plot-bb-identity-'));
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

/**
 * Whether the shipped `bb_identity_check` refuses a `bb` that prints `line`.
 *
 * @param line the first line the stub `bb` prints for `--version`.
 * @returns true where the check exits non-zero.
 */
const shellRefuses = (line: string): boolean => {
  writeFileSync(join(stubDir, 'line'), line === '' ? '' : `${line}\n`);
  writeFileSync(join(stubDir, 'bb'), `#!/bin/sh\ncat '${join(stubDir, 'line')}'\n`);
  chmodSync(join(stubDir, 'bb'), 0o755);
  const script = [
    'failed_code() { echo 3; }',
    ...definitions,
    'bb_identity_check',
  ].join('\n');
  try {
    execFileSync('bash', ['-c', script], {
      env: { ...process.env, PATH: `${stubDir}:/usr/bin:/bin` },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return false;
  } catch {
    return true;
  }
};

describe('bb identity — rule against shell', () => {
  it('reads every function it compares from plot-host.sh', () => {
    expect(definitions.every((text) => text !== '')).toBe(true);
  });

  it('tells Quatico’s bb from another on every line, as bb_identity_check does', () => {
    const found: Disagreement[] = [];
    for (const line of LINES) {
      compareField(found, JSON.stringify(line), 'other', bbLineIsOther(line), shellRefuses(line));
    }
    expect(found.map(report)).toEqual([]);
  });
});
