import { describe, expect, it } from 'vitest';
import { writtenPathResolution } from '../src/rules/written-path.js';

describe('writtenPathResolution', () => {
  it('resolves a repository-relative path inside the root', () => {
    expect(writtenPathResolution('docs/plans/x.md', '/repo')).toEqual({
      inside: true,
      resolved: '/repo/docs/plans/x.md',
    });
  });

  it('refuses a relative path that climbs outside the repository', () => {
    const out = writtenPathResolution('../../etc/passwd', '/repo');
    expect(out.inside).toBe(false);
  });

  it('refuses an absolute path outside the repository', () => {
    const out = writtenPathResolution('/etc/passwd', '/repo');
    expect(out.inside).toBe(false);
  });

  it('refuses an empty written field', () => {
    const out = writtenPathResolution('', '/repo');
    expect(out.inside).toBe(false);
    expect(out.inside === false && out.reason).toBe('the hand-back named no file');
  });

  it('accepts the repository root itself', () => {
    expect(writtenPathResolution('.', '/repo')).toEqual({ inside: true, resolved: '/repo' });
  });

  it('does not let excess `..` segments escape past the filesystem root and reappear inside it', () => {
    const out = writtenPathResolution('../../../../../../repo/x.md', '/repo');
    // Six `..` from `/repo` pop past empty (no-op), then push `repo`, `x.md` —
    // landing back on `/repo/x.md`, which IS inside; this is the one case a
    // naive implementation could get right by accident, so it is asserted
    // explicitly rather than assumed.
    expect(out).toEqual({ inside: true, resolved: '/repo/x.md' });
  });
});
