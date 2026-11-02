import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HARNESS_START_REFUSALS } from '../src/adapters/harness/limit-lines.js';
import { failedStart } from '../src/rules/failed-start.js';

const patterns = HARNESS_START_REFUSALS.claude;
const refused = readFileSync(join(__dirname, 'fixtures', 'fixer-start-refused.txt'), 'utf8');

describe('failedStart', () => {
  it('reads the live fixer log as a refused start and names the sentence', () => {
    expect(failedStart({ status: 1, output: refused }, patterns)).toEqual({ failed: true, line: "--agent 'fixer' not found." });
  });

  it.each(['fixer', 'main-repair', 'reviewer'])('reads a refusal of the %s role as a failed start', (role) => {
    const output = refused.replace(/--agent 'fixer'/g, `--agent '${role}'`);
    expect(failedStart({ status: 1, output, }, patterns)).toEqual({ failed: true, line: `--agent '${role}' not found.` });
  });

  it('reads an unobserved status as the output alone', () => {
    expect(failedStart({ status: null, output: refused }, patterns).failed).toBe(true);
  });

  it('does not read a non-zero tail without the line as a failed start', () => {
    const output = 'turn 59 done\nError: the session crashed\n';
    expect(failedStart({ status: 1, output }, patterns)).toEqual({ failed: false });
  });

  it('does not read an exit of 0 as a failed start', () => {
    expect(failedStart({ status: 0, output: refused }, patterns)).toEqual({ failed: false });
  });

  it('does not read a refusal line an earlier run left behind a later run', () => {
    expect(failedStart({ status: 1, output: `${refused}\nturn 1\nturn 2\n` }, patterns)).toEqual({ failed: false });
  });

  it('does not read empty output, a harness with no patterns, or a half-matching line', () => {
    expect(failedStart({ status: 1, output: '\n\n' }, patterns)).toEqual({ failed: false });
    expect(failedStart({ status: 1, output: refused }, undefined)).toEqual({ failed: false });
    expect(failedStart({ status: 1, output: "--agent 'fixer' is busy" }, patterns)).toEqual({ failed: false });
    expect(failedStart({ status: 1, output: "--agent 'fixer' not found." }, patterns)).toEqual({ failed: false });
  });
});
