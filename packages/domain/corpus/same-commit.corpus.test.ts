import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { sameCommit } from '../src/rules/same-commit.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * Does `sameCommit` answer what `plot-host.sh`'s Bitbucket pinned `pr-merge`
 * arm answers, over representative sha pairs?
 *
 * THE PAIR EXISTS ON PURPOSE. `plot-host.sh:3963` already carries a comment
 * naming `sameCommit` as the rule it mirrors — Bitbucket's merge endpoint
 * takes no head precondition, so the shell re-reads the head and matches it
 * by prefix itself rather than paying a bundle hop on every merge. NEITHER
 * SIDE IS AUTHORITATIVE: on a disagreement the branch stops, and adjusting
 * either side to make this pass is the one move forbidden.
 *
 * THE COMPARED LOGIC IS EXTRACTED RATHER THAN THE WHOLE `pr-merge` CASE,
 * because that case also shells out to `bb pr view` and `jq` to produce the
 * head sha this logic is handed — machinery this corpus does not need to
 * prove the prefix match itself agrees. The extracted lines are copied
 * verbatim from `plot-host.sh:3963`'s pin-matching expression.
 */

const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

/** One pair of shas handed to both sides, and a name a failure can be read by. */
interface Case {
  name: string;
  a: string;
  b: string;
}

const CASES: Case[] = [
  { name: 'identical 40-character shas', a: 'a'.repeat(40), b: 'a'.repeat(40) },
  { name: '12-character head is a prefix of the 40-character pin', a: '66836536f8c9', b: '66836536f8c9' + 'a'.repeat(28) },
  { name: '40-character pin is a prefix of the 12-character head (reversed)', a: '66836536f8c9' + 'a'.repeat(28), b: '66836536f8c9' },
  { name: 'uppercase head against lowercase pin', a: '66836536F8C9' + 'a'.repeat(28), b: '66836536f8c9' },
  { name: '12-character head does not extend the 40-character pin', a: '66836536f8c9', b: '66836536f8c8' + 'a'.repeat(28) },
  { name: 'moved head, unrelated 40-character shas', a: 'a'.repeat(40), b: 'b'.repeat(40) },
  { name: 'exactly seven hex characters, matching', a: '1234567', b: '1234567' },
  { name: 'six hex characters, too short to pin', a: '123456', b: '123456' },
  { name: 'seven characters but one is not hex', a: '123456g', b: '123456g' },
  { name: 'empty head', a: '', b: 'a'.repeat(40) },
  { name: 'empty pin', a: 'a'.repeat(40), b: '' },
  { name: 'both empty', a: '', b: '' },
];

/**
 * Every case's verdict from the shipped shell expression, in one bash process.
 *
 * ONE PROCESS FOR THE WHOLE CORPUS, not one per case — the expression is a
 * pure comparison, so it is sourced into a loop rather than forked per pair.
 * Lines 2-4 below are copied verbatim from `plot-host.sh:3963`.
 */
const shellVerdicts = (all: readonly Case[]): string[] => {
  const stdin = all.map((one) => `${one.a}\t${one.b}`).join('\n') + '\n';
  const script = `
    while IFS="$(printf '\\t')" read -r head_sha pin; do
      head_l="$(printf '%s' "$head_sha" | tr '[:upper:]' '[:lower:]')"
      pin_l="$(printf '%s' "$pin" | tr '[:upper:]' '[:lower:]')"
      if [[ "$head_l" =~ ^[0-9a-f]{7,}$ && "$pin_l" =~ ^[0-9a-f]{7,}$ ]] && { [[ "$head_l" == "$pin_l"* ]] || [[ "$pin_l" == "$head_l"* ]]; }; then
        printf 'true\\n'
      else
        printf 'false\\n'
      fi
    done
  `;
  const out = execFileSync('bash', ['-c', script], {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  const words = out.split('\n');
  if (words[words.length - 1] === '') words.pop();
  return words;
};

const shell = shellVerdicts(CASES);

describe('sameCommit agrees with plot-host.sh pr-merge Bitbucket pin match', () => {
  it('reads a corpus worth comparing', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(10);
    expect(shell.length).toBe(CASES.length);
    expect(shell.every((word) => word === 'true' || word === 'false')).toBe(true);
  });

  it('exercises both answers, so this is not vacuous', () => {
    const ruled = new Set(CASES.map((one) => sameCommit(one.a, one.b)));
    expect([...ruled].sort()).toEqual([false, true]);
    expect(new Set(shell).size).toBe(2);
  });

  it('answers what the shell answers, on every case', () => {
    const found: Disagreement[] = [];
    CASES.forEach((one, i) => {
      compareField(found, one.name, 'same-commit', sameCommit(one.a, one.b), shell[i] === 'true');
    });
    expect(found.map(report)).toEqual([]);
  });
});
