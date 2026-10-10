import { FindingSchema, type Finding } from '../entities/finding.js';
import { currentFindings } from './attention.js';

/**
 * The three logs a desk can hold, by the filenames the monitors write.
 *
 * Named rather than globbed: a glob over `.jsonl` would also read an agent's
 * own output, and a file that happened to parse as a finding would publish
 * findings nobody measured.
 */
export const MONITOR_LOGS: readonly string[] = [
  '.plot-worker.monitor.worker.jsonl',
  '.plot-worker.monitor.agent.jsonl',
  '.plot-worker.monitor.build.jsonl',
];

/** How much of a monitor log a reader takes, in bytes, counted from the end. */
export const MAX_LOG_BYTES = 256 * 1024;

/**
 * The findings one monitor log's text currently holds.
 *
 * Lines that are not a valid {@link Finding} are skipped: a monitor appends
 * while a reader reads, so a truncated last line is the ordinary case. The
 * last line per slot wins and a `clear` drops its slot.
 *
 * @param raw - the log's text, oldest line first.
 * @returns the findings that hold, in first-published order.
 */
export const findingsInText = (raw: string): readonly Finding[] => {
  const parsed: Finding[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const result = FindingSchema.safeParse(JSON.parse(trimmed));
      if (result.success) parsed.push(result.data);
    } catch {
      // Not JSON: a partially written line, or something else's output.
    }
  }
  return currentFindings(parsed);
};
