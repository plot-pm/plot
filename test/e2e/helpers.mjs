// E2E choreography harness: sandbox repos with a bare origin, PATH-stubbed
// host CLIs, and the real plot scripts. Tests the multi-script seams —
// template → plot-plan-meta.sh → gate → symlinks → annotation back-fill →
// plot-impl-status.sh — that no unit test covers. It deliberately does NOT
// mechanize prose-only skill behavior (refusals, triage, coaching): those
// are Layer-2 promptfoo territory (see plans in the dev workspace).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
export const SCRIPTS = path.join(REPO_ROOT, 'skills', 'plot', 'scripts');
export const TEMPLATE = path.join(REPO_ROOT, 'skills', 'plot', 'templates', 'plan.md');

export function sh(cwd, cmd) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Sandbox repo with a BARE ORIGIN (plot-impl-status reads plans from
 * origin/<default>, so pushes must be real). `config` becomes CLAUDE.md's
 * ## Plot Config body.
 */
export function makeSandbox({ config = '', name = 'sandbox' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `plot-e2e-${name}-`));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  execSync(`git init -q --bare ${origin}`);
  fs.mkdirSync(work);
  sh(work, 'git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  fs.writeFileSync(path.join(work, 'CLAUDE.md'), `# Sandbox\n\n## Plot Config\n\n${config}\n`);
  sh(work, `git add -A && git commit -qm init && git remote add origin ${origin} && git push -qu origin main`);
  sh(work, 'git remote set-head origin main');
  return { root, origin, work, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** PATH-stubbed gh/bb: record argv per call, emit JSON via a lookup script. */
export function stubHost(casesJs = 'process.stdout.write("{}")') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-e2e-stub-'));
  const log = path.join(dir, 'calls.log');
  for (const name of ['gh', 'bb']) {
    fs.writeFileSync(
      path.join(dir, name),
      `#!/usr/bin/env bash\nprintf '%s\\n' "${name} $*" >> "${log}"\nexec node "${dir}/respond.mjs" "${name}" "$@"\n`,
    );
    fs.chmodSync(path.join(dir, name), 0o755);
  }
  fs.writeFileSync(path.join(dir, 'respond.mjs'),
    `const [cli, ...argv] = process.argv.slice(2);\n${casesJs}\n`);
  return {
    dir,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []),
  };
}

export function runScript(script, args, { cwd, stub, env = {} }) {
  return execFileSync('bash', [path.join(SCRIPTS, script), ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(stub ? { PATH: `${stub.dir}:${process.env.PATH}` } : {}),
      ...env,
    },
  });
}

export function planMeta(cwd, file, stub) {
  const out = runScript('plot-plan-meta.sh', [file], { cwd, stub });
  return JSON.parse(out.trim().split('\n').pop());
}

/** Instantiate the SHIPPED template (title/slug substituted) — real file. */
export function instantiatePlan(work, { date, slug, title, fields = {} }) {
  let t = fs.readFileSync(TEMPLATE, 'utf8')
    .replace(/<title>/g, title)
    .replace(/<slug>/g, slug);
  // Fill Status fields the way the skills document it (placeholder → value).
  for (const [k, v] of Object.entries(fields)) {
    t = t.replace(new RegExp(`- \\*\\*${k}:\\*\\* [^\\n]*`), `- **${k}:** ${v}`);
  }
  const rel = `docs/plans/${date}-${slug}.md`;
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(work, rel), t);
  fs.symlinkSync(`../${date}-${slug}.md`, path.join(work, 'docs', 'plans', 'active', `${slug}.md`));
  return rel;
}

/** The documented approve record edit (skill plot-approve step 4, mechanized). */
export function recordApproval(work, rel, { who = 'alice', channel = 'in-session', date = '2026-07-31' } = {}) {
  const f = path.join(work, rel);
  let t = fs.readFileSync(f, 'utf8');
  t = t.replace('- **Phase:** Draft', '- **Phase:** Approved');
  t = t.replace(/- \*\*Type:\*\* [^\n]*/, (m) => `${m}\n- **Approved:** ${date}, ${who}, ${channel}`);
  fs.writeFileSync(f, t);
}

export function recordStarted(work, rel, { who = 'alice', branch, date = '2026-07-31' }) {
  const f = path.join(work, rel);
  let t = fs.readFileSync(f, 'utf8');
  t = t.replace(/- \*\*Approved:\*\* [^\n]*/, (m) => `${m}\n- **Started:** ${date}, ${who}, \`${branch}\``);
  fs.writeFileSync(f, t);
}

export function annotatePr(work, rel, branch, ref) {
  const f = path.join(work, rel);
  let t = fs.readFileSync(f, 'utf8');
  t = t.replace(new RegExp("(- `" + branch.replace('/', '\\/') + "`[^\\n]*)"), `$1 → ${ref}`);
  fs.writeFileSync(f, t);
}

/** Run the phase gate exactly as the hook would (stdin JSON). */
export function runGate(cwd, command) {
  const input = JSON.stringify({ tool_input: { command } });
  try {
    execFileSync('bash', [path.join(SCRIPTS, 'plot-phase-gate.sh')], { cwd, input, encoding: 'utf8' });
    return 0;
  } catch (e) {
    return e.status;
  }
}
