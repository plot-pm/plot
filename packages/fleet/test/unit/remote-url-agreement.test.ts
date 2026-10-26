import { describe, expect, it } from 'vitest';

import { remoteSlug } from '@plot-pm/domain/rules/remote-slug';
import { ownerOfRemote } from '@plot-pm/domain/rules/remote-owner';

import { branchUrlBase } from '../../src/shared/fleet-scan.js';

/**
 * `remoteSlug`, `ownerOfRemote` and `branchUrlBase` each split a remote URL
 * into host and path before doing their own thing with it. Before this slice
 * they each carried their own regex, and the regexes disagreed on `file://`
 * and single-character scp-style hosts (a Windows drive letter) — this test
 * feeds those exact shapes through all three and asserts they now agree that
 * there is nothing to parse.
 */
describe('the three remote-URL callers agree on edge cases their old regexes disagreed on', () => {
  it.each([
    'file:///srv/git/repo.git',
    'C:/git/repo.git',
  ])('%s names no host or owner to any of the three callers', (url) => {
    expect(remoteSlug(url, 'example.com')).toBeNull();
    expect(ownerOfRemote(url)).toBeNull();
    expect(branchUrlBase(url)).toBe('');
  });

  it('a port on a scheme URL is dropped by every caller', () => {
    const url = 'ssh://git@example.com:7999/acme/repo.git';
    expect(remoteSlug(url, 'example.com')).toBe('acme/repo');
    expect(ownerOfRemote(url)).toBe('acme');
    expect(branchUrlBase(url)).toBe('');
  });
});
