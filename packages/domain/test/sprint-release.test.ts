import { describe, expect, it } from 'vitest';

import { sprintReleaseDrift } from '../src/rules/sprint-release.js';

describe('sprintReleaseDrift', () => {
  it('reports nothing when every Must-have names an issue the Release carries and vice versa', () => {
    const drift = sprintReleaseDrift(
      [{ text: 'ship the thing', issue: 'PROJ-1' }],
      ['PROJ-1'],
    );
    expect(drift).toEqual({ missingFromRelease: [], missingFromSprint: [] });
  });

  it('reports a Must-have whose issue the Release does not carry', () => {
    const drift = sprintReleaseDrift(
      [{ text: 'ship the thing', issue: 'PROJ-1' }],
      [],
    );
    expect(drift.missingFromRelease).toEqual([{ text: 'ship the thing', issue: 'PROJ-1' }]);
    expect(drift.missingFromSprint).toEqual([]);
  });

  it('reports a Release issue no Must-have names, as its own distinct list', () => {
    const drift = sprintReleaseDrift(
      [{ text: 'ship the thing', issue: 'PROJ-1' }],
      ['PROJ-1', 'PROJ-2'],
    );
    expect(drift.missingFromRelease).toEqual([]);
    expect(drift.missingFromSprint).toEqual(['PROJ-2']);
  });

  it('reports both directions at once, never folded into one bucket', () => {
    const drift = sprintReleaseDrift(
      [{ text: 'ship the thing', issue: 'PROJ-1' }, { text: 'ship the other thing', issue: 'PROJ-3' }],
      ['PROJ-1', 'PROJ-2'],
    );
    expect(drift.missingFromRelease).toEqual([{ text: 'ship the other thing', issue: 'PROJ-3' }]);
    expect(drift.missingFromSprint).toEqual(['PROJ-2']);
  });

  it('reports a Must-have with no Issue field as missing from the Release, never guessed at from its text', () => {
    const drift = sprintReleaseDrift(
      [{ text: 'PROJ-1: ship the thing', issue: '' }],
      ['PROJ-1'],
    );
    expect(drift.missingFromRelease).toEqual([]);
    expect(drift.missingFromSprint).toEqual(['PROJ-1']);
  });

  it('answers no drift for an empty sprint and an empty Release', () => {
    expect(sprintReleaseDrift([], [])).toEqual({ missingFromRelease: [], missingFromSprint: [] });
  });
});
