/**
 * The SDK connector for board roles on `Agent runner: sdk`, registered with
 * {@link useSdkConnector} when this module is imported.
 *
 * The board server's entry imports this module, so `board-server.mjs` carries
 * the SDK. No other entry imports it: a role started from another process on
 * the SDK runner is refused rather than putting the SDK in that bundle.
 * `agent-run-sdk.ts` is imported by its own path, never through the
 * `@plot-pm/domain/adapters` barrel.
 */
import fs from 'node:fs';
import os from 'node:os';

import { processesShell } from '@plot-pm/domain/adapters';
import {
  agentRunSdk,
  claudeOnPath,
  DEFAULT_READ_ONLY_DENY,
  settingsFilesOf,
  spawnAttached,
} from '@plot-pm/domain/adapters/agent-run/agent-run-sdk';
import type { AgentRun } from '@plot-pm/domain/ports/agent-run';

import { useSdkConnector, type BuildBoardOptions } from './board.js';

/**
 * Reads and parses a settings file.
 *
 * @param file - the file's absolute path.
 * @returns the parsed JSON; `undefined` where the file cannot be read or parsed.
 */
const parsedSettingsFile = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * Builds the SDK connector for one board role, from this process's
 * environment.
 *
 * The `Agent settings` file is the one `primeAgentSettings` resolved into
 * `PLOT_AGENT_SETTINGS` at startup, the file a `command` role receives: a
 * board role on the SDK starts without the operator's plugins exactly as one
 * on the shell does.
 *
 * @param opts - the board's options, for the processes adapter.
 * @returns the connector.
 */
export const boardSdkConnector = async (opts: BuildBoardOptions): Promise<AgentRun> => {
  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'PLOT_REPO_ROOT'),
  );
  const agentSettingsPath = process.env.PLOT_AGENT_SETTINGS ?? '';
  return agentRunSdk({
    inheritedEnv,
    readSettingsFiles: settingsFilesOf(process.env.HOME || os.homedir()),
    agentSettings: agentSettingsPath === '' ? undefined : parsedSettingsFile(agentSettingsPath),
    agentSettingsPath,
    pathToClaudeCodeExecutable: await claudeOnPath(process.env.PATH ?? ''),
    spawnClaudeCodeProcess: spawnAttached,
    processes: processesShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
    now: () => Math.floor(Date.now() / 1000),
    afterWait: false,
    commitsSinceWait: () => 0,
    readOnlyDeny: DEFAULT_READ_ONLY_DENY,
  });
};

useSdkConnector(boardSdkConnector);
