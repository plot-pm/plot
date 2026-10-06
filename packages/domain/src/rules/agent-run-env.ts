/**
 * Builds the environment one agent run's child receives, and refuses a run
 * whose project would quietly reopen the background-task switch.
 *
 * **THE SDK'S `env` OPTION REPLACES, NEVER MERGES.** `sdk.d.ts:1647` states it
 * plainly, and a child started with a replaced environment runs without
 * `PATH` — which `agent-settings.ts:112` already records as the failure mode
 * that makes Plot's plugin gates fail OPEN. So {@link agentRunEnv} is the one
 * place this plan builds that object, and it merges.
 */

/** The variable every fleet run sets to stop the CLI backgrounding anything. */
export const BACKGROUND_TASKS_ENV_VAR = 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS';

/**
 * The tools every fleet run disallows: each exists only to wait on or manage
 * background work. The SDK runner passes them as `disallowedTools`; a
 * `command` runner's prompt file reads them from
 * {@link BACKGROUND_DENY_ENV_VAR} and passes `--disallowedTools`.
 */
export const BACKGROUND_DISALLOWED_TOOLS: readonly string[] = [
  'Monitor',
  'ScheduleWakeup',
  'CronCreate',
  'TaskStop',
  'ListAgents',
];

/** The variable that carries {@link BACKGROUND_DISALLOWED_TOOLS}, comma-separated, to a prompt file. */
export const BACKGROUND_DENY_ENV_VAR = 'PLOT_BACKGROUND_DENY';

/**
 * The background gate as environment, for every fleet run on either runner:
 * the switch, and the disallowed tools for a prompt file's `--disallowedTools`.
 *
 * @returns the two variables and their values.
 */
export const backgroundGateEnv = (): Readonly<Record<string, string>> => ({
  [BACKGROUND_TASKS_ENV_VAR]: '1',
  [BACKGROUND_DENY_ENV_VAR]: BACKGROUND_DISALLOWED_TOOLS.join(','),
});

/**
 * Builds the child's environment: the inherited process environment, Plot's
 * own `PLOT_*` values on top, and the background-task switch forced last.
 *
 * **MERGES, NEVER REPLACES.** `inherited` carries whatever the parent
 * process already holds — `PATH`, `HOME`, every ambient variable the caller
 * never meant to drop — and `plotEnv` carries the names the loop sets today
 * (`PLOT_BRANCH`, `PLOT_WORKTREE`, `PLOT_UNATTENDED`, `PLOT_AGENT`,
 * `PLOT_SCRIPT_DIR` and the rest `.plot/worker-prompt.sh` reads). Losing
 * either half silently is the exact defect this rule exists to make
 * impossible: a child missing `PATH` runs the plugin's gates fail-open, and a
 * child missing a `PLOT_*` name runs a worker that cannot find its own
 * branch.
 *
 * **THE SWITCH IS FORCED LAST**, so neither `inherited` nor `plotEnv` can
 * unset it by naming the same key — a project's own environment setting
 * `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=0` ahead of this call is exactly the
 * shape {@link backgroundSwitchRefusal} exists to catch before this function
 * is ever reached.
 *
 * @param inherited - the parent process's own environment.
 * @param plotEnv - the `PLOT_*` values this run adds.
 * @returns the merged environment, with {@link backgroundGateEnv} last.
 */
export const agentRunEnv = (
  inherited: Readonly<Record<string, string>>,
  plotEnv: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => ({
  ...inherited,
  ...plotEnv,
  ...backgroundGateEnv(),
});

/** One settings file's `env` key, as the caller read it. */
export interface SettingsEnvReading {
  /** The settings file's path, for the refusal's own sentence. */
  readonly path: string;
  /** The file's `env` object; `{}` where it has none or could not be read. */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Refuses a run whose project settings would reopen the background-task
 * switch, before the run is ever started.
 *
 * **A SETTINGS FILE CANNOT REMOVE PART 1 OF THE WAITING GATE.** The CLI
 * applies `~/.claude/settings.json`, `.claude/settings.json` and
 * `.claude/settings.local.json`'s own `env` keys to the child's environment,
 * none of which `agentSettingsRefusal` judges. So before a run starts, this
 * rule reads what each file would set and refuses where any of them names
 * {@link BACKGROUND_TASKS_ENV_VAR} at all — even a value of `'1'` is refused,
 * because a settings file that states the switch is one a later edit can flip
 * without this rule running again, and the only answer this rule can give
 * about a key it has not yet checked at the moment it fires is `unknown`
 * rather than `safe`.
 *
 * @param envs - the three settings files' own `env` readings, in the order
 *   the CLI applies them.
 * @returns the refusal naming the file and the key, or `null` where none of
 *   the three names it.
 */
export const backgroundSwitchRefusal = (
  envs: readonly SettingsEnvReading[],
): string | null => {
  const hit = envs.find((reading) => BACKGROUND_TASKS_ENV_VAR in reading.env);
  if (hit === undefined) return null;

  return `'${hit.path}' sets '${BACKGROUND_TASKS_ENV_VAR}' in its 'env' — this run is refused rather than started with background tasks silently reopened.`;
};
