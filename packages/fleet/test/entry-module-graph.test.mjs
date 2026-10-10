// The fleet's entries import nothing from `packages/board/`, directly or
// transitively. `@plot-pm/fleet` depends on the domain and on Node builtins;
// the board depends on the fleet, and never the other way round.
//
// A GREP OF THE SHIPPED BUNDLE PROVES NOTHING. Both bundles already ship with
// zero `node:http` and zero `createServer` — the minifier drops the unused
// exports, and `legalComments: 'none'` strips the `// src/server/board.ts`
// markers that would let a grep find the source file. This test instead
// re-builds each entry with `metafile: true` and reads which SOURCE FILES
// esbuild actually pulled in, the same options `build.mjs` uses.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(HERE, '..');

/** The board's package directory, as an absolute path with a trailing separator. */
const BOARD_DIR = path.join(PACKAGE_ROOT, '..', 'board') + path.sep;

/**
 * Builds one entry with a metafile and returns the board-side inputs it
 * pulled in, so a failure can name the first offending module rather than
 * report a bare count.
 *
 * @param entry - the entry file, relative to the package root.
 * @param extra - esbuild options the real build passes for this entry
 *   (`external`, `define`), so a test build resolves the same way.
 * @returns the board-side input paths, in the order esbuild reports them.
 */
const boardInputsFor = async (entry, extra = {}) => {
  const result = await esbuild.build({
    entryPoints: [path.join(PACKAGE_ROOT, entry)],
    absWorkingDir: PACKAGE_ROOT,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    metafile: true,
    outfile: path.join(PACKAGE_ROOT, 'dist/_entry-module-graph-scratch.mjs'),
    ...extra,
  });
  // Metafile keys are relative to `absWorkingDir`, so a board file reads as
  // `../board/src/…`. Resolving each key makes the check independent of that.
  return Object.keys(result.metafile.inputs).filter((key) =>
    path.resolve(PACKAGE_ROOT, key).startsWith(BOARD_DIR),
  );
};

describe('the fleet entries import nothing from the board', () => {
  it('registryd-main.ts pulls in no board module', async () => {
    const found = await boardInputsFor('src/server/entry/registryd-main.ts');
    assert.deepEqual(found, [], `registryd-main.ts still imports: ${found.join(', ')}`);
  });

  it('worker-loop.ts pulls in no board module', async () => {
    const found = await boardInputsFor('src/server/entry/worker-loop.ts', {
      external: ['@anthropic-ai/claude-agent-sdk-*'],
      define: { PLOT_EMBEDDED: 'true' },
    });
    assert.deepEqual(found, [], `worker-loop.ts still imports: ${found.join(', ')}`);
  });

  it('fleet-size.ts stays clean — a guard, not part of this slice', async () => {
    const found = await boardInputsFor('src/server/entry/fleet-size.ts');
    assert.deepEqual(found, [], `fleet-size.ts imports: ${found.join(', ')}`);
  });
  it('dispatch-command.ts and continue-command.ts pull in no board module', async () => {
    for (const entry of ['dispatch-command', 'continue-command']) {
      const found = await boardInputsFor(`src/server/entry/${entry}.ts`);
      assert.deepEqual(found, [], `${entry}.ts imports: ${found.join(', ')}`);
    }
  });
});

// A BUILD, NOT A GREP OF THE SHIPPED FILE: the command entries are rebuilt in
// memory with the real build's options, so the test needs no committed bundle.
// The refusal reasons must survive minification, and `node:http` must not
// appear — the board's HTTP half stays in the routes.
describe('the command bundles carry their refusals and no HTTP', () => {
  const build = async (entry) => {
    const result = await esbuild.build({
      entryPoints: [path.join(PACKAGE_ROOT, entry)],
      absWorkingDir: PACKAGE_ROOT,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      minify: true,
      write: false,
      outfile: path.join(PACKAGE_ROOT, 'dist/_entry-module-graph-scratch.mjs'),
    });
    return result.outputFiles[0].text;
  };

  it('the dispatch bundle names no-implement-command and implement-running, with no node:http', async () => {
    const text = await build('src/server/entry/dispatch-command.ts');
    assert.match(text, /no-implement-command/);
    assert.match(text, /implement-running/);
    assert.doesNotMatch(text, /node:http/);
  });

  it('the continue bundle names unknown-branch and no-worktree, with no node:http', async () => {
    const text = await build('src/server/entry/continue-command.ts');
    assert.match(text, /unknown-branch/);
    assert.match(text, /no-worktree/);
    assert.doesNotMatch(text, /node:http/);
  });
});
