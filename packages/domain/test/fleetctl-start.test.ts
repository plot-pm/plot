import { describe, expect, it } from 'vitest';
import {
  agentDecision,
  reloadCommand,
  restartPlan,
  reloadFailedReport,
  restartReport,
  startProbeRefusal,
  type AgentsPassDesk,
  type RestartReading,
  type StartProbeReading,
} from '../src/rules/fleetctl-start.js';

const probe = (over: Partial<StartProbeReading> = {}): StartProbeReading => ({
  harnessName: 'claude',
  harnessBin: '/opt/bin/claude',
  harnessEnv: '',
  shadow: '/usr/local/bin/claude',
  shadowIsOther: false,
  platform: 'launchd',
  fleetd: '/work/plot/skills/plot/scripts/board/plot-fleetd.mjs',
  ...over,
});

describe('startProbeRefusal', () => {
  it('proceeds for an absolute harness, no shadow and an init system', () => {
    expect(startProbeRefusal(probe())).toBeUndefined();
  });

  it('refuses an unresolved harness and names the default when PLOT_HARNESS is unset', () => {
    const text = startProbeRefusal(probe({ harnessBin: '' }));
    expect(text).toMatch(/^plot-fleetctl: cannot resolve the agent harness 'claude' to a file on PATH\n/);
    expect(text).toContain("PLOT_HARNESS is unset, so the default name 'claude' was looked for.");
    expect(text).toContain("check with 'command -v claude'");
  });

  it('refuses a builtin or function answer, which names no directory, and names PLOT_HARNESS when set', () => {
    const text = startProbeRefusal(probe({ harnessName: 'my-harness', harnessBin: 'my-harness', harnessEnv: 'my-harness' }));
    expect(text).toContain("cannot resolve the agent harness 'my-harness'");
    expect(text).toContain("PLOT_HARNESS is set to 'my-harness', so that is the name looked for.");
  });

  it("refuses another harness in node's directory and names its basename", () => {
    const text = startProbeRefusal(
      probe({ harnessName: '/opt/bin/claude', shadow: '/usr/local/bin/claude', shadowIsOther: true }),
    );
    expect(text).toBe(
      "plot-fleetctl: node's directory holds another 'claude' (/usr/local/bin/claude)\n  The unit puts that directory first, so workers would run it instead of /opt/bin/claude.\n  Fix it: remove or rename it, or use the node from the directory that holds the harness, then run this again.",
    );
  });

  it('refuses a machine with neither launchd nor systemd, after the harness probes', () => {
    expect(startProbeRefusal(probe({ platform: 'none' }))).toMatch(/neither launchd nor systemd here.*\n.*node \/work\/plot/);
    expect(startProbeRefusal(probe({ platform: 'none', harnessBin: '' }))).toMatch(/cannot resolve the agent harness/);
  });
});

const reading = (over: Partial<RestartReading> = {}): RestartReading => ({
  label: 'com.plot-pm.fleetd',
  platform: 'launchd',
  loaded: true,
  pid: '4242',
  commit: 'abc1234',
  dryRun: false,
  ...over,
});

describe('restartPlan', () => {
  it('refuses an unloaded unit and names /plot-fleet --start, even on a dry run', () => {
    for (const dryRun of [false, true]) {
      const plan = restartPlan(reading({ loaded: false, dryRun }));
      expect(plan.kind).toBe('refuse');
      expect(plan.kind === 'refuse' && plan.message).toContain('/plot-fleet --start');
    }
  });

  it('previews the unit, the pid and the commit on a dry run', () => {
    expect(restartPlan(reading({ dryRun: true }))).toEqual({
      kind: 'preview',
      message: 'would reload com.plot-pm.fleetd (launchd) — agents untouched\n  supervisor pid: 4242\n  bundle commit:  abc1234',
    });
  });

  it('prints an unreadable pid and commit as such, never as 0', () => {
    const plan = restartPlan(reading({ dryRun: true, pid: '', commit: '' }));
    expect(plan.kind === 'preview' && plan.message).toContain('supervisor pid: unreadable');
    expect(plan.kind === 'preview' && plan.message).toContain('bundle commit:  unknown');
  });

  it('reloads a loaded unit outside a dry run', () => {
    expect(restartPlan(reading())).toEqual({ kind: 'reload' });
  });
});

describe('reloadCommand', () => {
  it('names launchctl kickstart -k in the gui domain, never bootout', () => {
    expect(reloadCommand({ label: 'com.plot-pm.fleetd', platform: 'launchd', unit: 'plot-fleetd', uid: 501 })).toEqual([
      'launchctl',
      'kickstart',
      '-k',
      'gui/501/com.plot-pm.fleetd',
    ]);
  });

  it('names systemctl --user restart for the unit', () => {
    expect(reloadCommand({ label: 'com.plot-pm.fleetd', platform: 'systemd', unit: 'plot-fleetd', uid: 1000 })).toEqual([
      'systemctl',
      '--user',
      'restart',
      'plot-fleetd',
    ]);
  });

  it('names nothing without an init system', () => {
    expect(reloadCommand({ label: 'x', platform: 'none', unit: 'x', uid: 0 })).toBeUndefined();
  });
});

describe('reloadFailedReport', () => {
  it('names the reload command and its exit code, not a missing pid', () => {
    expect(reloadFailedReport({ label: 'com.plot-pm.fleetd', exitCode: '113', command: 'launchctl kickstart -k gui/501/com.plot-pm.fleetd', readCmd: 'launchctl print gui/501/com.plot-pm.fleetd' })).toBe(
      "plot-fleetctl: the reload of 'com.plot-pm.fleetd' failed with exit 113: launchctl kickstart -k gui/501/com.plot-pm.fleetd\n  Read it: launchctl print gui/501/com.plot-pm.fleetd",
    );
  });
});

describe('restartReport', () => {
  const result = { label: 'com.plot-pm.fleetd', commit: 'abc1234', waitSeconds: '30', readCmd: 'launchctl print gui/$(id -u)/com.plot-pm.fleetd' };

  it('reports both pids and the commit when the pid changed', () => {
    expect(restartReport({ ...result, oldPid: '4242', newPid: '5555' })).toEqual({
      ok: true,
      message: 'supervisor restarted — com.plot-pm.fleetd\n  old pid: 4242\n  new pid: 5555\n  bundle commit: abc1234\n  agents untouched',
    });
  });

  it('fails naming the unit when the pid did not change', () => {
    const report = restartReport({ ...result, oldPid: '4242', newPid: '4242' });
    expect(report.ok).toBe(false);
    expect(report.message).toBe(
      "plot-fleetctl: 'com.plot-pm.fleetd' reported no new pid within 30s (was 4242, now 4242)\n  Read it: launchctl print gui/$(id -u)/com.plot-pm.fleetd",
    );
  });

  it('fails when the new pid is unreadable, and accepts any pid after an unreadable old one', () => {
    expect(restartReport({ ...result, oldPid: '4242', newPid: '' }).message).toContain('now unreadable');
    expect(restartReport({ ...result, oldPid: '', newPid: '5555' }).message).toContain('old pid: unreadable');
  });

  it('reports an unreadable commit as unknown', () => {
    expect(restartReport({ ...result, oldPid: '4242', newPid: '5555', commit: '' }).message).toContain('bundle commit: unknown');
  });
});

describe('restartPlan with --agents', () => {
  const base = { label: 'l', platform: 'launchd', loaded: true, pid: '1', commit: 'abc', dryRun: false };

  it('refuses an unattended caller before anything else, even with no unit loaded', () => {
    const plan = restartPlan({ ...base, loaded: false, agents: true, unattended: true });
    expect(plan.kind).toBe('refuse');
    expect(plan.kind === 'refuse' && plan.message).toContain('unattended');
  });

  it('proceeds for an attended caller, and plain --restart proceeds when unattended', () => {
    expect(restartPlan({ ...base, agents: true }).kind).toBe('reload');
    expect(restartPlan({ ...base, unattended: true }).kind).toBe('reload');
  });

  it('previews that free loops stop after the reload on a dry run', () => {
    const plan = restartPlan({ ...base, agents: true, dryRun: true });
    expect(plan.kind === 'preview' && plan.message).toContain('— free loops stopped after');
    expect(plan.kind === 'preview' && plan.message).not.toContain('agents untouched');
  });
});

describe('agentDecision', () => {
  const desk = (over: Partial<AgentsPassDesk> = {}): AgentsPassDesk => ({
    name: 'd', pid: '9', state: 'running', branch: '', sliceHasMerged: false,
    openPr: false, blocked: false, dirtyFiles: 0, pidCurrent: 'yes', ...over,
  });

  it('stops a free loop, wording a dry run as would stop', () => {
    expect(agentDecision(desk(), false)).toEqual({ action: 'stop', line: '  d (pid 9)  stopping — free loop' });
    expect(agentDecision(desk(), true).line).toContain('would stop');
  });

  it('refuses a recycled pid without regard to anything else', () => {
    const r = agentDecision(desk({ pidCurrent: 'no' }), false);
    expect(r.action).toBe('refuse');
    expect(r.line).toContain('belongs to another process');
  });

  it('keeps an agent whose process start was never recorded', () => {
    const r = agentDecision(desk({ pidCurrent: 'unknown' }), false);
    expect(r.action).toBe('keep');
    expect(r.line).toContain('kept — process start unreadable');
    expect(agentDecision(desk({ pidCurrent: 'unknown' }), true).line).toContain('would keep — process start unreadable');
  });

  it('keeps a loop for each reason and names it', () => {
    expect(agentDecision(desk({ openPr: true, branch: 'f/x' }), false).line).toContain('open PR');
    expect(agentDecision(desk({ openPr: undefined }), true).line).toContain('would keep — PR unreadable');
  });
});
