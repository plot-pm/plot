import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AgentCapabilities } from '../../ports/agent-capabilities.js';

/**
 * The real {@link AgentCapabilities}: `node plot-prompt.mjs --capabilities`.
 *
 * @param scriptsDir - the repository's scripts directory, holding `board/plot-prompt.mjs`.
 * @returns the {@link AgentCapabilities} port.
 */
export const agentCapabilitiesSystem = (scriptsDir: string): AgentCapabilities => ({
  declaredFor: (repoRoot, agent) => {
    if (agent === '') return { kind: 'none' };
    const bundle = path.join(scriptsDir, 'board', 'plot-prompt.mjs');
    if (!fs.existsSync(bundle)) return { kind: 'none' };
    try {
      const list = execFileSync('node', [bundle, '--capabilities', repoRoot, agent], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      return list === '' ? { kind: 'none' } : { kind: 'declared', list };
    } catch (err) {
      const failure = err as { status?: number; stderr?: string };
      if (failure.status === 3) return { kind: 'unreadable', detail: (failure.stderr ?? '').trim() };
      return { kind: 'none' };
    }
  },
});
