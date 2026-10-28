import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type {
  PlanRecord,
  PlanRecordBranch,
  PlanRecordSlice,
  PlanRecordUnreadBranchItem,
  PlanStore,
} from '../../ports/plan-store.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import { asJsonLines, asText, runProcess, runScript, resultOf } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/**
 * One line of `plot-plan-meta.sh` output, before it is renamed to the port's
 * shape.
 *
 * Exported for {@link planStoreRef}, the ref-backed sibling adapter: both
 * spawn the SAME parser and rename its wire shape with the SAME function —
 * {@link planOf} — so the two adapters cannot drift into two readings of one
 * format contract.
 */
export interface RawPlan {
  file?: string;
  format?: string;
  phase?: string;
  phase_raw?: string;
  type?: string;
  title?: string;
  sprint?: string;
  story?: string;
  assignee?: string;
  branches?: string[];
  prs?: number[];
  deferred_prs?: number[];
  slices?: RawSlice[];
  review?: string;
  impl?: string;
  approved_raw?: string;
  spike_approved_raw?: string;
  delivered_raw?: string;
  released_raw?: string;
  started_raw?: string[];
  unread_branch_items?: RawUnreadBranchItem[];
  error?: string;
}

interface RawUnreadBranchItem {
  wave?: string;
  branch?: string;
  line?: string;
}

interface RawSlice {
  name?: string;
  branches?: RawBranch[];
}

interface RawBranch {
  branch?: string;
  deferred?: boolean;
  deferred_reason?: string;
  claimed?: string;
  waits_on?: string | readonly string[];
  spike?: boolean;
  commits?: readonly string[];
}

/**
 * Renames one branch line into the port's shape.
 *
 * `waits_on` is ABSENT rather than empty on a branch declaring no wait — the
 * parser's own contract (`plot-plan-meta.sh:677-688`) — so the default below is
 * what turns that absence into `PlanRecordBranch.waitsOn`'s `[]`.
 *
 * BOTH SHAPES ARE ACCEPTED. `plot-plan-meta.sh` now emits a list
 * (`the-parser-reads-every-wait`); a plan blob parsed by an OLDER copy of that
 * script still emits one bare name, and a string here is wrapped into the
 * one-item list the rest of the domain already expects.
 *
 * @param raw - one branch line from the parser.
 * @returns the record, with every absent field at its empty value.
 */
export const branchOf = (raw: RawBranch): PlanRecordBranch => ({
  branch: raw.branch ?? '',
  deferred: raw.deferred ?? false,
  deferredReason: raw.deferred_reason ?? '',
  claimed: raw.claimed ?? '',
  waitsOn: Array.isArray(raw.waits_on)
    ? raw.waits_on
    : raw.waits_on
      ? [raw.waits_on]
      : [],
  ...(raw.spike === true ? { spike: true } : {}),
  ...(raw.commits !== undefined && raw.commits.length > 0 ? { commits: raw.commits } : {}),
});

const sliceOf = (raw: RawSlice): PlanRecordSlice => ({
  name: raw.name ?? '',
  branches: (raw.branches ?? []).map(branchOf),
});

const unreadBranchItemOf = (raw: RawUnreadBranchItem): PlanRecordUnreadBranchItem => ({
  wave: raw.wave ?? '',
  branch: raw.branch ?? '',
  line: raw.line ?? '',
});

/**
 * The parser's older spelling of a plan's slice list.
 *
 * `plot-plan-meta.sh` ships separately from this package and still emits this
 * key for every plan written before the rename, so the inbound tolerance has
 * to stay. It is named once, here, and nothing downstream of this file reads
 * that spelling — the same split `readEitherSpelling` makes for the pulse.
 */
const LEGACY_SLICES_KEY = 'waves';

/**
 * Reads a plan's slice list under either of the parser's two spellings.
 *
 * A reader that took only the current spelling would report a plan with
 * branches and no slices, since the parser still emits the older key for every
 * plan written before the rename.
 *
 * @param raw - one JSON line from the parser.
 * @returns the slice list, empty when the line carries neither key.
 */
const slicesOf = (raw: RawPlan): RawSlice[] => {
  if (raw.slices !== undefined) return raw.slices;
  const legacy = (raw as Record<string, unknown>)[LEGACY_SLICES_KEY];
  return Array.isArray(legacy) ? (legacy as RawSlice[]) : [];
};

/**
 * Renames one parser line into the port's shape.
 *
 * Reads either of the parser's two spellings for a plan's slice list, since it
 * still emits the older one and a reader that took only the new spelling would
 * report a plan with branches and no slices.
 *
 * `rejectedRaw` is not among the parser's fields — `plot-plan-meta.sh` has no
 * `Rejected:` handling — so the caller supplies it separately, read from the
 * file's own text.
 *
 * @param raw - one JSON line from the parser.
 * @param rejectedRaw - the `Rejected:` record verbatim, or `''`.
 * @returns the record, with every absent field at its empty value.
 */
export const planOf = (raw: RawPlan, rejectedRaw = ''): PlanRecord => ({
  file: raw.file ?? '',
  format: raw.format ?? 'none',
  phase: raw.phase ?? '',
  phaseRaw: raw.phase_raw ?? '',
  type: raw.type ?? '',
  title: raw.title ?? '',
  sprint: raw.sprint ?? '',
  story: raw.story ?? '',
  assignee: raw.assignee ?? '',
  branches: raw.branches ?? [],
  prs: raw.prs ?? [],
  deferredPrs: raw.deferred_prs ?? [],
  slices: slicesOf(raw).map(sliceOf),
  review: raw.review ?? '',
  impl: raw.impl ?? '',
  approvedRaw: raw.approved_raw ?? '',
  spikeApprovedRaw: raw.spike_approved_raw ?? '',
  deliveredRaw: raw.delivered_raw ?? '',
  releasedRaw: raw.released_raw ?? '',
  startedRaw: raw.started_raw ?? [],
  rejectedRaw,
  unreadBranchItems: (raw.unread_branch_items ?? []).map(unreadBranchItemOf),
});

/**
 * Reads a `- **<name>:** ...` Status-block line from a plan's raw text.
 *
 * Matched by name rather than by position, since `plot-undeliver.sh` inserts
 * `Rejected:` ahead of a `Delivered:` line it keeps — the line that is last in
 * the file is not necessarily the one most recently written.
 *
 * @param body - the plan file's full text.
 * @param name - the record's name, e.g. `Rejected`.
 * @returns the line's value, trimmed, or `''` when the file carries no such line.
 */
export const statusField = (body: string, name: string): string =>
  body.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, 'm'))?.[1]?.trim() ?? '';

/**
 * Reads plan files through `plot-plan-meta.sh`, which is the format contract.
 *
 * The parser is not reimplemented here. It already knows the three spellings a
 * plan's implementation section may take and reports parse problems inside its
 * JSON rather than as a crash, so this adapter renames fields and does nothing
 * else.
 *
 * @param context - where the scripts and the repository are.
 * @returns a `PlanStore` backed by the shell parser.
 */
export const planStoreShell = (context: ShellContext): PlanStore => {
  const meta = scriptPath(context, 'plot-plan-meta.sh');
  const config = scriptPath(context, 'plot-config.sh');

  const readPlans = async (
    files: readonly string[],
  ): Promise<PortResult<readonly PlanRecord[]>> => {
    if (files.length === 0) return answered([]);
    const run = await runProcess('bash', [meta, ...files], { cwd: context.repoRoot });
    const parsed = resultOf(run, (stdout) =>
      asJsonLines<RawPlan>(stdout)
        .filter((raw) => raw.error === undefined)
        .map((raw) => ({ file: raw.file ?? '', plan: planOf(raw) })),
    );
    if (!parsed.ok) return parsed;
    // THE `Rejected:` LINE, read from each file's own text rather than the
    // parser's JSON — `plot-plan-meta.sh` has no field for it. A file this
    // adapter cannot read keeps `rejectedRaw` at `''`: the parser already
    // answered for the file, and a second, failed read must not turn that
    // answer into a failure.
    const withRejected = await Promise.all(
      parsed.value.map(async ({ file, plan }) => {
        let body = '';
        try {
          body = await readFile(resolve(context.repoRoot, file), 'utf8');
        } catch {
          /* rejectedRaw stays '' */
        }
        return { ...plan, rejectedRaw: statusField(body, 'Rejected') };
      }),
    );
    return answered(withRejected);
  };

  return {
    readPlans,

    readPlan: async (file) => {
      const many = await readPlans([file]);
      if (!many.ok) return many;
      const [first] = many.value;
      return first === undefined ? failed<PlanRecord>() : answered(first);
    },

    listPlans: () =>
      runScript(
        'bash',
        [
          '-c',
          'find docs/plans -maxdepth 1 -name "*.md" -type f | LC_ALL=C sort',
        ],
        (stdout) =>
          stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        { cwd: context.repoRoot },
      ),

    config: (key, fallback) =>
      runScript('bash', [config, 'get', key, fallback], asText, {
        cwd: context.repoRoot,
      }),

    listDir: async (dir) => {
      try {
        const names = await readdir(resolve(context.repoRoot, dir));
        return answered(names.sort());
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'ENOENT' ? answered([]) : failed<readonly string[]>();
      }
    },

    readText: async (file) => {
      try {
        return answered(await readFile(resolve(context.repoRoot, file), 'utf8'));
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'ENOENT' ? answered(null) : failed<string | null>();
      }
    },

    // WRITTEN WHOLE OR NOT AT ALL, the form `pr-index-file.ts` uses: a reader
    // that opens the file mid-write would parse half a plan. The temp file is a
    // sibling so the rename never crosses a filesystem boundary.
    writeText: async (file, content) => {
      const path = resolve(context.repoRoot, file);
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, content, { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        await rm(temp, { force: true });
        return failed<void>();
      }
    },
  };
};
