import type { PortResult } from '../port-result.js';

/**
 * Which gate a resolution step landed on, and why — carried alongside the
 * number so a status line can name the gate it compared against. Naming the
 * gate is deliberate, not a nice-to-have: a session started with
 * `--plugin-dir` or another `CLAUDE_CONFIG_DIR` cannot have its loaded gate
 * resolved by this reader, and a session that loaded the plugin before an
 * update keeps reading its OLD gate for its lifetime. Neither is detectable
 * here, so the status line names the path instead and leaves the judgement to
 * whoever reads it.
 */
export type GateSource = 'project-plugin' | 'user-plugin' | 'repo-script';

/** A resolved gate: where it lives, and which tier of the lookup found it. */
export interface ResolvedGate {
  /** The gate script's absolute path. */
  readonly path: string;
  /** Which tier of the three-tier lookup produced this path. */
  readonly source: GateSource;
}

/**
 * Resolves the gate a Claude Code session loads for a repository, and reads
 * its `--spawn-contract` number.
 *
 * **WHY A PORT AT ALL.** The board and fleetd both need the same answer —
 * "which gate would THIS session's Claude Code have loaded, and what number
 * does it report" — and both are plain local reads: `installed_plugins.json`
 * under `~/.claude/plugins` (or `CLAUDE_CONFIG_DIR`), and a `node <gate>
 * --spawn-contract` child process. Neither is a connector: no account, no
 * credentials, no rate limit.
 *
 * **THE THREE-TIER LOOKUP IS THE CONTRACT, NOT AN ADAPTER DETAIL.** A
 * `scope: "project"` install whose `projectPath` matches the repository root
 * outranks a `scope: "user"` install, which outranks this repository's own
 * `skills/plot/scripts/board/plot-gate.mjs` — the fallback that applies when
 * developing Plot itself, where no plugin install names this repository.
 */
export interface GateContractReader {
  /**
   * Resolves which gate this repository's Claude Code session would load.
   *
   * @param repoRoot - the repository root to resolve a project-scoped install against.
   * @returns the resolved gate; `unaskable` where no tier produces a readable path.
   */
  resolve(repoRoot: string): Promise<PortResult<ResolvedGate>>;

  /**
   * Runs a resolved gate's `--spawn-contract` and reads the number it prints.
   *
   * @param gate - a gate path, typically from {@link resolve}.
   * @returns the gate's own spawn contract number; `unaskable` where the gate
   *   does not answer (missing, not executable, prints nothing parseable).
   */
  spawnContract(gate: string): Promise<PortResult<number>>;
}
