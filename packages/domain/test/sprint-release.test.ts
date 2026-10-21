import { describe, expect, it } from 'vitest';

import { releaseIsRead, resolveItemKey, sprintReleaseDrift } from '../src/rules/sprint-release.js';

describe('sprintReleaseDrift', () => {
  it('reports nothing when every Must-have names an issue the Release carries and vice versa', () => {
    const drift = sprintReleaseDrift(
      [{ text: 'ship the thing', issue: 'PROJ-1' }],
      ['PROJ-1'],
    );
    expect(drift).toEqual({ missingFromRelease: [], missingFromSprint: [], notCompared: [] });
  });

  it('reports a Must-have whose issue the Release does not carry', () => {
    const drift = sprintReleaseDrift(
      [{ text: 'ship the thing', issue: 'PROJ-1' }],
      [],
    );
    expect(drift.missingFromRelease).toEqual([{ text: 'ship the thing', issue: 'PROJ-1' }]);
    expect(drift.missingFromSprint).toEqual([]);
    expect(drift.notCompared).toEqual([]);
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

  it('reports a Must-have with no Issue field as not compared, never folded into missingFromRelease', () => {
    const drift = sprintReleaseDrift(
      [{ text: 'PROJ-1: ship the thing', issue: '' }],
      ['PROJ-1'],
    );
    expect(drift.missingFromRelease).toEqual([]);
    expect(drift.missingFromSprint).toEqual(['PROJ-1']);
    expect(drift.notCompared).toEqual([{ text: 'PROJ-1: ship the thing', issue: '' }]);
  });

  it('answers no drift for an empty sprint and an empty Release', () => {
    expect(sprintReleaseDrift([], [])).toEqual({ missingFromRelease: [], missingFromSprint: [], notCompared: [] });
  });
});

describe('resolveItemKey', () => {
  it('takes the Issue line key first, even where frontmatter and item text disagree', () => {
    expect(resolveItemKey(['PROJ-1'], 'PROJ-2', 'PROJ-3: ship it', ['PROJ'])).toBe('PROJ-1');
  });

  it('skips a non-Jira-shaped Issue line entry and takes the next', () => {
    expect(resolveItemKey(['226', 'PROJ-1'], '', '', ['PROJ'])).toBe('PROJ-1');
  });

  it('falls back to ticket frontmatter where the Issue line names no Jira key', () => {
    expect(resolveItemKey([], 'PROJ-2', 'PROJ-3: ship it', ['PROJ'])).toBe('PROJ-2');
    expect(resolveItemKey(['226'], 'PROJ-2', '', ['PROJ'])).toBe('PROJ-2');
  });

  it('falls back to item text matched against Ticket prefixes where neither other source names a key', () => {
    expect(resolveItemKey([], '', 'Tracer bullet for the thing (PROJ-3858)', ['PROJ'])).toBe('PROJ-3858');
  });

  it('never matches item text against a prefix the repository did not declare', () => {
    expect(resolveItemKey([], '', 'Tracer bullet for the thing (OTHER-3858)', ['PROJ'])).toBe('');
  });

  it('answers empty where no source names a key', () => {
    expect(resolveItemKey([], '', 'ship the thing', ['PROJ'])).toBe('');
    expect(resolveItemKey([], '', 'ship the thing', [])).toBe('');
  });

  it('ignores a blank ticket frontmatter value', () => {
    expect(resolveItemKey([], '  ', 'PROJ-9 ship it', ['PROJ'])).toBe('PROJ-9');
  });

  it('escapes a prefix containing a regex metacharacter rather than letting it corrupt the match', () => {
    expect(resolveItemKey([], '', 'ship it (A.B-1)', ['A.B'])).toBe('A.B-1');
    expect(resolveItemKey([], '', 'ship it (AXB-1)', ['A.B'])).toBe('');
  });
});

describe('releaseIsRead', () => {
  const versions = ['vendor-a'];

  it('reads the Release where Plot owns the sprint and the tracker scheme reads versions', () => {
    expect(releaseIsRead({ owns: 'plot' }, 'Vendor-A https://example.invalid PROJ', versions)).toBe(true);
  });

  it('reads nothing where no tracker is declared', () => {
    expect(releaseIsRead({ owns: 'plot' }, '', versions)).toBe(false);
  });

  it('reads nothing where the declared tracker has no version concept', () => {
    expect(releaseIsRead({ owns: 'plot' }, 'vendor-b', versions)).toBe(false);
  });

  it('reads nothing where an external tracker owns the sprint', () => {
    expect(releaseIsRead({ owns: 'external', scheme: 'vendor-a' }, 'vendor-a', versions)).toBe(false);
  });
});
