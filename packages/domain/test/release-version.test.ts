import { describe, expect, it } from 'vitest';
import { releaseBranchVersion } from '../src/rules/release-version.js';

describe('releaseBranchVersion', () => {
  it('names the root version a release branch bumps past its base', () => {
    expect(releaseBranchVersion('{"version":"2.36.0"}', '{"version":"2.35.0"}')).toBe('2.36.0');
  });

  it('names no version where the root version equals the base, as on a workspace-only release (#3562)', () => {
    expect(releaseBranchVersion('{"name":"plot","version":"2.35.0"}', '{"name":"plot","version":"2.35.0"}')).toBe('');
  });

  it.each([
    ['an unread branch file', null, '{"version":"2.35.0"}'],
    ['an unread base file', '{"version":"2.36.0"}', null],
    ['malformed branch JSON', 'not json', '{"version":"2.35.0"}'],
    ['malformed base JSON', '{"version":"2.36.0"}', 'not json'],
    ['a branch file with no version', '{}', '{"version":"2.35.0"}'],
    ['a base file with no version', '{"version":"2.36.0"}', '{"name":"plot"}'],
  ])('names no version for %s', (_label, branch, base) => {
    expect(releaseBranchVersion(branch, base)).toBe('');
  });
});
