import { describe, it, expect } from 'vitest';
import { agentSettingsRefusal } from '../src/rules/agent-settings.js';

/**
 * The refusal in front of every fleet agent's settings file.
 *
 * **The negative case is the one that matters.** A rule refusing every
 * `enabledPlugins` block passes every positive test here and refuses the only
 * file anyone wants to write — one that disables a noisy plugin and leaves Plot
 * alone. So the test that separates a working rule from a useless one is
 * "disables other plugins, answers none", not any of the refusals.
 */
describe('agentSettingsRefusal', () => {
  describe('the file a project actually writes', () => {
    it('answers none for a file that disables only other plugins', () => {
      expect(
        agentSettingsRefusal({
          enabledPlugins: { 'episodic-memory@superpowers-marketplace': false },
        }),
      ).toBeUndefined();
    });

    it('answers none for several other plugins disabled at once', () => {
      expect(
        agentSettingsRefusal({
          enabledPlugins: {
            'episodic-memory@superpowers-marketplace': false,
            'oh-my-claudecode@omc': false,
            'figma@figma-marketplace': false,
          },
        }),
      ).toBeUndefined();
    });

    it('answers none for an empty file', () => {
      expect(agentSettingsRefusal({})).toBeUndefined();
    });

    it('answers none for a file that pins Plot on', () => {
      expect(
        agentSettingsRefusal({ enabledPlugins: { 'plot@plot-marketplace': true } }),
      ).toBeUndefined();
    });

    it('answers none for disableAllHooks explicitly false', () => {
      expect(agentSettingsRefusal({ disableAllHooks: false })).toBeUndefined();
    });

    it('answers none for an empty env block, which removes nothing', () => {
      expect(agentSettingsRefusal({ env: {} })).toBeUndefined();
    });
  });

  describe('the plot plugin', () => {
    it('refuses plot@… set to false, naming the key', () => {
      const refusal = agentSettingsRefusal({
        enabledPlugins: { 'plot@plot-marketplace': false },
      });
      expect(refusal?.key).toBe('enabledPlugins.plot@plot-marketplace');
      expect(refusal?.why).toContain('gates');
    });

    it('refuses plot@… from any marketplace', () => {
      expect(
        agentSettingsRefusal({ enabledPlugins: { 'plot@some-other-marketplace': false } })?.key,
      ).toBe('enabledPlugins.plot@some-other-marketplace');
    });

    it('refuses plot@… even beside other disabled plugins', () => {
      expect(
        agentSettingsRefusal({
          enabledPlugins: {
            'episodic-memory@superpowers-marketplace': false,
            'plot@plot-marketplace': false,
          },
        })?.key,
      ).toBe('enabledPlugins.plot@plot-marketplace');
    });

    // ONLY `false` REFUSES. A settings file is project-authored text, so a
    // truthiness test would refuse the STRING "false" too and invent a rule the
    // plan does not state.
    it('answers none for a plot@… value that is not the boolean false', () => {
      expect(
        agentSettingsRefusal({ enabledPlugins: { 'plot@plot-marketplace': 'false' } }),
      ).toBeUndefined();
    });

    // A plugin whose name merely CONTAINS plot is not Plot's.
    it('answers none for a plugin whose name only contains plot', () => {
      expect(
        agentSettingsRefusal({ enabledPlugins: { 'plotly-charts@some-marketplace': false } }),
      ).toBeUndefined();
    });
  });

  describe('disableAllHooks', () => {
    it('refuses true', () => {
      const refusal = agentSettingsRefusal({ disableAllHooks: true });
      expect(refusal?.key).toBe('disableAllHooks');
    });

    // The broadest setting is named first: a file carrying both reports the one
    // that would still remove the gates after the other was fixed.
    it('is named ahead of a disabled plot plugin', () => {
      expect(
        agentSettingsRefusal({
          disableAllHooks: true,
          enabledPlugins: { 'plot@plot-marketplace': false },
        })?.key,
      ).toBe('disableAllHooks');
    });
  });

  describe('env, refused whole', () => {
    it('refuses a PATH, the measured failure', () => {
      const refusal = agentSettingsRefusal({ env: { PATH: '/nowhere' } });
      expect(refusal?.key).toBe('env.PATH');
      expect(refusal?.why).toContain('fail open');
    });

    // WHOLE means whole: no key is inspected, because the reason PATH refuses is
    // that a gate which fails open cannot be told from an absent one, and any
    // env key is a door to that.
    it('refuses an env key that has nothing to do with PATH', () => {
      expect(agentSettingsRefusal({ env: { ANTHROPIC_MODEL: 'claude-opus-5' } })?.key).toBe(
        'env.ANTHROPIC_MODEL',
      );
    });
  });

  describe('a file whose shape is not an object', () => {
    // An unparseable or wrongly-shaped file is the CALLER's exit 3, not this
    // rule's refusal: the resolver reports "unparseable" with the path, which is
    // a different message from "this key switches the gates off".
    it.each([
      ['null', null],
      ['a string', 'enabledPlugins'],
      ['a number', 7],
      ['an array', [{ disableAllHooks: true }]],
      ['undefined', undefined],
    ])('answers none for %s', (_name, value) => {
      expect(agentSettingsRefusal(value)).toBeUndefined();
    });

    it('answers none for a non-object enabledPlugins', () => {
      expect(agentSettingsRefusal({ enabledPlugins: 'plot@plot-marketplace' })).toBeUndefined();
    });

    it('answers none for a non-object env', () => {
      expect(agentSettingsRefusal({ env: 'PATH=/nowhere' })).toBeUndefined();
    });
  });
});
