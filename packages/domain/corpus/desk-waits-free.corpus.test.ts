import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { deskWaitsFree, FREE_WAIT_FILENAME } from '../src/rules/desk-loop-alive.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * A RULE-VERSUS-SHELL COMPARISON: does `deskWaitsFree` answer what
 * `plot-worker-state.sh`'s `plot_worker_waits_free` answers, over every
 * free-wait record text in the corpus below and two pids?
 *
 * THE PAIR EXISTS ON PURPOSE. `plot_worker_state` reads the record once per
 * desk per fleet-scan pass, where a bundle hop would be paid by every desk on
 * every pass, so the shell holds its own copy (`docs/shell-and-domain.md`).
 * NEITHER SIDE IS AUTHORITATIVE: on a disagreement the branch stops.
 *
 * THE CORPUS IS CONSTRUCTED. A free-wait record exists only while a free agent
 * waits, so CI's checkout holds none. Each text is written to its own desk
 * directory, and the shell under test is the shipped shell.
 *
 * THE ONE DECLARED DIVERGENCE is a record padded with a non-ASCII space:
 * `String.prototype.trim` removes U+00A0 and bash's `[:space:]` in the C
 * locale does not. The writer (`desk-fs.ts`) writes `${pid}\n`, so no
 * production record holds one.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const STATE_LIB = `${ROOT}/skills/plot/scripts/plot-worker-state.sh`;

const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

const PID = '4711';

/** Each record text, or `null` for no file, with a name a failure can be read by. */
const TEXTS: Array<[name: string, text: string | null]> = [
  ['absent', null],
  ['empty', ''],
  ['pid-newline', `${PID}\n`],
  ['pid-bare', PID],
  ['spaces-around', ` ${PID} `],
  ['tab-crlf', `\t${PID}\r\n`],
  ['leading-newline', `\n${PID}\n\n`],
  ['vtab-formfeed', `\v${PID}\f`],
  ['whitespace-only', ' \t\n'],
  ['two-lines', `${PID}\n${PID}\n`],
  ['inner-space', '47 11\n'],
  ['leading-zero', `0${PID}\n`],
  ['signed', `+${PID}\n`],
  ['other-pid', '4712\n'],
  ['prefix-pid', '471\n'],
  ['word', 'free\n'],
  ['nbsp-padded', ` ${PID}\n`],
];

/** The pids asked about: the recorded one, and none. */
const PIDS = [PID, ''];

/** Subjects where the two sides are known to differ, and why — asserted exactly. */
const DECLARED: Record<string, string> = {
  [`nbsp-padded/${PID}`]: 'JS trim removes U+00A0; bash [:space:] in the C locale does not',
};

interface Case {
  name: string;
  desk: string;
  text: string | null;
  pid: string;
}

const base = mkdtempSync(join(tmpdir(), 'plot-desk-waits-free-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const cases: Case[] = [];
TEXTS.forEach(([name, text], i) => {
  const desk = join(base, `desk-${i}`);
  mkdirSync(desk);
  if (text !== null) writeFileSync(join(desk, FREE_WAIT_FILENAME), text);
  for (const pid of PIDS) cases.push({ name: `${name}/${pid === '' ? 'no-pid' : pid}`, desk, text, pid });
});

/**
 * Every case's answer from the SHIPPED shell function, in one bash process,
 * under `LC_ALL=C`. One line per case on stdin: the desk, a tab, the pid.
 */
const shellAnswers = (all: readonly Case[]): string[] => {
  const script = `
    . ${JSON.stringify(STATE_LIB)}
    while IFS="$(printf '\\t')" read -r desk pid; do
      if plot_worker_waits_free "$desk" "$pid"; then echo yes; else echo no; fi
    done
  `;
  const out = execFileSync('bash', ['-c', script], {
    input: all.map((one) => `${one.desk}\t${one.pid}`).join('\n') + '\n',
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', PLOT_MANIFEST_DIR: base },
    timeout: 60_000,
  });
  const words = out.split('\n');
  if (words[words.length - 1] === '') words.pop();
  return words;
};

const shell = shellAnswers(cases);
const rule = cases.map((one) => (deskWaitsFree({ text: one.text }, one.pid) ? 'yes' : 'no'));

describe('deskWaitsFree agrees with plot-worker-state.sh plot_worker_waits_free', () => {
  it('reads a corpus worth comparing, and both answers occur', () => {
    expect(cases.length).toBe(34);
    expect(shell.length).toBe(cases.length);
    expect(new Set(rule)).toEqual(new Set(['yes', 'no']));
    expect(new Set(shell)).toEqual(new Set(['yes', 'no']));
  });

  it('answers what the shell answers, except the declared divergence', () => {
    const found: Disagreement[] = [];
    cases.forEach((one, i) => compareField(found, one.name, 'waits-free', rule[i], shell[i]));
    expect(found.map((one) => one.subject).sort()).toEqual(Object.keys(DECLARED).sort());
    expect(found.filter((one) => !(one.subject in DECLARED)).map(report)).toEqual([]);
  });

  it('pins the answers both sides must give, so agreement is not a shared mistake', () => {
    const answer = (name: string): [string, string] => {
      const i = cases.findIndex((one) => one.name === name);
      return [rule[i] ?? '', shell[i] ?? ''];
    };
    expect(answer(`pid-newline/${PID}`)).toEqual(['yes', 'yes']);
    expect(answer(`tab-crlf/${PID}`)).toEqual(['yes', 'yes']);
    expect(answer(`absent/${PID}`)).toEqual(['no', 'no']);
    expect(answer(`other-pid/${PID}`)).toEqual(['no', 'no']);
    expect(answer(`inner-space/${PID}`)).toEqual(['no', 'no']);
    expect(answer('empty/no-pid')).toEqual(['no', 'no']);
  });
});
