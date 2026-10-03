import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MANIFEST_DIR,
  deskManifest,
  loopRegistration,
  manifestDirectory,
  watchedDesk,
  type ManifestReading,
} from '../src/rules/desk-manifest.js';

/**
 * The join between a desk and the manifest that names it, in both directions:
 * where the manifests are, and which of them names this desk.
 *
 * Every branch is exercised here rather than through a caller, because four
 * readers made this join four ways and the disagreement was invisible to each
 * one's own tests.
 */

/** A manifest reading with only the fields a case cares about. */
const manifest = (over: Partial<ManifestReading> = {}): ManifestReading => ({
  path: '/estate/.plot/agents/one.json',
  worktree: '/estate/.worktrees/feature-one',
  ...over,
});

describe('manifestDirectory', () => {
  it('joins the default under the main checkout when nothing is configured', () => {
    expect(manifestDirectory({ mainCheckout: '/estate', configured: '' })).toBe(
      `/estate/${DEFAULT_MANIFEST_DIR}`,
    );
  });

  it('joins a relative value under the main checkout', () => {
    // A desk must resolve the SAME directory the checkout does, which is why
    // the join is to the main checkout and never to the asking tree.
    expect(manifestDirectory({ mainCheckout: '/estate', configured: 'var/agents' })).toBe(
      '/estate/var/agents',
    );
  });

  it('takes an absolute value as given', () => {
    // A project may name a registry outside its own tree — a shared directory
    // two checkouts both write.
    expect(manifestDirectory({ mainCheckout: '/estate', configured: '/shared/agents' })).toBe(
      '/shared/agents',
    );
  });

  it('trims a trailing separator from either side', () => {
    // `plot-dispatch.sh:agent_registry_dir` trims one and `path.join`
    // normalises one, so an answer carrying one would differ from the
    // dispatcher's for the same configuration.
    expect(manifestDirectory({ mainCheckout: '/estate/', configured: 'var/agents/' })).toBe(
      '/estate/var/agents',
    );
    expect(manifestDirectory({ mainCheckout: '/estate', configured: '/shared/agents/' })).toBe(
      '/shared/agents',
    );
  });

  it('reads surrounding whitespace as an absent value', () => {
    // `plot-config.sh` prints a key's value with the line's spacing; a value
    // that is only spaces is a key nobody filled in.
    expect(manifestDirectory({ mainCheckout: '/estate', configured: '   ' })).toBe(
      `/estate/${DEFAULT_MANIFEST_DIR}`,
    );
  });

  it('answers the root itself for a configured value that is only separators', () => {
    // Not a configuration anybody writes, and it must still answer a path
    // rather than one ending in a stray `/`.
    expect(manifestDirectory({ mainCheckout: '/estate', configured: '/' })).toBe('/');
  });

  it('keeps a lone root as the checkout', () => {
    expect(manifestDirectory({ mainCheckout: '/', configured: 'agents' })).toBe('/agents');
  });
});

describe('deskManifest', () => {
  it('names the one manifest whose worktree is the desk', () => {
    const answer = deskManifest({
      desk: '/estate/.worktrees/feature-one',
      deskReal: '/estate/.worktrees/feature-one',
      manifests: [manifest(), manifest({ path: '/a/two.json', worktree: '/elsewhere' })],
    });
    expect(answer).toEqual({ kind: 'named', path: '/estate/.plot/agents/one.json' });
  });

  it('matches the desk by its realpath when the manifest holds the resolved form', () => {
    // The dispatcher records a RESOLVED path and a pulse may hand back either.
    const answer = deskManifest({
      desk: '/tmp/estate/.worktrees/one',
      deskReal: '/private/tmp/estate/.worktrees/one',
      manifests: [manifest({ worktree: '/private/tmp/estate/.worktrees/one' })],
    });
    expect(answer).toEqual({ kind: 'named', path: '/estate/.plot/agents/one.json' });
  });

  it("matches by the MANIFEST's realpath when the manifest holds a symlinked path", () => {
    // The asymmetry the supervisor could not pass: a desk registered by its
    // symlinked path, asked about by its real one. Both sides carry both forms.
    const answer = deskManifest({
      desk: '/private/tmp/estate/.worktrees/one',
      deskReal: '/private/tmp/estate/.worktrees/one',
      manifests: [
        manifest({
          worktree: '/tmp/estate/.worktrees/one',
          worktreeReal: '/private/tmp/estate/.worktrees/one',
        }),
      ],
    });
    expect(answer).toEqual({ kind: 'named', path: '/estate/.plot/agents/one.json' });
  });

  it('answers unnamed when no manifest names the desk', () => {
    const answer = deskManifest({
      desk: '/estate/.worktrees/feature-one',
      deskReal: '/estate/.worktrees/feature-one',
      manifests: [manifest({ worktree: '/elsewhere' })],
    });
    expect(answer).toEqual({ kind: 'unnamed' });
  });

  it('answers unnamed for an empty manifest list', () => {
    // A missing directory reads as no manifests. Absent is not false: the
    // caller gets an answer rather than a throw.
    expect(
      deskManifest({ desk: '/a/desk', deskReal: '/a/desk', manifests: [] }),
    ).toEqual({ kind: 'unnamed' });
  });

  it('answers unnamed for a manifest carrying no worktree field', () => {
    // An older manifest, or a half-written one. It names no desk, so it names
    // not this one either — rather than matching the desk's empty form.
    expect(
      deskManifest({
        desk: '/a/desk',
        deskReal: '/a/desk',
        manifests: [manifest({ worktree: '' })],
      }),
    ).toEqual({ kind: 'unnamed' });
  });

  it('ignores a realpath that came with an empty worktree field', () => {
    // bash 5.2 answers `cd ""` with the current directory, so a reader asking
    // from inside the desk resolves a missing field to the desk itself.
    expect(
      deskManifest({
        desk: '/a/desk',
        deskReal: '/a/desk',
        manifests: [
          manifest({ path: '/estate/.plot/agents/broken.json', worktree: '', worktreeReal: '/a/desk' }),
          manifest({ worktree: '/a/desk' }),
        ],
      }),
    ).toEqual({ kind: 'named', path: '/estate/.plot/agents/one.json' });
  });

  it('answers unnamed when the desk itself is empty', () => {
    // The reading a caller takes of a desk that is gone. A manifest with no
    // worktree must not match a desk with no path.
    expect(
      deskManifest({ desk: '', deskReal: '', manifests: [manifest({ worktree: '' })] }),
    ).toEqual({ kind: 'unnamed' });
  });

  it('uses the realpath alone when the desk path was not given', () => {
    expect(
      deskManifest({ desk: '', deskReal: '/real/desk', manifests: [manifest({ worktree: '/real/desk' })] }),
    ).toEqual({ kind: 'named', path: '/estate/.plot/agents/one.json' });
  });

  it('answers several, naming every manifest, rather than the first match', () => {
    // Two agents on one desk is an estate DEFECT. The first match would hide
    // it, and every caller in this slice reads `several` as *no manifest* and
    // names it.
    const answer = deskManifest({
      desk: '/estate/.worktrees/one',
      deskReal: '/estate/.worktrees/one',
      manifests: [
        manifest({ path: '/a/one.json', worktree: '/estate/.worktrees/one' }),
        manifest({ path: '/a/two.json', worktree: '/estate/.worktrees/one' }),
      ],
    });
    expect(answer).toEqual({ kind: 'several', paths: ['/a/one.json', '/a/two.json'] });
  });

  it('counts two manifests matching through different forms as several', () => {
    // One by the path as given, one by the realpath: still two agents on one
    // desk, and the answer must not depend on which form each used.
    const answer = deskManifest({
      desk: '/tmp/desk',
      deskReal: '/private/tmp/desk',
      manifests: [
        manifest({ path: '/a/one.json', worktree: '/tmp/desk' }),
        manifest({ path: '/a/two.json', worktree: '/private/tmp/desk' }),
      ],
    });
    expect(answer).toEqual({ kind: 'several', paths: ['/a/one.json', '/a/two.json'] });
  });

  it('counts one manifest once even when both its forms match', () => {
    // A manifest whose `worktree` and `worktreeReal` are the same string, which
    // is the common case: one match, not two, so it is `named`.
    const answer = deskManifest({
      desk: '/a/desk',
      deskReal: '/a/desk',
      manifests: [manifest({ worktree: '/a/desk', worktreeReal: '/a/desk' })],
    });
    expect(answer).toEqual({ kind: 'named', path: '/estate/.plot/agents/one.json' });
  });
});

describe('watchedDesk', () => {
  it('follows the manifest to the new desk after a hop', () => {
    expect(
      watchedDesk({ launched: '/estate/.worktrees/launch-one', manifestWorktree: '/estate/.worktrees/hop-two' }),
    ).toBe('/estate/.worktrees/hop-two');
  });

  it('falls back to the launch desk when the manifest field is empty', () => {
    // Absent is not false: a manifest that is gone, has no `worktree` field, or
    // whose caller passed '' all read through here as empty.
    expect(watchedDesk({ launched: '/estate/.worktrees/launch-one', manifestWorktree: '' })).toBe(
      '/estate/.worktrees/launch-one',
    );
  });

  it('treats a whitespace-only field as absent, not as a desk', () => {
    expect(watchedDesk({ launched: '/estate/.worktrees/launch-one', manifestWorktree: '   ' })).toBe(
      '/estate/.worktrees/launch-one',
    );
  });
});

describe('loopRegistration', () => {
  it('answers unset for a hand-started loop with no manifest file at all', () => {
    // Absent is not false: `PLOT_MANIFEST_FILE` empty is a supported shape and
    // must not read as `gone`, or every hand-started loop would end at once.
    expect(loopRegistration({ manifestFile: '', exists: true })).toBe('unset');
    expect(loopRegistration({ manifestFile: '', exists: false })).toBe('unset');
  });

  it('answers registered when the named manifest exists', () => {
    expect(
      loopRegistration({ manifestFile: '/estate/.plot/agents/one.json', exists: true }),
    ).toBe('registered');
  });

  it('answers gone when the named manifest is absent', () => {
    // The one case this rule exists to end a wait on: the registry handed the
    // loop a manifest at launch and it has since disappeared.
    expect(
      loopRegistration({ manifestFile: '/estate/.plot/agents/one.json', exists: false }),
    ).toBe('gone');
  });
});
