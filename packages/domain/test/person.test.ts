import { describe, it, expect } from 'vitest';
import {
  resolvePerson,
  samePerson,
  namesAPerson,
  type PersonDirectory,
} from '../src/index.js';

/**
 * The entity that exists to make two spellings of one human resolve to one
 * value — DESIGN-entities.md §1c.
 *
 * Measured 2026-08-28: story front matter says `jwloka` 9/9 and git says
 * `Jan Wloka` 200/200, each internally consistent. Plans are where they
 * collide — `assignee:` 30 against 16, `approved:` 84 against 43 — because a
 * plan's lines are typed by a human into prose while the others are written by
 * tooling. Not a plan-format defect: a missing shared identity.
 */

/** The declared mapping, supplied rather than inferred. */
const directory: PersonDirectory = { 'jan wloka': 'jwloka', jwloka: 'jwloka' };

describe('a person resolves from whatever an artefact called them', () => {
  it('resolves both measured spellings to one handle', () => {
    // The question 84-vs-43 cannot answer today.
    expect(resolvePerson('Jan Wloka', directory).handle).toBe('jwloka');
    expect(resolvePerson('jwloka', directory).handle).toBe('jwloka');
    expect(samePerson(resolvePerson('Jan Wloka', directory), resolvePerson('jwloka', directory))).toBe(true);
  });

  it('keeps the display name a record may render', () => {
    expect(resolvePerson('Jan Wloka', directory).displayName).toBe('Jan Wloka');
  });

  it('resolves regardless of the spelling’s case or surrounding space', () => {
    expect(resolvePerson('  JAN WLOKA  ', directory).handle).toBe('jwloka');
  });

  it('does not guess where the spelling is undeclared', () => {
    // Absent is not false, applied to identity: an unrecognised spelling keeps
    // its raw value as the handle and an EMPTY display name, rather than being
    // matched to something similar. `Jan Wloka` and `jwloka` correspond by
    // convention here and would not in general, so similarity is not evidence.
    const stranger = resolvePerson('Someone Else', directory);
    expect(stranger.handle).toBe('someone else');
    expect(stranger.displayName).toBe('');
  });

  it('resolves against an empty directory without inventing a mapping', () => {
    expect(resolvePerson('jwloka')).toEqual({ handle: 'jwloka', displayName: '' });
  });

  it('treats different handles as different humans', () => {
    expect(samePerson(resolvePerson('jwloka', directory), resolvePerson('someone', directory))).toBe(false);
  });

  it('compares on the handle alone, never the rendering', () => {
    expect(samePerson({ handle: 'jwloka', displayName: 'Jan Wloka' }, { handle: 'jwloka', displayName: '' })).toBe(true);
  });
});

describe('a `who` position does not always hold a person', () => {
  it('accepts a name and a handle', () => {
    expect(namesAPerson('Jan Wloka')).toBe(true);
    expect(namesAPerson('jwloka')).toBe(true);
  });

  it('rejects the prose clause four Approved: records actually hold', () => {
    // The record is comma-separated free text and one field may itself contain
    // commas, so the `who` position can capture a sentence. There is nothing
    // to parse, and pretending otherwise mints a Person named after a rule.
    expect(namesAPerson('do not fall back to a second budget')).toBe(false);
  });

  it('rejects an empty or blank value', () => {
    expect(namesAPerson('')).toBe(false);
    expect(namesAPerson('   ')).toBe(false);
  });
});
