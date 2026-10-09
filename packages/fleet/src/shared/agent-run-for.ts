import { processesShell } from '@plot-pm/domain/adapters';
import { boundedRunProcess } from '@plot-pm/domain/adapters';
import { agentRunCommand } from '@plot-pm/domain/adapters/agent-run/agent-run-command';
import { HARNESS_LIMIT_LINES } from '@plot-pm/domain/adapters/harness/limit-lines';
import { boardAgentModel } from '@plot-pm/domain/rules/board-agent-models';
import { runnerChoice } from '@plot-pm/domain/rules/runner-choice';
import type { AgentRun } from '@plot-pm/domain/ports/agent-run';
import { readConfig as readConfigKey, type ConfigReadOptions } from './config-reader.js';

/** Which runner starts one board role's agent, the model its request names, and the connector. */
export interface AgentRunChoice {
  /** The runner `runnerChoice` answered for this role. */
  readonly runner: 'command' | 'sdk' | 'refused';
  /** Why, in `runnerChoice`'s words; on the SDK runner, also the model and where it came from. */
  readonly reason: string;
  /** The model the request names: `boardAgentModel`'s answer on the SDK runner, `''` otherwise. */
  readonly model: string;
  /** The connector; absent on a `refused` choice. */
  readonly agentRun?: AgentRun;
}

/** Builds the SDK connector a board role on `Agent runner: sdk` runs on. */
export type SdkConnector = (opts: ConfigReadOptions) => Promise<AgentRun>;

let sdkConnector: SdkConnector | undefined;

/**
 * Registers the SDK connector for this process. Only a process that may start
 * an SDK run registers one — `sdk-runner.ts` does, and the board server
 * imports it — so no other bundle carries the SDK. Without one, a role on
 * `Agent runner: sdk` is refused with that reason.
 *
 * @param connector - the connector builder, or `undefined` to remove it.
 */
export const useSdkConnector = (connector: SdkConnector | undefined): void => {
  sdkConnector = connector;
};

/**
 * Which runner starts one board role's agent, and the `AgentRun` connector
 * built for that choice.
 *
 * Built per call for the same reason as {@link refsFor}: the expense is never
 * in constructing the adapter. A board role has no charter, so the choice
 * reads only `Agent runner` and the role's own fragment
 * ({@link runnerChoice} with `isWorker: false`) — never a charter harness,
 * which is worker-only. **The SDK connector comes from
 * {@link useSdkConnector}**, never from an import here, so that bringing a
 * board role onto the SDK does not put the SDK in every bundle that imports
 * this module.
 *
 * @param opts - where to read, and optionally what to read through.
 * @param role - the role asked about, such as `idea` or `brief`.
 * @param fragmentKey - the `## Plot Config` key naming that role's command,
 *   such as `Idea command`.
 * @param readCfg - the config reader, defaulting to {@link readConfigKey}. A
 *   route that accepts its own `deps.config` override for testing must pass
 *   that same reader here — otherwise this call reads the real
 *   `## Plot Config` regardless of what the caller's own refusal checks saw.
 * @returns which runner this role starts on, the model its request names, and
 *   the connector for it; a `refused` choice carries no connector — the
 *   caller answers its own `unaskable`/no-command refusal exactly as today.
 */
export const agentRunFor = async (
  opts: ConfigReadOptions,
  role: string,
  fragmentKey: string,
  readCfg: (opts: ConfigReadOptions, key: string, fallback: string) => string = readConfigKey,
): Promise<AgentRunChoice> => {
  const fragment = readCfg(opts, fragmentKey, '');
  const agentRunner = readCfg(opts, 'Agent runner', '');
  const choice = runnerChoice({
    agentRunner: agentRunner === 'sdk' || agentRunner === 'command' ? agentRunner : '',
    isWorker: false,
    fragment,
    charterHarness: '',
    defaultsToSdkWhenNamed: false,
  });
  if (choice.runner === 'refused') return { runner: 'refused', reason: choice.reason, model: '' };

  if (choice.runner === 'command') {
    const processes = processesShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });
    const boundedRun = boundedRunProcess(processes);
    return {
      runner: 'command',
      reason: choice.reason,
      // A FRAGMENT NAMES ITS OWN MODEL. The `command` adapter does not read
      // `request.model`, so the request carries none.
      model: '',
      agentRun: agentRunCommand({ boundedRun, fragment, limitPatterns: HARNESS_LIMIT_LINES.claude, now: Date.now }),
    };
  }

  const settings = boardAgentModel(role, { agentModels: readCfg(opts, 'Agent models', ''), roleCommand: fragment });
  const reason = `${choice.reason}; model ${settings.model || 'the CLI default'} (${settings.modelSource})`;
  if (sdkConnector === undefined) {
    return {
      runner: 'refused',
      reason: `${choice.reason}, and this process does not carry the SDK runner; the board's own process starts SDK runs`,
      model: '',
    };
  }
  return { runner: 'sdk', reason, model: settings.model, agentRun: await sdkConnector(opts) };
};

