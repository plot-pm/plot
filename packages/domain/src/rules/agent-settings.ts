/**
 * Whether a project's `Agent settings` file would switch Plot's own gates off.
 *
 * Every dispatched agent is a `claude -p` session, and the settings file this
 * rule judges is the one each of them is given. Plot's four `PreToolUse` gates
 * arrive through the Plot plugin, so a settings file that unregisters that
 * plugin, disables all hooks, or replaces the environment the gates run in
 * produces a fleet running ungated — the failure the gates exist for.
 *
 * **A check against an accidental switch-off, not a security boundary.** The
 * file is project-owned and reviewed like `CLAUDE.md`, and a project that wants
 * its gates off can edit `CLAUDE.md` as easily. What this catches is the file
 * written to silence one noisy plugin that takes Plot's gates with it.
 *
 * **`hooks` and `permissions` are out of scope.** A settings `hooks` block adds
 * hooks and `permissions.deny` restricts tools; neither was measured to
 * unregister a plugin's hooks.
 */

/** The `enabledPlugins` prefix that names Plot's own plugin, whatever marketplace it came from. */
const PLOT_PLUGIN_PREFIX = 'plot@';

/**
 * A settings file as parsed, before anything is known about its shape.
 *
 * Every field is optional and unknown-typed: the file is project-authored JSON,
 * so a caller cannot promise that `enabledPlugins` is an object or that
 * `disableAllHooks` is a boolean.
 */
export interface AgentSettings {
  readonly enabledPlugins?: unknown;
  readonly disableAllHooks?: unknown;
  readonly env?: unknown;
  readonly [key: string]: unknown;
}

/**
 * Why a settings file may not reach a fleet agent.
 *
 * `key` names the setting that refused, so a caller prints the line to edit
 * rather than the whole file.
 */
export interface AgentSettingsRefusal {
  /** The setting that refuses, in the spelling the file uses. */
  readonly key: string;
  /** What that setting would do to the gates. */
  readonly why: string;
}

/**
 * Judges a parsed settings file against Plot's own gates.
 *
 * Three settings refuse:
 *
 * - `enabledPlugins` setting any `plot@…` key to `false`, which unregisters the
 *   plugin the four gates arrive through.
 * - `disableAllHooks: true`, which unregisters every hook including them.
 * - any `env` key. `env` is refused WHOLE rather than by inspecting `PATH`,
 *   because a settings `PATH` that hides the gates' tools makes them fail open:
 *   measured 2026-09-30, `plot-state-gate.sh` run with a `PATH` lacking its
 *   tools allowed a `State:` change and exited 0. A gate that fails open is
 *   indistinguishable from an absent one, so no `env` key travels to an agent.
 *
 * A file that disables only OTHER plugins answers `undefined` — that is the
 * whole point of the key, and a rule refusing every `enabledPlugins` would
 * refuse the only file anyone wants to write.
 *
 * @param settings - the parsed file. A non-object (including `null`) refuses
 *   nothing: an unparseable file is the caller's exit 3, not this rule's.
 * @returns the refusal, or `undefined` when the file may reach an agent.
 */
export const agentSettingsRefusal = (settings: unknown): AgentSettingsRefusal | undefined => {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return undefined;
  }
  const file = settings as AgentSettings;

  // `disableAllHooks: true` is the broadest of the three and named first, so a
  // file carrying it AND a disabled plot plugin reports the setting that would
  // still remove the gates once the plugin entry was fixed.
  if (file.disableAllHooks === true) {
    return {
      key: 'disableAllHooks',
      why: "disableAllHooks: true unregisters every hook, Plot's four gates included",
    };
  }

  const plugins = file.enabledPlugins;
  if (typeof plugins === 'object' && plugins !== null && !Array.isArray(plugins)) {
    for (const [name, enabled] of Object.entries(plugins as Record<string, unknown>)) {
      // ONLY `false` REFUSES. `true` is a project pinning Plot on, and any other
      // value is not a disable — a settings file is project-authored, so a
      // truthiness test here would refuse `"false"` as well and invent a rule
      // the plan does not state.
      if (name.startsWith(PLOT_PLUGIN_PREFIX) && enabled === false) {
        return {
          key: `enabledPlugins.${name}`,
          why: `${name} is the plugin Plot's four PreToolUse gates arrive through`,
        };
      }
    }
  }

  // `env` GOES WHOLE, and the key reported is the first one found so the message
  // names something the reader can search for in their file.
  const env = file.env;
  if (typeof env === 'object' && env !== null && !Array.isArray(env)) {
    const [first] = Object.keys(env as Record<string, unknown>);
    if (first !== undefined) {
      return {
        key: `env.${first}`,
        why: "a settings env replaces the environment the gates run in; a PATH hiding their tools makes them fail open (measured 2026-09-30: plot-state-gate.sh allowed a State: change and exited 0)",
      };
    }
  }

  return undefined;
};
