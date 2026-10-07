import { existsSync, mkdirSync, appendFileSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { Desk, EndingRecord } from '../../ports/desk.js';
import type { Trees } from '../../ports/trees.js';

/** `.plot-worker.ending.json`, matching `entities/ending.ts`'s own constant. */
const ENDING_FILE = '.plot-worker.ending.json';

/** Where the main checkout keeps its append-only ending log, relative to its root. */
const ENDINGS_LOG = '.plot/state/endings.jsonl';

/** `.plot-worker.envelope.json`, matching `entities/declaration.ts`'s own constant. */
const DECLARATION_FILE = '.plot-worker.envelope.json';

/** The marker a stopped agent leaves for a person. */
const BLOCKED_MARKER_FILE = 'PLOT-BLOCKED.md';

/** The build gate's own account of what it handed back, and why. */
const CORRECTION_FILE = 'PLOT-CORRECTION.md';

/** What desk holds waiting out a usage limit. */
const LIMITED_FILE = '.plot-worker.limited';

/** The worker's own pid records, moved rather than deleted between desks. */
const WORKER_RECORD_NAMES = ['.plot-worker.pid', '.plot-worker.wrapper.pid'];

/** The desk's WorkerMonitor log: the file `plot-worker-loop.sh` writes and `findings.ts` reads. */
const FINDINGS_FILE = '.plot-worker.monitor.worker.jsonl';

/** The desk's BuildMonitor log: the file `plot-build-monitor.sh` used to write and `findings.ts` reads. */
const BUILD_FINDINGS_FILE = '.plot-worker.monitor.build.jsonl';

/** Best-effort file write: answers regardless of whether the write landed. */
const bestEffortWrite = (path: string, content: string): PortResult<void> => {
  try {
    writeFileSync(path, content);
  } catch {
    /* best effort */
  }
  return answered(undefined);
};

/**
 * Writes a desk's files directly, matching the shell's own temp-file-and-rename
 * and best-effort properties file by file.
 *
 * @param trees - where to resolve a worktree's main checkout from, for the
 *   `endings.jsonl` append.
 * @returns a `Desk` backed by the filesystem.
 */
export const deskFs = (trees: Trees): Desk => {
  // THE FIRST ENTRY IS THE MAIN CHECKOUT, matching `worktreesOf`'s own
  // ordering and `main_checkout_path`'s `awk 'NR==1'` equivalent. `trees.list()`
  // already answers for the one repository every worktree shares, so no
  // worktree argument scopes it further.
  const mainCheckoutPath = async (): Promise<string | null> => {
    const all = await trees.list();
    return all.ok ? (all.value[0]?.path ?? null) : null;
  };

  return {
    writeEnding: async (worktree, record: EndingRecord): Promise<PortResult<void>> => {
      const file = join(worktree, ENDING_FILE);
      const tmp = `${file}.plot-ending-tmp`;
      try {
        writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
      } catch {
        return failed<void>();
      }
      try {
        renameSync(tmp, file);
      } catch {
        return failed<void>();
      }

      // THE APPEND IS BEST EFFORT AND NEVER FAILS THE CALL. A missing main
      // checkout, a missing `.plot/state` directory, or a failed append
      // changes no ending and no result — matching `write_ending`'s own
      // comment on this line exactly.
      try {
        const main = await mainCheckoutPath();
        if (main) {
          mkdirSync(join(main, '.plot', 'state'), { recursive: true });
          appendFileSync(join(main, ENDINGS_LOG), `${JSON.stringify(record)}\n`);
        }
      } catch {
        /* best effort */
      }

      return answered(undefined);
    },

    writeBlockedMarker: async (worktree, text): Promise<PortResult<void>> => {
      const file = join(worktree, BLOCKED_MARKER_FILE);
      // NO-OVERWRITE: an existing marker is a question already asked.
      if (existsSync(file)) return answered(undefined);
      return bestEffortWrite(file, `${text}\n`);
    },

    sealDeclaration: async (worktree, branch, status = 'ok'): Promise<PortResult<void>> => {
      if (branch === '') return failed<void>();
      const file = join(worktree, DECLARATION_FILE);
      const tmp = `${file}.plot-seal-tmp`;

      let declared: Record<string, unknown> = {};
      if (existsSync(file)) {
        let text: string;
        try {
          text = readFileSync(file, 'utf8');
        } catch {
          return failed<void>();
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          // AN UNPARSEABLE FILE IS LEFT EXACTLY AS IT IS. Overwriting it would
          // launder bytes nobody can believe into a declaration that says the
          // branch finished.
          return failed<void>();
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return failed<void>();
        }
        declared = parsed as Record<string, unknown>;
      }

      const envelope = {
        ...declared,
        branch,
        status: status === 'blocked' ? 'blocked' : declared.status || 'ok',
      };
      try {
        writeFileSync(tmp, `${JSON.stringify(envelope, null, 2)}\n`);
        renameSync(tmp, file);
      } catch {
        return failed<void>();
      }
      return answered(undefined);
    },

    writeCorrection: async (worktree, branch, text, attempt, budget): Promise<PortResult<void>> => {
      const file = join(worktree, CORRECTION_FILE);
      const block =
        `## Correction ${attempt} of ${budget} — the build failed on \`${branch || '?'}\`\n\n` +
        `CI reported: ${text}\n\n` +
        `This is the build gate's verdict on the work you have already pushed. Your brief is still the specification and this replaces none of it — fix what CI is failing on, commit, and push. Read the run at the URL above for what failed.\n\n` +
        `---\n\n`;
      try {
        appendFileSync(file, block);
      } catch {
        /* best effort */
      }
      return answered(undefined);
    },

    appendCorrection: async (worktree, correction): Promise<PortResult<void>> => {
      try {
        appendFileSync(join(worktree, CORRECTION_FILE), `${correction}\n\n---\n\n`);
      } catch {
        /* best effort */
      }
      return answered(undefined);
    },

    writeLimitedRecord: async (worktree, resetEpoch, resetIso, limitLine): Promise<PortResult<void>> => {
      bestEffortWrite(join(worktree, LIMITED_FILE), `${resetEpoch}\t${resetIso}\t${limitLine}\n`);
      return answered(undefined);
    },

    clearLimitedRecord: async (worktree): Promise<PortResult<void>> => {
      try {
        rmSync(join(worktree, LIMITED_FILE), { force: true });
      } catch {
        /* best effort */
      }
      return answered(undefined);
    },

    moveWorkerRecord: async (from, to): Promise<PortResult<void>> => {
      if (from === to) return answered(undefined);
      for (const name of WORKER_RECORD_NAMES) {
        const source = join(from, name);
        if (!existsSync(source)) continue;
        let value: string;
        try {
          value = readFileSync(source, 'utf8').replace(/[\s]/g, '');
        } catch {
          continue;
        }
        if (value === '') continue;
        try {
          const destTmp = `${join(to, name)}.tmp`;
          writeFileSync(destTmp, value);
          renameSync(destTmp, join(to, name));
        } catch {
          continue;
        }
        try {
          const sourceTmp = `${source}.tmp`;
          writeFileSync(sourceTmp, '');
          renameSync(sourceTmp, source);
        } catch {
          /* leaving the source as it is matches the shell's own fallback */
        }
      }
      return answered(undefined);
    },

    publishFinding: async (worktree, { branch, finding, since, evidence }): Promise<PortResult<void>> => {
      const measuredAt = new Date().toISOString();
      const line = JSON.stringify({ monitor: 'WorkerMonitor', branch, worktree, finding, since, evidence, measuredAt });
      try {
        appendFileSync(join(worktree, FINDINGS_FILE), `${line}\n`);
      } catch {
        /* best effort */
      }
      return answered(undefined);
    },

    publishBuildFinding: async (worktree, { branch, finding, since, evidence }): Promise<PortResult<void>> => {
      const measuredAt = new Date().toISOString();
      const line = JSON.stringify({ monitor: 'BuildMonitor', branch, worktree, finding, since, evidence, measuredAt });
      try {
        appendFileSync(join(worktree, BUILD_FINDINGS_FILE), `${line}\n`);
      } catch {
        /* best effort */
      }
      return answered(undefined);
    },
  };
};
