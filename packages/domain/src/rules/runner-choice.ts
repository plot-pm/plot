/**
 * Which runner starts one role's agent: the configured shell fragment, or the
 * Agent SDK.
 *
 * Reads what the project wrote and never `PATH`. `Agent runner` set wins.
 * Where it is absent the answer is `command`, unless the caller enables the
 * default flip and the project already names `claude` for the role.
 */

/** The two runners a role may start on. */
export type Runner = 'command' | 'sdk';

/** What a caller read about one role before asking which runner starts it. */
export interface RunnerChoiceReading {
  /** `Agent runner`, as the project wrote it; `''` where the key is absent. */
  readonly agentRunner: 'command' | 'sdk' | '';
  /** Whether this role is the worker. */
  readonly isWorker: boolean;
  /** The role's own command fragment, verbatim; `''` or `none` where the role has none. */
  readonly fragment: string;
  /** The worker's charter harness; `''` when unstated or this role is not the worker. */
  readonly charterHarness: string;
  /**
   * Whether an absent `Agent runner` may answer `sdk` for a role the project
   * already names `claude` for. `false` until slice 5 flips the default.
   */
  readonly defaultsToSdkWhenNamed: boolean;
}

/** What `runnerChoice` answers. Every answer carries a reason for the log. */
export type RunnerChoiceAnswer =
  | { readonly runner: 'command'; readonly reason: string }
  | { readonly runner: 'sdk'; readonly reason: string }
  | { readonly runner: 'refused'; readonly reason: string };

/** The refusal's exact text — a role with no command fragment has nothing configured to run. */
export const SDK_NEEDS_FRAGMENT_REASON =
  'the role has no command configured (its fragment is absent or `none`); configure the role before it runs on `Agent runner: sdk`';

/**
 * The first word of a command fragment after any `NAME=value` prefixes, as
 * its basename; `''` where the fragment holds no such word.
 *
 * @param fragment - the command fragment, verbatim.
 * @returns the command word, e.g. `claude` for
 *   `PLOT_UNATTENDED=1 /usr/local/bin/claude -p`.
 */
export const fragmentCommandWord = (fragment: string): string => {
  const words = fragment.trim().split(/\s+/).filter((word) => word !== '');
  const command = words.find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  if (command === undefined) return '';
  const parts = command.split('/');
  return parts[parts.length - 1]!;
};

/** Whether a fragment names no command: empty, or the word `none`. */
const hasNoFragment = (fragment: string): boolean => {
  const trimmed = fragment.trim();
  return trimmed === '' || trimmed === 'none';
};

/**
 * Whether a project already names `claude` for a role.
 *
 * A board role matches by its fragment's command word. The worker role
 * matches by its charter: unstated, or naming `claude`.
 */
const projectNamesClaude = (reading: RunnerChoiceReading): boolean => {
  if (reading.isWorker) {
    return reading.charterHarness === '' || reading.charterHarness === 'claude';
  }
  return fragmentCommandWord(reading.fragment) === 'claude';
};

/**
 * Answers which runner starts one role's agent.
 *
 * @param reading - what the caller read about the role.
 * @returns `command` or `sdk` with the reason for the log, or a refusal
 *   naming why the SDK cannot run here.
 */
export const runnerChoice = (reading: RunnerChoiceReading): RunnerChoiceAnswer => {
  if (reading.agentRunner === 'command') {
    return { runner: 'command', reason: '`Agent runner: command` is set' };
  }

  if (reading.agentRunner === 'sdk') {
    // THE CHARTER WINS OVER THE KEY: the SDK runs only `claude`, so a worker
    // whose charter names another harness keeps its configured fragment.
    if (reading.isWorker && reading.charterHarness !== '' && reading.charterHarness !== 'claude') {
      return {
        runner: 'command',
        reason: `the charter names the harness \`${reading.charterHarness}\`, and the SDK runs only \`claude\``,
      };
    }
    if (hasNoFragment(reading.fragment)) {
      return { runner: 'refused', reason: SDK_NEEDS_FRAGMENT_REASON };
    }
    return { runner: 'sdk', reason: '`Agent runner: sdk` is set' };
  }

  if (reading.defaultsToSdkWhenNamed && projectNamesClaude(reading)) {
    return { runner: 'sdk', reason: '`Agent runner` is absent and the project names `claude` for this role' };
  }
  return {
    runner: 'command',
    reason: reading.defaultsToSdkWhenNamed
      ? '`Agent runner` is absent and the project names no `claude` for this role'
      : '`Agent runner` is absent; the default is `command`',
  };
};
