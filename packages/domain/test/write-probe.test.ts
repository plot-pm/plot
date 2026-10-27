import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { answered, failed, unaskable, type PortResult } from '../src/port-result.js';
import {
  type WriteProbeReading,
  flagMissingFromPrint,
  promptPrintsInvocation,
  stalePrintReason,
  writeProbeAnswer,
  writeProbeNeeded,
  writeProbeOutcome,
  writeProbeRefusal,
} from '../src/rules/write-probe.js';

const here = dirname(fileURLToPath(import.meta.url));
/** The template as shipped before #2778: its print omits `--permission-mode`. */
const oldTemplate = readFileSync(join(here, 'fixtures', 'worker-prompt-before-2778.sh'), 'utf8');
/** The template as shipped now. */
const newTemplate = readFileSync(join(here, '..', '..', '..', 'skills', 'plot', 'templates', 'worker-prompt.sh'), 'utf8');

describe('writeProbeAnswer — absent is not false', () => {
  it('refuses only on an observed no', () => {
    expect(writeProbeAnswer('no')).toBe('refuse');
  });

  it('proceeds on an observed yes', () => {
    expect(writeProbeAnswer('yes')).toBe('proceed');
  });

  it('proceeds on unanswerable, the same as yes', () => {
    // THE WHOLE POINT. A probe that could not run observed nothing, and
    // refusing on it would turn an absent harness or a timed-out run into a
    // false permission fault.
    expect(writeProbeAnswer('unanswerable')).toBe('proceed');
  });
});

describe('writeProbeRefusal — one fault, one wording', () => {
  it('names the detail it was given', () => {
    expect(writeProbeRefusal('no marker file appeared')).toContain('no marker file appeared');
  });

  it('says so when no detail was recorded, rather than printing nothing', () => {
    expect(writeProbeRefusal('')).toContain('no detail was recorded');
  });
});

describe('writeProbeNeeded — a command that starts nothing is not probed (#2778)', () => {
  it('skips an empty, blank or none Worker command', () => {
    expect(writeProbeNeeded('')).toBe(false);
    expect(writeProbeNeeded('   ')).toBe(false);
    expect(writeProbeNeeded('none')).toBe(false);
    expect(writeProbeNeeded(' none ')).toBe(false);
  });

  it('probes any other command', () => {
    expect(writeProbeNeeded('claude -p')).toBe(true);
    expect(writeProbeNeeded('skills/plot/scripts/plot-worker-loop.sh')).toBe(true);
  });
});

describe('promptPrintsInvocation — a file without a print block is never sourced', () => {
  it('finds the block in the old and the new template', () => {
    expect(promptPrintsInvocation(oldTemplate)).toBe(true);
    expect(promptPrintsInvocation(newTemplate)).toBe(true);
  });

  it('answers false for a file without the block, and for one that names it only in a comment', () => {
    expect(promptPrintsInvocation('#!/usr/bin/env bash\nclaude -p "work" --permission-mode bypassPermissions\n')).toBe(false);
    expect(promptPrintsInvocation('# PLOT_PRINT_INVOCATION is not handled here\nclaude -p "work"\n')).toBe(false);
  });
});

describe('flagMissingFromPrint — an old print is detected, a current one is not (#2778)', () => {
  /** What each template prints after the harness name when no charter is set. */
  const oldPrinted: string[] = [];
  const newPrinted = ['--permission-mode', 'bypassPermissions'];

  it('names --permission-mode for the template shipped before #2778', () => {
    expect(flagMissingFromPrint(oldTemplate, oldPrinted)).toBe('--permission-mode');
  });

  it('names nothing for the current template', () => {
    expect(flagMissingFromPrint(newTemplate, newPrinted)).toBeUndefined();
  });

  it('names nothing for a file whose code never passes the flag, even if a comment names it', () => {
    expect(flagMissingFromPrint('# --permission-mode is not used here\nclaude -p "x"\n', [])).toBeUndefined();
  });
});

describe('writeProbeOutcome — one answer for both callers', () => {
  it('refuses an observed no with the refusal text', () => {
    const outcome = writeProbeOutcome(answered('no'));
    expect(outcome.answer).toBe('refuse');
    expect(outcome.message).toMatch(/refused every write/);
  });

  it('proceeds silently on yes, unanswerable, a failed call and a plain unaskable', () => {
    const results: PortResult<WriteProbeReading>[] = [
      answered('yes'),
      answered('unanswerable'),
      failed(),
      unaskable('no prompt file to probe'),
    ];
    for (const result of results) {
      expect(writeProbeOutcome(result)).toEqual({ answer: 'proceed' });
    }
  });

  it('proceeds on a stale print and names the template refresh, not a permissions fix', () => {
    const outcome = writeProbeOutcome(unaskable(stalePrintReason('.plot/worker-prompt.sh launches with --permission-mode but its PLOT_PRINT_INVOCATION block does not print it')));
    expect(outcome.answer).toBe('proceed');
    expect(outcome.message).toContain('launches with --permission-mode');
    expect(outcome.message).toContain('skills/plot/templates/worker-prompt.sh');
    expect(outcome.message).not.toMatch(/permissions, then try again/);
  });
});
