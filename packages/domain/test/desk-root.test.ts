import { describe, expect, it } from 'vitest';

import { deskRoot, deskRootPlacement, deskRootRefusal, linuxFilesystemName, mountTypeOf, NETWORK_FILESYSTEMS } from '../src/rules/desk-root.js';

const REPO = '/home/dev/plot';

describe('deskRoot', () => {
  it('answers <repo>/.worktrees when the key is absent', () => {
    expect(deskRoot({ configured: '', repoRoot: REPO })).toBe('/home/dev/plot/.worktrees');
  });

  // An implementation that drops the empty check treats '' as a relative path
  // and returns the repository root itself, which a test for "absent" alone
  // does not catch because both read as the same case to the caller.
  it('answers <repo>/.worktrees for an empty value, never the repository root', () => {
    const answer = deskRoot({ configured: '', repoRoot: REPO });
    expect(answer).not.toBe(REPO);
    expect(answer).toBe('/home/dev/plot/.worktrees');
  });

  it('answers a whitespace-only value as absent', () => {
    expect(deskRoot({ configured: '   ', repoRoot: REPO })).toBe('/home/dev/plot/.worktrees');
  });

  it('takes an absolute value as given', () => {
    expect(deskRoot({ configured: '/var/plot/desks', repoRoot: REPO })).toBe('/var/plot/desks');
  });

  it('resolves a relative value against the repository root', () => {
    expect(deskRoot({ configured: 'desks', repoRoot: REPO })).toBe('/home/dev/plot/desks');
  });

  it('resolves a nested relative value against the repository root', () => {
    expect(deskRoot({ configured: 'build/desks', repoRoot: REPO })).toBe(
      '/home/dev/plot/build/desks',
    );
  });

  // A composed desk path doubles the slash otherwise: `<root>/` + `/<branch>`.
  it('strips a trailing slash from a relative value', () => {
    expect(deskRoot({ configured: '.worktrees/', repoRoot: REPO })).toBe(
      '/home/dev/plot/.worktrees',
    );
  });

  it('strips a trailing slash from an absolute value', () => {
    expect(deskRoot({ configured: '/abs/dir/', repoRoot: REPO })).toBe('/abs/dir');
  });

  it('strips a trailing slash from the repository root', () => {
    expect(deskRoot({ configured: '', repoRoot: '/home/dev/plot/' })).toBe(
      '/home/dev/plot/.worktrees',
    );
  });

  it('keeps a root of / intact', () => {
    expect(deskRoot({ configured: '', repoRoot: '/' })).toBe('/.worktrees');
  });
});

describe('deskRootPlacement', () => {
  it('names the exclude line for the default root', () => {
    expect(deskRootPlacement({ configured: '', repoRoot: REPO })).toEqual({
      inside: true,
      excludeLine: '/.worktrees/',
    });
  });

  it('names the exclude line for a relative value', () => {
    expect(deskRootPlacement({ configured: 'build/desks', repoRoot: REPO })).toEqual({
      inside: true,
      excludeLine: '/build/desks/',
    });
  });

  it('reports an absolute root outside the repository', () => {
    expect(deskRootPlacement({ configured: '/var/plot/desks', repoRoot: REPO })).toEqual({
      inside: false,
    });
  });

  // An absolute value may still land inside the checkout.
  it('reports an absolute root inside the repository', () => {
    expect(deskRootPlacement({ configured: '/home/dev/plot/desks', repoRoot: REPO })).toEqual({
      inside: true,
      excludeLine: '/desks/',
    });
  });

  // A sibling whose name merely starts with the repository's is not inside it.
  it('does not mistake a sibling prefix for containment', () => {
    expect(deskRootPlacement({ configured: '/home/dev/plot-desks', repoRoot: REPO })).toEqual({
      inside: false,
    });
  });

  it('does not report the repository root itself as inside', () => {
    expect(deskRootPlacement({ configured: '/home/dev/plot', repoRoot: REPO })).toEqual({
      inside: false,
    });
  });

  it('names the exclude line for a repository at the filesystem root', () => {
    // The one root that keeps its trailing slash, so the prefix is not doubled.
    expect(deskRootPlacement({ configured: '', repoRoot: '/' })).toEqual({
      inside: true,
      excludeLine: '/.worktrees/',
    });
  });
});

describe('deskRootRefusal', () => {
  it('refuses each network filesystem by name, and passes a local or unread type', () => {
    for (const type of NETWORK_FILESYSTEMS) {
      expect(deskRootRefusal('/d', type)).toBe(`the desk root /d lies on a ${type} filesystem; desks must be on a local filesystem`);
    }
    expect(deskRootRefusal('/d', 'apfs')).toBeNull();
    expect(deskRootRefusal('/d', 'ext4')).toBeNull();
    expect(deskRootRefusal('/d', null)).toBeNull();
  });
});

describe('linuxFilesystemName', () => {
  it('names the statfs magic numbers, a negative f_type included, and prints an unknown one in hex', () => {
    expect(linuxFilesystemName(0x6969)).toBe('nfs');
    expect(linuxFilesystemName(0xef53)).toBe('ext4');
    expect(linuxFilesystemName(0xff534d42 | 0)).toBe('cifs');
    expect(linuxFilesystemName(0x1234)).toBe('0x1234');
  });
});

describe('mountTypeOf', () => {
  const MOUNT = [
    '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
    '/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse)',
    '//me@host/share on /Volumes/share (smbfs, nodev, nosuid, mounted by me)',
    'host:/export on /Volumes/share/nested (nfs)',
    'not a mount line',
  ].join('\n');

  it('answers the longest mount point that holds the path', () => {
    expect(mountTypeOf(MOUNT, '/Users/me/repo')).toBe('apfs');
    expect(mountTypeOf(MOUNT, '/Volumes/share')).toBe('smbfs');
    expect(mountTypeOf(MOUNT, '/Volumes/share/desks')).toBe('smbfs');
    expect(mountTypeOf(MOUNT, '/Volumes/share/nested/x')).toBe('nfs');
    expect(mountTypeOf(MOUNT, '/Volumes/sharex')).toBe('apfs');
    expect(mountTypeOf('', '/x')).toBeNull();
  });
});
