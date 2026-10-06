// Runs one SDK run through a built `plot-worker-loop.mjs`, as the JS loop
// runs one: `runnerDeps` reads the runner and builds the connector, and the
// connector runs the request. Prints the run's answer as one JSON line.
//
//   node sdk-standin.mjs <bundle> <scripts-dir> <desk> <bound-seconds>
const [bundle, scriptDir, desk, bound] = process.argv.slice(2);
const loop = await import(bundle);
const runner = await loop.runnerDeps({
  env: process.env,
  scriptDir,
  repoRoot: desk,
  worktree: desk,
  agent: '',
  configKey: (_root, key) => ({ 'Agent runner': 'sdk', 'Worker command': 'PLOT_MODEL=sonnet plot-worker-loop.sh' })[key],
  ports: { processes: { childrenOf: async () => ({ ok: true, value: [] }) }, boundedRun: { run: async () => ({ ok: false, why: 'failed' }) } },
  boundSeconds: Number(bound),
  agentSettings: '',
  checksOutFile: `${desk}/checks.out`,
  now: () => Date.now(),
  log: () => undefined,
});
if (runner.runner !== 'sdk') throw new Error(`the stand-in expected the sdk runner, got ${runner.runner}`);
const run = await runner.sdk.agentRun({ afterWait: false, commitsSinceWait: () => 0 }).run({
  worktree: desk,
  prompt: runner.sdk.prompt('infra/the-fixture'),
  resumeId: '',
  sessionId: '11111111-1111-4111-8111-111111111111',
  role: 'worker',
  harness: 'claude',
  model: runner.sdk.model,
  effort: '',
  maxTurns: runner.sdk.maxTurns,
  maxSpendUsd: 0,
  boundSeconds: Number(bound),
  contextWindow: runner.sdk.contextWindow,
  capabilities: [],
  env: { PLOT_BRANCH: 'infra/the-fixture' },
  logFile: `${desk}/run.log`,
});
process.stdout.write(`${JSON.stringify(run)}\n`);
