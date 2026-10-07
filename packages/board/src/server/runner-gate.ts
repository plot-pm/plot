import { runnerChoice, SDK_NEEDS_JS_LOOP_REASON } from '@plot-pm/domain';

/**
 * Why a worker may not start: `Agent runner: sdk` under `Worker loop: shell`.
 *
 * The shell loop has no SDK runner, so a worker started there would run the
 * `Worker command` fragment and ignore the configured runner. An absent
 * `Worker loop` reads `js`, as `plot-worker-loop.sh` reads it.
 *
 * @param read - reads one `## Plot Config` key, with its fallback.
 * @returns {@link SDK_NEEDS_JS_LOOP_REASON}, or `null` where the worker may start.
 */
export const sdkLoopRefusal = (read: (key: string, fallback: string) => string): string | null => {
  const runner = read('Agent runner', '');
  const answer = runnerChoice({
    agentRunner: runner === 'sdk' || runner === 'command' ? runner : '',
    isWorker: true,
    workerLoop: read('Worker loop', 'js') === 'shell' ? 'shell' : 'js',
    fragment: read('Worker command', ''),
    charterHarness: '',
    defaultsToSdkWhenNamed: false,
  });
  return answer.runner === 'refused' && answer.reason === SDK_NEEDS_JS_LOOP_REASON ? answer.reason : null;
};
