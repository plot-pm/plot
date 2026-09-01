import { describe, expect, it } from 'vitest';

import { startabilityVerdict, waveVerdict } from '../src/rules/verdict.js';

/**
 * The verdicts, as rules rather than as board functions.
 *
 * Moved from `packages/board/src/server/fleet.ts` — a verdict answers a question
 * about a Slice, which is a judgement rather than a rendering concern. These
 * assert the rule's own gates; that the board still produces the same payload is
 * asserted by the move's byte-for-byte comparison, not here.
 */
describe('startabilityVerdict — whether one branch can be started', () => {
  it('says someone is on it while a branch is claimed or being worked', () => {
    // Both hold the branch. Neither is startable, and the reader is told why
    // rather than shown nothing.
    expect(startabilityVerdict('wip', 'approved', 'eligible', 'present')).toBe('someone-is-on-it');
    expect(startabilityVerdict('claimed', 'approved', 'eligible', 'present')).toBe('someone-is-on-it');
  });

  it('offers nothing on a branch that is finished or shelved', () => {
    // `null` rather than a verdict: there is no action to name.
    expect(startabilityVerdict('merged', 'approved', 'eligible', 'present')).toBeNull();
    expect(startabilityVerdict('deferred', 'approved', 'eligible', 'present')).toBeNull();
  });

  it('sends a Draft plan to approval before anything else about the branch', () => {
    // The phase outranks the wave and the brief: an unapproved plan is not
    // yours to start whatever else is true.
    expect(startabilityVerdict('open', 'draft', 'eligible', 'present')).toBe('waiting-on-approval');
    expect(startabilityVerdict('open', 'draft', 'blocked', 'missing')).toBe('waiting-on-approval');
  });

  it('offers nothing while an earlier wave still blocks the branch', () => {
    expect(startabilityVerdict('open', 'approved', 'blocked', 'present')).toBeNull();
    expect(startabilityVerdict('open', 'approved', 'complete', 'present')).toBeNull();
  });

  it('asks for a brief on an eligible branch that has none', () => {
    // `/plot-implement` writes it and `plot-dispatch.sh` refuses without one,
    // so an eligible branch with no brief is not startable.
    expect(startabilityVerdict('open', 'approved', 'eligible', 'missing')).toBe('needs-brief');
  });

  it('treats an unknown brief as present, never as missing', () => {
    // A caller that did not look has said nothing. Reporting `needs-brief` here
    // would claim a gap nobody measured.
    expect(startabilityVerdict('open', 'approved', 'eligible', 'unknown')).toBe('start-work');
  });

  it('says start work when every gate is satisfied', () => {
    expect(startabilityVerdict('open', 'approved', 'eligible', 'present')).toBe('start-work');
  });
});

describe('waveVerdict — the gate between an untyped pulse and a slice verdict', () => {
  it('passes a value the enum declares', () => {
    expect(waveVerdict('eligible')).toBe('eligible');
    expect(waveVerdict('blocked')).toBe('blocked');
  });

  it('answers null for a word the enum does not declare', () => {
    // The parse IS the rule: what the domain accepts is the enum, not whatever
    // the scan happened to print.
    expect(waveVerdict('probably-fine')).toBeNull();
    expect(waveVerdict('')).toBeNull();
  });
});
