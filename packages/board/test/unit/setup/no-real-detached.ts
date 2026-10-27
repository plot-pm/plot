import { vi } from 'vitest';

// A board unit test starts no detached process unless it passes `detached` in
// its options. The board's default `Detached` is `detachedNode()`, which
// starts a real `node` that outlives the test: as the PR reader it opens
// `<repo>/.plot/logs/pr-reader.log` and writes into `PLOT_PR_INDEX_HOME`
// after the test removed both. Here the default starts nothing and reports
// an exited child.
vi.mock('@plot-pm/domain/adapters/detached/detached-node', () => ({
  detachedNode: () => ({
    node: () => ({ pid: 0, exitCode: () => 0 }),
  }),
}));
