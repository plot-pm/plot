import { FleetReadingSchema } from '../../entities/fleet.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import type {
  BranchDate,
  BranchTip,
  CommitLine,
  MergeStatus,
  RefScope,
  RefState,
  Refs,
  TreeBlob,
} from '../../ports/refs.js';
import {
  asJson,
  asLines,
  asText,
  runBytes,
  runProcess,
  runProcessSync,
  runScript,
  runScriptSync,
  resultOf,
} from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** The scan is 18 s against a large estate; the default two minutes would clip it. */
const PULSE_TIMEOUT_MS = 600_000;

/**
 * Sixty-four megabytes, for the batch read.
 *
 * The WHOLE plan estate arrives in one response here — 2.1 MB measured on this
 * repository — and the failure mode of guessing low is a silent truncation
 * midway through a stream that is parsed by declared offset, not by delimiter.
 */
const BATCH_MAX_BUFFER = 64 * 1024 * 1024;

/** `<mode> <type> <sha>\t<path>`, the format `ls-tree -r` emits. */
const TREE_LINE = /^(\d{6}) (\w+) ([0-9a-f]+)\t(.+)$/;

/** `<sha> blob <size>`, the header `cat-file --batch` frames each entry with. */
const BATCH_HEADER = /^([0-9a-f]+) blob (\d+)$/;

/**
 * Walks a `cat-file --batch` stream, decoding each body by its DECLARED length.
 *
 * The stream is bytes and is parsed as bytes: the header states a size in
 * BYTES, so decoding the whole stream to a string first would make every
 * subsequent offset wrong the moment any blob holds a non-ASCII character.
 *
 * A missing object answers `<sha> missing` and carries no body; the walk
 * resumes at the next header rather than desynchronising.
 *
 * @param stream - the batch response.
 * @returns each readable blob's content, keyed by its sha.
 */
const blobsOf = (stream: Buffer): ReadonlyMap<string, string> => {
  const found = new Map<string, string>();
  let at = 0;
  while (at < stream.length) {
    const nl = stream.indexOf(0x0a, at);
    if (nl === -1) break;
    const header = BATCH_HEADER.exec(stream.toString('utf8', at, nl));
    if (!header) {
      at = nl + 1;
      continue;
    }
    const size = Number(header[2]);
    const start = nl + 1;
    found.set(header[1]!, stream.toString('utf8', start, start + size));
    at = start + size + 1; // the newline that follows every body
  }
  return found;
};

/** Thirty-two megabytes: the whole ref database of a large estate in one reply. */
const REFS_MAX_BUFFER = 32 * 1024 * 1024;

/** Which ref namespaces each scope asks `for-each-ref` about. */
const NAMESPACES: Record<RefScope, readonly string[]> = {
  local: ['refs/heads'],
  remote: ['refs/remotes/origin'],
  both: ['refs/heads', 'refs/remotes'],
};

/**
 * Reads `<ref> <sha>` pairs, dropping anything that is not one.
 *
 * @param stdout - the listing.
 * @returns each readable pair, in the order given.
 */
const refStatesOf = (stdout: string): readonly RefState[] =>
  asLines(stdout).flatMap((line) => {
    const [ref, sha] = line.split(' ');
    return ref && sha ? [{ ref, sha }] : [];
  });

/**
 * Pairs the oids `hash-object --stdin-paths` printed with the paths it was given.
 *
 * A SHORT reply is a failure and throws, which is what makes the batch's
 * all-or-nothing contract enforceable: the command aborts at the first
 * unreadable path having already printed the oids before it, so a caller handed
 * the short list would read a complete answer about a smaller set.
 *
 * @param stdout - one oid per line.
 * @param paths - the paths hashed, in the order they were sent.
 * @returns each path's oid.
 */
const oidsOf = (
  stdout: string,
  paths: readonly string[],
): ReadonlyMap<string, string> => {
  const oids = asLines(stdout);
  if (oids.length !== paths.length) {
    throw new Error(`git hash-object: ${oids.length} oids for ${paths.length} paths`);
  }
  return new Map(paths.map((path, at) => [path, oids[at]!]));
};

/**
 * Reads git refs directly, and the fleet's pulse through `plot-fleet-scan.sh`.
 *
 * Git is called without a wrapper script because there is none to wrap: the
 * ref questions are single `git` invocations, and a shell script around one
 * `git rev-parse` would add a process without adding an implementation.
 *
 * The pulse is the exception and goes through the scan, which already derives
 * every plan's slice verdicts in one pass.
 *
 * @param context - where the scripts and the repository are.
 * @returns a `Refs` backed by git and the fleet scan.
 */
export const refsGit = (context: ShellContext): Refs => {
  const scan = scriptPath(context, 'plot-fleet-scan.sh');
  const inRepo = { cwd: context.repoRoot };

  const defaultBranch = (): Promise<PortResult<string>> =>
    runScript(
      'bash',
      ['-c', 'git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed "s|^origin/||" || git rev-parse --abbrev-ref HEAD'],
      asText,
      inRepo,
    );

  return {
    defaultBranch,

    listBranches: (remote) =>
      runScript(
        'git',
        remote
          ? ['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin']
          : ['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads'],
        (stdout) => asLines(stdout).filter((name) => name !== 'HEAD'),
        inRepo,
      ),

    isMergedByAncestry: async (branch): Promise<PortResult<MergeStatus>> => {
      const main = await defaultBranch();
      if (!main.ok) return answered<MergeStatus>('unknown');
      const run = await runProcess(
        'git',
        ['merge-base', '--is-ancestor', branch, `origin/${main.value}`],
        inRepo,
      );
      if (run.code === 0) return answered<MergeStatus>('merged');
      if (run.code === 1) return answered<MergeStatus>('not-merged');
      return answered<MergeStatus>('unknown');
    },

    resolve: (ref) =>
      runScript('git', ['rev-parse', ref], asText, inRepo),

    changedFiles: async (branch) => {
      const main = await defaultBranch();
      if (!main.ok) return main as PortResult<readonly string[]>;
      return runScript(
        'git',
        ['diff', '--name-only', `origin/${main.value}...${branch}`],
        asLines,
        inRepo,
      );
    },

    pulse: async () => {
      const run = await runProcess('bash', [scan, '--json'], {
        ...inRepo,
        timeoutMs: PULSE_TIMEOUT_MS,
      });
      return resultOf(run, (stdout) => FleetReadingSchema.parse(asJson(stdout)));
    },


    listBlobs: (ref, dir) =>
      runScript(
        'git',
        ['ls-tree', '-r', ref, '--', dir],
        // Split rather than `asLines`: that helper trims every line, and a
        // path is what follows the tab verbatim.
        (stdout): readonly TreeBlob[] =>
          stdout.split('\n').flatMap((line) => {
            const m = TREE_LINE.exec(line);
            return m && m[2] === 'blob'
              ? [{ mode: m[1]!, sha: m[3]!, path: m[4]! }]
              : [];
          }),
        inRepo,
      ),

    readBlobs: async (shas) => {
      // An empty list is an answer, and asking git for one would hang: `--batch`
      // reads until stdin closes and reports nothing, so the round trip buys a
      // spawn and an empty map either way.
      if (shas.length === 0) return answered<ReadonlyMap<string, string>>(new Map());
      const run = await runBytes(
        'git',
        ['cat-file', '--batch'],
        shas.join('\n') + '\n',
        { ...inRepo, maxBuffer: BATCH_MAX_BUFFER },
      );
      return run.code === 0
        ? answered(blobsOf(run.stdout))
        : failed<ReadonlyMap<string, string>>();
    },

    branchTips: (patterns) =>
      patterns.length === 0
        ? Promise.resolve(answered<readonly BranchTip[]>([]))
        : runScript(
            'git',
            ['for-each-ref', '--format=%(refname:short)\t%(objectname)', ...patterns],
            (stdout): readonly BranchTip[] =>
              asLines(stdout).flatMap((line) => {
                const [ref, sha] = line.split('\t');
                if (!ref || !sha) return [];
                return [{ branch: ref.replace(/^origin\//, ''), sha }];
              }),
            inRepo,
          ),

    repoRoot: () => runScript('git', ['rev-parse', '--show-toplevel'], asText, inRepo),

    countBehind: async (ref) => {
      // IS THE QUESTION ANSWERABLE, THEN ANSWER IT. A detached HEAD parked at
      // the ref's tip counts 0 commits behind, which reads exactly like a
      // current branch — so `symbolic-ref` is asked first and a detached HEAD
      // answers null rather than falling through to a confident zero.
      const head = await runProcess('git', ['symbolic-ref', '--quiet', 'HEAD'], inRepo);
      if (head.code !== 0 || head.stdout.trim() === '') return answered<number | null>(null);
      const count = await runProcess('git', ['rev-list', '--count', `HEAD..${ref}`], inRepo);
      if (count.code !== 0) return failed<number | null>();
      const raw = count.stdout.trim();
      // A non-numeric reading is a failed measurement rather than a zero one:
      // parsing loosely here turns every unforeseen git error into "up to date".
      return /^\d+$/.test(raw) ? answered<number | null>(Number(raw)) : failed<number | null>();
    },

    showFile: (ref, path) =>
      runScript('git', ['show', `${ref}:${path}`], (stdout) => stdout, inRepo),

    isRepository: async () => {
      const run = await runProcess('git', ['rev-parse', '--git-dir'], inRepo);
      // A non-zero exit IS the answer here, and the only one this call can give
      // wrongly: `rev-parse --git-dir` reaches no network and no remote, so it
      // fails for exactly one reason.
      return answered(run.code === 0);
    },

    refState: (scope) =>
      runScript(
        'git',
        ['for-each-ref', '--format=%(refname) %(objectname)', ...NAMESPACES[scope]],
        refStatesOf,
        { ...inRepo, maxBuffer: REFS_MAX_BUFFER },
      ),

    refStateSync: (scope) =>
      runScriptSync(
        'git',
        ['for-each-ref', '--format=%(refname) %(objectname)', ...NAMESPACES[scope]],
        refStatesOf,
        { ...inRepo, maxBuffer: REFS_MAX_BUFFER },
      ),

    countAheadSync: (branch) =>
      runScriptSync(
        'git',
        ['rev-list', '--count', `refs/remotes/origin/${branch}..refs/heads/${branch}`],
        (stdout) => {
          const raw = asText(stdout);
          // A non-numeric reading is a failed measurement, never a zero one:
          // zero reads as *nothing to push*, which is a claim about the branch.
          if (!/^\d+$/.test(raw)) throw new Error(`git rev-list: unreadable count ${raw}`);
          return Number(raw);
        },
        inRepo,
      ),

    hashFilesSync: (paths) => {
      if (paths.length === 0) {
        return answered<ReadonlyMap<string, string>>(new Map());
      }
      // Through stdin rather than an argument vector: a plan estate is
      // unbounded and an argument list is not, which is the reason
      // `--stdin-paths` is the form asked for.
      const run = runProcessSync(
        'git',
        ['hash-object', '--stdin-paths'],
        { ...inRepo, maxBuffer: REFS_MAX_BUFFER, stdin: paths.join('\n') + '\n' },
      );
      return resultOf(run, (stdout) => oidsOf(stdout, paths));
    },

    fileExistsSync: (ref, path) => {
      const run = runProcessSync('git', ['cat-file', '-e', `${ref}:${path}`], inRepo);
      // Exit 128 is *no such object*, exit 0 is *there*. Both are answers about
      // presence; neither is a failure of the call.
      return answered(run.code === 0);
    },

    branchDates: (patterns) =>
      patterns.length === 0
        ? Promise.resolve(answered<readonly BranchDate[]>([]))
        : runScript(
            'git',
            [
              'for-each-ref',
              '--format=%(refname:short)\t%(committerdate:unix)',
              ...patterns,
            ],
            (stdout): readonly BranchDate[] =>
              asLines(stdout).flatMap((line) => {
                const [ref, at] = line.split('\t');
                if (!ref || !at || !/^\d+$/.test(at)) return [];
                return [{ branch: ref.replace(/^origin\//, ''), committedAt: Number(at) }];
              }),
            { ...inRepo, maxBuffer: REFS_MAX_BUFFER },
          ),

    unmergedBranches: (ref) =>
      runScript(
        'git',
        ['branch', '-r', '--no-merged', ref, '--format=%(refname:short)'],
        (stdout) =>
          asLines(stdout)
            .map((name) => name.replace(/^origin\//, ''))
            .filter((name) => name !== 'HEAD'),
        { ...inRepo, maxBuffer: REFS_MAX_BUFFER },
      ),

    remoteUrl: (remote) =>
      runScript('git', ['remote', 'get-url', remote], asText, inRepo),

    commitsSync: (dir, range, max) =>
      runScriptSync(
        'git',
        ['-C', dir, 'log', '--no-merges', `--max-count=${max}`, '--format=%h %s', range],
        (stdout): readonly CommitLine[] =>
          asLines(stdout).flatMap((line) => {
            const at = line.indexOf(' ');
            return at === -1
              ? []
              : [{ sha: line.slice(0, at), subject: line.slice(at + 1) }];
          }),
        inRepo,
      ),
  };
};
