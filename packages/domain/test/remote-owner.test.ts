import { describe, expect, it } from 'vitest';
import { ownerOfRemote } from '../src/rules/remote-owner.js';

describe('ownerOfRemote', () => {
  describe('an https URL', () => {
    it('answers the segment before the repository name', () => {
      expect(ownerOfRemote('https://example.com/acme/plot')).toBe('acme');
    });

    it('answers it without the .git suffix', () => {
      expect(ownerOfRemote('https://example.com/acme/plot.git')).toBe('acme');
    });

    it('lowercases the answer', () => {
      expect(ownerOfRemote('https://example.com/ACME/plot.git')).toBe('acme');
    });

    it('answers through a port', () => {
      expect(ownerOfRemote('https://example.com:8443/acme/plot.git')).toBe('acme');
    });

    it('answers through credentials in the URL', () => {
      expect(ownerOfRemote('https://token@example.com/acme/plot.git')).toBe('acme');
    });

    it('answers the last owner segment of a nested path', () => {
      // A self-hosted host may serve a group path. The owner is the segment
      // immediately before the repository, which is what the form names.
      expect(ownerOfRemote('https://example.com/group/sub/plot.git')).toBe('sub');
    });

    it('answers nothing for a URL naming no owner', () => {
      expect(ownerOfRemote('https://example.com/plot.git')).toBeNull();
    });

    it('answers nothing for a host with no path', () => {
      expect(ownerOfRemote('https://example.com')).toBeNull();
    });

    it('answers through http', () => {
      expect(ownerOfRemote('http://example.com/acme/plot.git')).toBe('acme');
    });

    it('answers through a trailing slash', () => {
      expect(ownerOfRemote('https://example.com/acme/plot/')).toBe('acme');
    });
  });

  describe('an ssh:// URL', () => {
    it('answers the segment before the repository name', () => {
      expect(ownerOfRemote('ssh://git@example.com/acme/plot.git')).toBe('acme');
    });

    it('answers without a user', () => {
      expect(ownerOfRemote('ssh://example.com/acme/plot.git')).toBe('acme');
    });

    it('answers through a port', () => {
      expect(ownerOfRemote('ssh://git@example.com:7999/acme/plot.git')).toBe('acme');
    });

    it('lowercases the answer', () => {
      expect(ownerOfRemote('ssh://git@example.com/ACME/plot.git')).toBe('acme');
    });
  });

  describe('an scp-style URL', () => {
    it('answers the segment after the colon', () => {
      expect(ownerOfRemote('git@example.com:acme/plot.git')).toBe('acme');
    });

    it('answers the same through a host alias', () => {
      // An SSH alias such as `example-work` changes nothing: the owner is the
      // segment after the colon, and the alias is the part before it.
      expect(ownerOfRemote('git@example-work:acme/plot.git')).toBe('acme');
    });

    it('answers without a user', () => {
      expect(ownerOfRemote('example.com:acme/plot.git')).toBe('acme');
    });

    it('lowercases the answer', () => {
      expect(ownerOfRemote('git@example.com:ACME/plot.git')).toBe('acme');
    });

    it('answers the last owner segment of a nested path', () => {
      expect(ownerOfRemote('git@example.com:group/sub/plot.git')).toBe('sub');
    });

    it('answers nothing when the colon is followed by one segment', () => {
      expect(ownerOfRemote('git@example.com:plot.git')).toBeNull();
    });

    it('answers nothing when the colon is followed by nothing', () => {
      expect(ownerOfRemote('git@example.com:')).toBeNull();
    });
  });

  describe('a shape that names no owner', () => {
    it('answers nothing for an absolute local path', () => {
      // `fleet.test.mjs:845-900` runs against a bare local origin, and `null`
      // keeps that fixture's answer: any owner counts.
      expect(ownerOfRemote('/srv/git/plot.git')).toBeNull();
    });

    it('answers nothing for a relative local path', () => {
      expect(ownerOfRemote('../plot.git')).toBeNull();
    });

    it('answers nothing for a file:// URL', () => {
      expect(ownerOfRemote('file:///srv/git/plot.git')).toBeNull();
    });

    it('answers nothing for an empty string', () => {
      expect(ownerOfRemote('')).toBeNull();
    });

    it('answers nothing for a bare name', () => {
      expect(ownerOfRemote('plot')).toBeNull();
    });

    it('answers nothing for a Windows path, whose colon names a drive', () => {
      expect(ownerOfRemote('C:/git/plot.git')).toBeNull();
    });

    it('answers nothing for a path holding a colon after a slash', () => {
      // A local path may legally hold a colon. git reads an scp-style URL only
      // when the colon precedes the first slash, and so does this.
      expect(ownerOfRemote('/srv/git:mirror/acme/plot.git')).toBeNull();
    });
  });
});
