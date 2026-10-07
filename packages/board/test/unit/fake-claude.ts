// The stand-in `claude` for a board role on the SDK runner, put first on PATH,
// with a private HOME so no operator settings file reaches the run.
import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

import { useSdkConnector } from '../../src/server/board.js';
import { boardSdkConnector } from '../../src/server/sdk-runner.js';

const FAKE_CLAUDE_DIR = path.resolve(__dirname, '../fixtures/fake-claude');

/**
 * Routes this process's SDK runs to the stand-in, which hands back `output`.
 *
 * @param dir - a scratch directory the test removes; the HOME and the argv log go there.
 * @param output - the structured hand-back the stand-in ends with.
 * @returns the path of the log holding one JSON line of argv per start.
 */
export const useFakeClaude = (dir: string, output: Record<string, unknown>): string => {
  const home = path.join(dir, 'fake-home');
  fs.mkdirSync(home, { recursive: true });
  const argvLog = path.join(dir, 'fake-claude-argv.log');
  vi.stubEnv('HOME', home);
  vi.stubEnv('PATH', `${FAKE_CLAUDE_DIR}:${process.env.PATH ?? ''}`);
  vi.stubEnv('PLOT_AGENT_SETTINGS', '');
  vi.stubEnv('FAKE_CLAUDE_LOG', argvLog);
  vi.stubEnv('FAKE_CLAUDE_OUTPUT', JSON.stringify(output));
  useSdkConnector(boardSdkConnector);
  return argvLog;
};

/**
 * The `--model` the stand-in was last started with.
 *
 * @param argvLog - the log {@link useFakeClaude} answered.
 * @returns the model, or `undefined` where the start named none.
 */
export const lastModel = (argvLog: string): string | undefined => {
  const lines = fs.readFileSync(argvLog, 'utf8').trim().split('\n');
  const argv = (JSON.parse(lines[lines.length - 1]!) as { argv: string[] }).argv;
  const at = argv.indexOf('--model');
  return at >= 0 ? argv[at + 1] : undefined;
};

/**
 * Polls `read` until it leaves `running` and `unknown`, for at most 20 s.
 *
 * @param read - the status read-back.
 * @returns the last status read.
 */
export const settled = async <T extends { state: string }>(read: () => T): Promise<T> => {
  const deadline = Date.now() + 20_000;
  let status = read();
  while ((status.state === 'running' || status.state === 'unknown') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    status = read();
  }
  return status;
};
