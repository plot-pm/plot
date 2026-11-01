import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answer, held } from './delta-core.js';

/**
 * The two writes `plot-fleet-scan.sh --log-pulse` makes after a scan: one pulse
 * line in each plan's `## Notes`, and the bridge `.plot/state/last-pulse.json`.
 */

/** The counters a pulse line carries, under the scan's own names. */
export interface PulseCounts {
  waves: number;
  eligible: number;
  claimed: number;
  blocked: number;
  deferred: number;
  waiting: number;
  prereq_missing: number;
}

/**
 * Formats the pulse line.
 *
 * @param stamp - `date -u +%Y-%m-%dT%H:%MZ`.
 * @param counts - the summary's counters; `blocked` counts waves, `waiting` and `prereq_missing` count branches.
 * @returns the HTML comment appended to a plan.
 */
export const pulseLine = (stamp: string, counts: PulseCounts): string =>
  `<!-- pulse: ${stamp} — waves=${counts.waves} eligible=${counts.eligible} claimed=${counts.claimed} blocked=${counts.blocked} deferred=${counts.deferred} waiting=${counts.waiting} prereq_missing=${counts.prereq_missing} -->`;

/**
 * Inserts the line after the first `## Notes` heading, or appends a `## Notes` section.
 *
 * @param text - the plan.
 * @param line - the pulse line.
 * @returns the plan with the line added.
 */
export const withPulseLine = (text: string, line: string): string => {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('## Notes'));
  if (at < 0) return `${text}\n## Notes\n\n${line}\n`;
  return [...lines.slice(0, at + 1), '', line, ...lines.slice(at + 1)].join('\n');
};

/**
 * Appends the pulse line to a plan through its resolved symlink target.
 *
 * @param file - the plan's path; an index symlink resolves to the real file.
 * @param line - the pulse line.
 * @returns true when a plan was written; false when the file is absent.
 */
export const logToPlan = (file: string, line: string): boolean => {
  if (!existsSync(file)) return false;
  const target = realpathSync(file);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, withPulseLine(readFileSync(target, 'utf8'), line));
  renameSync(tmp, target);
  return true;
};

/**
 * Writes the bridge unless the fleet's writer holds it, and renders the delta
 * against what was on disk when the scan started.
 *
 * @param root - the repository root.
 * @param reading - the scan's reading document.
 * @param now - epoch ms.
 * @param respectHold - whether a held bridge is left unwritten; `--stream` passes false and always writes.
 * @returns the delta lines for stdout, `''` where the delta could not be read.
 */
export const recordBridge = (root: string, reading: Record<string, unknown>, now: number, respectHold = true): string => {
  const file = join(root, '.plot', 'state', 'last-pulse.json');
  const previous = existsSync(file) ? readFileSync(file, 'utf8').replace(/\n/g, '') : '';
  let delta = '';
  try {
    delta = answer(`${previous}\n${JSON.stringify(reading)}`, now);
  } catch {
    delta = '';
  }
  if (respectHold && previous !== '' && held(previous, now)) return delta;
  mkdirSync(join(root, '.plot', 'state'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `{"version":1,"at":${now},"pulse":${JSON.stringify(reading)},"ages":[],"branchUrlBase":"","approvedAt":[],"ideaPlans":[]}`);
  renameSync(tmp, file);
  return delta;
};
