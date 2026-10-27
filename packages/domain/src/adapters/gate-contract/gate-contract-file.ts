import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { answered, unaskable, type PortResult } from '../../port-result.js';
import type { GateContractReader, ResolvedGate } from '../../ports/gate-contract.js';
import { runProcess } from '../run-script.js';

/** The relative path a plot plugin install carries its gate at, under its own `installPath`. */
const GATE_RELATIVE_PATH = 'skills/plot/scripts/board/plot-gate.mjs';

/** The seams a test needs so a suite never reads the operator's own plugin registry. */
export interface GateContractFileOptions {
  /** Overrides the plugin registry's directory; `CLAUDE_CONFIG_DIR` or `~/.claude/plugins` otherwise. */
  pluginRoot?: string;
  /** Overrides the repository's own fallback gate path, for tests. */
  repoGatePath?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

interface InstallRecord {
  scope?: string;
  installPath?: string;
  projectPath?: string;
}

interface PluginRegistry {
  plugins?: Record<string, InstallRecord[]>;
}

const pluginRootOf = (options: GateContractFileOptions, env: Record<string, string | undefined>): string =>
  options.pluginRoot ?? join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'plugins');

/**
 * Resolves and reads a repository's gate, three tiers deep: a `scope:
 * "project"` plot install whose `projectPath` matches the repository root,
 * else a `scope: "user"` plot install, else the repository's own
 * `skills/plot/scripts/board/plot-gate.mjs`.
 *
 * **CACHES `spawnContract` BY THE GATE FILE'S SIZE AND MTIME.** A gate does
 * not change while a board or fleetd process runs except by a reinstall or a
 * rebuild, both of which change the file on disk — so a cheap `stat` decides
 * whether the (comparatively expensive) `node <gate> --spawn-contract` spawn
 * is worth repeating, the same cheapness `worker-loop.ts`'s loop-restart
 * check already relies on for its own hash.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a `GateContractReader` backed by the plugin registry and a spawn.
 */
export const gateContractFile = (options: GateContractFileOptions = {}): GateContractReader => {
  const env = options.env ?? process.env;
  const pluginRoot = pluginRootOf(options, env);

  const registryPath = join(pluginRoot, 'installed_plugins.json');

  const readRegistry = async (): Promise<PluginRegistry | null> => {
    let text: string;
    try {
      text = await readFile(registryPath, 'utf8');
    } catch {
      return null;
    }
    try {
      return JSON.parse(text) as PluginRegistry;
    } catch {
      return null;
    }
  };

  const plotInstalls = (registry: PluginRegistry): InstallRecord[] =>
    Object.entries(registry.plugins ?? {})
      .filter(([key]) => key.startsWith('plot@'))
      .flatMap(([, records]) => records);

  let cache: { size: number; mtimeMs: number; number: number } | null = null;

  return {
    resolve: async (repoRoot: string): Promise<PortResult<ResolvedGate>> => {
      const registry = await readRegistry();
      if (registry !== null) {
        const installs = plotInstalls(registry);
        const project = installs.find(
          (install) => install.scope === 'project' && install.projectPath === repoRoot && install.installPath,
        );
        if (project?.installPath !== undefined) {
          return answered({ path: join(project.installPath, GATE_RELATIVE_PATH), source: 'project-plugin' });
        }
        const user = installs.find((install) => install.scope === 'user' && install.installPath);
        if (user?.installPath !== undefined) {
          return answered({ path: join(user.installPath, GATE_RELATIVE_PATH), source: 'user-plugin' });
        }
      }
      const repoGatePath = options.repoGatePath ?? join(repoRoot, GATE_RELATIVE_PATH);
      return answered({ path: repoGatePath, source: 'repo-script' });
    },

    spawnContract: async (gate: string): Promise<PortResult<number>> => {
      let signature: { size: number; mtimeMs: number };
      try {
        const stats = await stat(gate);
        signature = { size: stats.size, mtimeMs: stats.mtimeMs };
      } catch {
        return unaskable<number>('gate-unreadable');
      }
      if (cache !== null && cache.size === signature.size && cache.mtimeMs === signature.mtimeMs) {
        return answered(cache.number);
      }
      const run = await runProcess('node', [gate, '--spawn-contract']);
      const text = run.stdout.trim();
      if (run.code !== 0 || !/^[1-9][0-9]*$/.test(text)) {
        return unaskable<number>('gate-no-answer');
      }
      const number = Number(text);
      cache = { ...signature, number };
      return answered(number);
    },
  };
};
