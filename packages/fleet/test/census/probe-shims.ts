import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** One shimmed call: which tool, the TypeScript site that started its tree, the direct child, and its argv. */
export type ProbeCall = { tool: string; caller: string; child: string; argv: string[]; parent: string };

/** The field separator inside a logged argv; no argv this census reads carries it. */
const ARG_SEP = '\u001f';

/**
 * The real path of `tool` on the standard system `PATH`, so a shim never
 * calls itself.
 */
const realTool = (tool: string): string => {
  for (const dir of ['/bin', '/usr/bin', '/usr/local/bin']) {
    const candidate = join(dir, tool);
    if (existsSync(candidate)) return candidate;
  }
  return execFileSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8', env: { PATH: '/bin:/usr/bin' } }).trim();
};

/**
 * Writes a logging shim for each tool into `bin`: the shim appends one line
 * (tool, `CENSUS_CALLER`, `CENSUS_CHILD`, argv) to `log` and execs the real
 * tool with the same argv. `bin` must come first on the `PATH` of the process
 * under test.
 *
 * @param bin - a directory first on `PATH`.
 * @param log - the file each shim appends to.
 * @param tools - the tools to shim, for example `ps` and `dirname`.
 */
export const writeProbeShims = (bin: string, log: string, tools: readonly string[]): void => {
  for (const tool of tools) {
    const real = realTool(tool);
    const path = join(bin, tool);
    writeFileSync(
      path,
      [
        '#!/bin/bash',
        `parent=$('${realTool('ps')}' -o command= -p "$PPID" 2>/dev/null | tr '\\t\\n' '  ' | cut -c1-160)`,
        `IFS='${ARG_SEP}'; printf '%s\\t%s\\t%s\\t%s\\t%s\\n' '${tool}' "\${CENSUS_CALLER:-}" "\${CENSUS_CHILD:-}" "$*" "$parent" >> '${log}'; unset IFS`,
        `exec '${real}' "$@"`,
        '',
      ].join('\n'),
    );
    chmodSync(path, 0o755);
  }
};

/**
 * Reads the calls the shims logged, from line `from` on.
 *
 * @param log - the shim log.
 * @param from - the first line to read; 0 reads all.
 * @returns the calls, in the order they ran.
 */
export const readProbeCalls = (log: string, from = 0): ProbeCall[] => {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .slice(from)
    .map((line) => {
      const [tool = '', caller = '', child = '', args = '', parent = ''] = line.split('\t');
      return { tool, caller, child, argv: args === '' ? [] : args.split(ARG_SEP), parent };
    });
};

/** The number of lines the shim log holds. */
export const probeLogLines = (log: string): number =>
  existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((line) => line !== '').length : 0;

/**
 * Whether a call is one sourcing of `plot-worker-state.sh`: the load-time
 * `dirname -- "${BASH_SOURCE[0]}"` that resolves `plot-config.sh`. Each
 * sourcing also starts one `dirname` without `--`, from the file's header,
 * which this does not count a second time.
 */
export const isWorkerStateSource = (call: ProbeCall): boolean =>
  call.tool === 'dirname' && call.argv[0] === '--' && (call.argv[1] ?? '').endsWith('/plot-worker-state.sh');

/** Whether a call is a `ps`. */
export const isPs = (call: ProbeCall): boolean => call.tool === 'ps';
