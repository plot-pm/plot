/**
 * Which runner starts one role's agent: the configured shell fragment, or the
 * Agent SDK.
 *
 * **READS WHAT THE PROJECT WROTE, NEVER `PATH`.** `Agent runner` set wins.
 * When it is absent this rule answers `command` in this wave and every later
 * one until wave 5 flips the default — the presence of `claude` on `PATH`
 * decides nothing, in either wave. `MANIFESTO.md` Principle 5: Plot discovers
 * and adapts, and a project on another harness keeps `command` with no
 * config edit.
 */

/** The two runners a role may start on. */
export type Runner = 'command' | 'sdk';

/** What a caller read about one role before asking which runner starts it. */
export interface RunnerChoiceReading {
  /** `Agent runner`, as the project wrote it; `''` where the key is absent. */
  readonly agentRunner: 'command' | 'sdk' | '';
  /** Whether this role is the worker — the one role a loop kind can refuse. */
  readonly isWorker: boolean;
  /** `Worker loop`, as the project wrote it; irrelevant for a non-worker role. */
  readonly workerLoop: 'js' | 'shell' | '';
  /** The role's own command fragment, for logging and for the default match. */
  readonly fragment: string;
  /** The first word of {@link fragment} after any `NAME=value` prefixes; `''` where none. */
  readonly fragmentCommandWord: string;
  /** The worker's charter harness; `''` when unstated or this role is not the worker. */
  readonly charterHarness: string;
  /**
   * Whether an absent `Agent runner` may answer `sdk` for a role the project
   * already names `claude` for — wave 5's flip. `false` in every caller this
   * wave ships, so an absent key answers `command` regardless of what the
   * fragment or the charter name.
   */
  readonly defaultsToSdkWhenNamed: boolean;
}

/** What `runnerChoice` answers. */
export type RunnerChoiceAnswer =
  | { readonly runner: 'command' }
  | { readonly runner: 'sdk' }
  | { readonly runner: 'refused'; readonly reason: string };

/** The refusal's exact text — a worker under `Worker loop: shell` cannot run on the SDK. */
export const SDK_NEEDS_JS_LOOP_REASON =
  "`Agent runner: sdk` needs `Worker loop: js`; set `Worker loop: js`, or set `Agent runner: command`";

/**
 * Whether a project already names `claude` for a role, the match wave 5's
 * flip reads.
 *
 * A board role matches by its fragment's own command word; the worker role
 * matches by its loop AND its charter, because the SDK only lives in the JS
 * loop and a charter naming another harness must keep running that harness.
 */
const projectNamesClaude = (reading: RunnerChoiceReading): boolean => {
  if (reading.isWorker) {
    return (
      reading.workerLoop === 'js' &&
      (reading.charterHarness === '' || reading.charterHarness === 'claude')
    );
  }
  return reading.fragmentCommandWord === 'claude';
};

/**
 * Answers which runner starts one role's agent.
 *
 * @param reading - what the caller read about the role.
 * @returns `command`, `sdk`, or a refusal naming why the SDK cannot run here.
 */
export const runnerChoice = (reading: RunnerChoiceReading): RunnerChoiceAnswer => {
  if (reading.agentRunner === 'command') {
    return { runner: 'command' };
  }

  if (reading.agentRunner === 'sdk') {
    if (reading.isWorker && reading.workerLoop === 'shell') {
      return { runner: 'refused', reason: SDK_NEEDS_JS_LOOP_REASON };
    }
    return { runner: 'sdk' };
  }

  // Absent. This wave answers `command` unconditionally; wave 5's flip turns
  // on the project-names-claude match.
  if (reading.defaultsToSdkWhenNamed && projectNamesClaude(reading)) {
    return { runner: 'sdk' };
  }
  return { runner: 'command' };
};
