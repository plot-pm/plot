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
    ['malformed branch JSON', 'not json', '{"version":"2.35.0"}'],
    ['a branch file with no version', '{}', '{"version":"2.35.0"}'],
  ])('names no version for %s', (_label, branch, base) => {
    expect(releaseBranchVersion(branch, base)).toBe('');
  });

  it.each([
    ['an unread base file', null],
    ['malformed base JSON', 'not json'],
    ['a base file with no version', '{"name":"plot"}'],
  ])('names the branch version where the base has released none: %s', (_label, base) => {
    expect(releaseBranchVersion('{"version":"9.1.0"}', base)).toBe('9.1.0');
  });
});
