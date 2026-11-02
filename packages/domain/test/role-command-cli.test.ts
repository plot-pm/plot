// Runs every role's fragment through the real `agentRunCommand` and the real
// `boundedRunProcess` against a fake `claude` that models CLI 2.1.231: it reads
// `--agents` as JSON text only, and refuses unless that JSON names `--agent`.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';

import { agentRunCommand } from '../src/adapters/agent-run/agent-run-command.js';
import { boundedRunProcess } from '../src/adapters/bounded-run/bounded-run-process.js';
import { answered } from '../src/port-result.js';
import type { AgentRunRequest } from '../src/ports/agent-run.js';
import type { Processes } from '../src/ports/processes.js';
import { ROLE_NAMES, roleCommand, type RoleName } from '../src/rules/role-command.js';

const root = mkdtempSync(join(tmpdir(), 'role-command-cli-'));
const bin = join(root, 'bin');
mkdirSync(bin);
writeFileSync(
  join(bin, 'claude'),
  `#!/usr/bin/env node
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
const role = val('--agent');
let ok = false;
try {
  const j = JSON.parse(val('--agents'));
  ok = j !== null && typeof j === 'object' && !Array.isArray(j) && role in j;
} catch {}
if (!ok) {
  console.log("--agent '" + role + "' not found. Available agents: claude");
  process.exit(1);
}
console.log('FAKE-CLAUDE-OK');
`,
);
chmodSync(join(bin, 'claude'), 0o755);

// Only the bound-kill path reads the process table; these runs never time out.
const processes = { children: async () => answered([]) } as unknown as Processes;
const runner = (fragment: string) =>
  agentRunCommand({ boundedRun: boundedRunProcess(processes), fragment, limitPatterns: undefined, now: () => Date.now() });

let n = 0;
const runRole = async (name: RoleName, agentsPath: string) => {
  const dir = join(root, `run${n++}`);
  mkdirSync(dir);
  const logFile = join(dir, 'out.log');
  const built = roleCommand({ name, agentsFile: agentsPath, settingsFile: join(dir, 's.json') }, 5);
  if (built.read !== 'command') throw new Error(built.why);
  const req = {
    worktree: dir, prompt: 'go', resumeId: '', role: 'worker', harness: 'claude', model: '', effort: '',
    maxTurns: 0, maxSpendUsd: 0, boundSeconds: 0, contextWindow: 0, capabilities: [],
    env: { PATH: `${bin}:${process.env.PATH ?? ''}` }, logFile,
  } as AgentRunRequest;
  await runner(built.command).run(req);
  return readFileSync(logFile, 'utf8');
};

const agentsFile = (name: string, json: string, file = 'agents.json'): string => {
  const dir = mkdtempSync(join(root, `${name}-`));
  const p = join(dir, file);
  writeFileSync(p, json);
  return p;
};

afterAll(() => {
  // root is under the OS temp dir; vitest teardown leaves removal to the owned run
});

describe('roleCommand through the real runner', () => {
  it('the fake refuses a path and accepts JSON', async () => {
    const path = agentsFile('p', '{"fixer":{}}');
    const out = await runRole('fixer', path);
    expect(out).toContain('FAKE-CLAUDE-OK');
    const refusal = await new Promise<string>((res) => {
      import('node:child_process').then(({ spawnSync }) =>
        res(spawnSync(join(bin, 'claude'), ['--agent', 'fixer', '--agents', path]).stdout.toString()));
    });
    expect(refusal).toContain("--agent 'fixer' not found");
  });

  for (const name of ROLE_NAMES) {
    it(`starts ${name}`, async () => {
      expect(await runRole(name, agentsFile(name, JSON.stringify({ [name]: { description: 'd' } })))).toContain('FAKE-CLAUDE-OK');
    });
  }

  it('survives a path holding a quote and a space', async () => {
    const p = agentsFile('q', '{"fixer":{}}', "it's here.json");
    expect(await runRole('fixer', p)).toContain('FAKE-CLAUDE-OK');
  });

  it("survives JSON holding a '", async () => {
    const p = agentsFile('j', JSON.stringify({ 'main-repair': { description: "don't stop", prompt: "it's" } }));
    expect(await runRole('main-repair', p)).toContain('FAKE-CLAUDE-OK');
  });

  it('fails when the agents file is missing', async () => {
    const out = await runRole('fixer', join(root, 'absent.json'));
    expect(out).toContain("--agent 'fixer' not found");
    expect(out).not.toContain('FAKE-CLAUDE-OK');
  });
});
