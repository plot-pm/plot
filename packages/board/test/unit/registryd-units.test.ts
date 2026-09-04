import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE OS IS THE SUPERVISOR'S SUPERVISOR, and these files are how it is told.
 *
 * *"Is a process that should be running actually running?"* is a machine-side
 * question. Answering it with another Plot component would need a supervisor
 * for that component; `launchd` and `systemd` terminate the regress.
 *
 * The tests below check the properties the daemon's design DEPENDS on — that
 * the units restart unconditionally, that they separate the two streams, and
 * that they name a path that exists. What a unit file means to its init system
 * is not testable here; what it says about this daemon is.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const unitsDir = join(repoRoot, 'skills/plot/units');
const read = (name: string) => readFileSync(join(unitsDir, name), 'utf8');

const PLIST = 'com.plot-pm.registryd.plist';
const SERVICE = 'plot-registryd.service';

describe('a unit exists for each init system', () => {
  it('ships a launchd plist', () => {
    expect(existsSync(join(unitsDir, PLIST))).toBe(true);
  });

  it('ships a systemd service', () => {
    expect(existsSync(join(unitsDir, SERVICE))).toBe(true);
  });

  it('ships install steps a person can follow without reading the source', () => {
    const readme = read('README.md');
    // The three things an installer cannot infer: where the file goes, what
    // fills its placeholders, and how to see that it worked.
    expect(readme).toContain('launchctl bootstrap');
    expect(readme).toContain('systemctl --user enable --now');
    expect(readme).toContain('__REPO_ROOT__');
    expect(readme).toContain('journalctl');
  });
});

describe('both units restart the daemon unconditionally', () => {
  /**
   * EVERY RECOVERABLE FAILURE IS NOW A TICK THAT REPORTS AND CONTINUES, so a
   * process that exited is a process that is GONE — and restarting it is
   * always right. A conditional restart would leave the estate unsupervised in
   * exactly the case the daemon exists for.
   */
  it('launchd keeps it alive', () => {
    const plist = read(PLIST);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  it('systemd restarts it always, and never gives up', () => {
    const service = read(SERVICE);
    expect(service).toMatch(/^Restart=always$/m);
    // A permanently stopped supervisor is the failure this unit prevents: the
    // machine that was unreachable for an hour is when the agents need it.
    expect(service).toMatch(/^StartLimitIntervalSec=0$/m);
  });

  it('both throttle a crash loop to the tick interval rather than fighting it', () => {
    expect(read(PLIST)).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>60<\/integer>/);
    expect(read(SERVICE)).toMatch(/^RestartSec=60$/m);
  });
});

describe('both units keep the two streams apart', () => {
  /**
   * An INCOMPLETE tick goes to stderr and a completed one to stdout, so
   * watching the error stream alone shows exactly the ticks that could not be
   * taken. A unit merging the streams would lose that.
   */
  it('launchd writes each stream to its own file', () => {
    const plist = read(PLIST);
    const out = /<key>StandardOutPath<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
    const err = /<key>StandardErrorPath<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
    expect(out).toBeDefined();
    expect(err).toBeDefined();
    expect(out).not.toBe(err);
  });

  it('systemd names the daemon in the journal, so the streams can be filtered', () => {
    const service = read(SERVICE);
    expect(service).toMatch(/^StandardOutput=journal$/m);
    expect(service).toMatch(/^StandardError=journal$/m);
    expect(service).toMatch(/^SyslogIdentifier=plot-registryd$/m);
  });
});

describe('both units tell the daemon which estate it supervises', () => {
  /**
   * `registryd-main.ts` reads `PLOT_REPO_ROOT` and falls back to
   * `process.cwd()`. Both are set, so neither the fallback nor an init
   * system's working-directory default decides which repository is supervised.
   */
  it('launchd sets the working directory and the variable', () => {
    const plist = read(PLIST);
    expect(plist).toContain('<key>WorkingDirectory</key>');
    expect(plist).toContain('<key>PLOT_REPO_ROOT</key>');
  });

  it('systemd sets the working directory and the variable', () => {
    const service = read(SERVICE);
    expect(service).toMatch(/^WorkingDirectory=__REPO_ROOT__$/m);
    expect(service).toMatch(/^Environment=PLOT_REPO_ROOT=__REPO_ROOT__$/m);
  });

  it('both give the job a PATH, because neither init system supplies one', () => {
    // git, gh and node are on none of the minimal PATHs launchd and systemd
    // hand a job, and every one of the daemon's readings needs one of them.
    expect(read(PLIST)).toContain('<key>PATH</key>');
    expect(read(SERVICE)).toMatch(/^Environment=PATH=/m);
  });
});

describe('both units run the daemon at background priority', () => {
  /**
   * A tick is 3.5 s against a 60 s interval — 6% duty — on the machine that
   * also hosts the workers it supervises. The supervisor must never be what
   * makes a worker slow.
   */
  it('launchd marks it Background', () => {
    expect(read(PLIST)).toMatch(/<key>ProcessType<\/key>\s*<string>Background<\/string>/);
  });

  it('systemd nices it and idles its IO', () => {
    const service = read(SERVICE);
    expect(service).toMatch(/^Nice=\d+$/m);
    expect(service).toMatch(/^IOSchedulingClass=idle$/m);
  });
});

describe('the units name the artifact that exists', () => {
  /**
   * THE PATH IS DOCUMENTED RATHER THAN HARD-CODED, because the placeholder is
   * what an installer fills. What is checkable is that the path the README
   * tells them to fill it with is real — a README naming a moved artifact is a
   * unit that fails with `203/EXEC` and no clue why.
   */
  it('the README points at the built daemon', () => {
    expect(read('README.md')).toContain('skills/plot/scripts/board/plot-registryd.mjs');
  });

  it('that artifact is in the repository', () => {
    expect(existsSync(join(repoRoot, 'skills/plot/scripts/board/plot-registryd.mjs'))).toBe(true);
  });
});
