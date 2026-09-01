/**
 * THE READ PATH'S SYNCHRONOUS PREFIX, as a call graph rather than as a grep.
 *
 * `2026-08-31-the-read-path-stops-spawning.md`, the Proving slice. The gate that
 * uses it is `test/unit/a-read-route-spawns-nothing.test.ts`; the tests that
 * prove it are `test/unit/no-sync-spawn.test.ts`.
 *
 * ## Why a call graph and not a file grep
 *
 * The obvious gate is *"no `execFileSync` in the read-path files"*, and it is
 * wrong in both directions here.
 *
 * It fires on files that are innocent. Three read-path files kept a synchronous
 * twin beside the async one they now use — `board.ts:readConfig`,
 * `registry.ts:readManifestDirConfig`, `agent-log.ts:readWorktreeRoot` — each
 * one documented, each one reached by write routes the plan explicitly leaves
 * for a later slice. A gate that reddens them is a gate someone turns off.
 *
 * And it passes on files that are guilty. `fleet-state.ts` holds no spawn and
 * calls `buildBoard`, which calls fourteen other modules; a spawn introduced in
 * any of them is on `/api/board` and no per-file grep sees it.
 *
 * So the population is not a list of files. It is **the functions that run on
 * the request's own stack**, walked from the read route's entry points.
 *
 * ## What "on the stack" means, and why `await` is the boundary
 *
 * This is the measurement's definition, not a convenient one. The defect was
 * found with `sample <pid> 5`: 4258 of 4262 main-thread samples held
 * `node::SyncProcessRunner::Spawn` **below the request handler**. A synchronous
 * spawn cannot yield, so while it runs the event loop serves nothing — a static
 * file timed out at 15 s beside one.
 *
 * A spawn on a later tick is a different defect with a different blast radius,
 * and this plan deliberately does not own it.
 *
 * So the walk follows a call and stops at an `await`:
 *
 * - **An awaited call is followed.** An async function runs synchronously up to
 *   its own first `await`, and that prefix is on this stack. `refresh()` in
 *   `fleet.ts` records exactly this: *"`void refresh(...)` reads like
 *   fire-and-forget and was not one"* — three forks ran on the request thread of
 *   whichever poll first warmed the cache, because they sat before its first
 *   await.
 * - **Everything textually after an `await` is not.** It resumes on a later
 *   turn, below a microtask rather than below the handler.
 * - **A nested function body is not followed.** A callback passed to
 *   `setInterval`, a `.map()` lambda's body, an arrow stored for later — none of
 *   them run at the point they are written.
 *
 * ## What it cannot see, stated rather than implied
 *
 * The resolution is by NAME, over a module's own definitions and its relative
 * imports. It therefore does not follow a call through a value: a function held
 * in a variable, reached through an object property, or handed in as a
 * parameter. Two consequences, and both are the reason the gate that uses this
 * asserts its population is non-empty and names the sweep beside it:
 *
 * - A spawn behind an injected function is invisible here. The ports are the
 *   answer to that and they are async by construction — a port method returns a
 *   Promise, so its implementation is behind an await by the time it runs.
 * - A renamed or moved entry point silently shrinks the walk to nothing. A gate
 *   over an empty set passes and proves nothing, which is why the entry points
 *   are asserted to resolve and the walked population is asserted to be large.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Every spelling of "spawn a child process and wait for it".
 *
 * Named individually rather than matched as `/Sync\(/`, because the property is
 * *blocks the event loop on a process*, and `readFileSync` does not. The two
 * `child_process` families are here in full — `execFileSync`, `execSync`,
 * `spawnSync` — plus `fork` and `spawn`'s synchronous spellings do not exist, so
 * this list is closed rather than merely current.
 */
export const SYNC_SPAWNS: readonly string[] = ['execFileSync', 'execSync', 'spawnSync'];

const SYNC_SPAWN_SET: ReadonlySet<string> = new Set(SYNC_SPAWNS);

/** A function the walk can enter: a declaration or an arrow/expression bound to a name. */
type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

interface ModuleFacts {
  /** Top-level function definitions, by the name callers use inside this file. */
  readonly defs: ReadonlyMap<string, FunctionNode>;
  /** Imported names, mapped to the file that defines them. Relative imports only. */
  readonly imported: ReadonlyMap<string, string>;
}

/** A synchronous spawn found on the request's stack, with the route it hangs below. */
export interface Offence {
  /** `fleet-state.ts:boardState -> board.ts:buildBoard -> ...`, ending in the call. */
  readonly trail: string;
  /** Which spelling — `execFileSync`, `spawnSync`, `execSync`. */
  readonly call: string;
}

/** Where the walk starts: a module and the exported function a route calls. */
export interface EntryPoint {
  /** Absolute path to the module. */
  readonly file: string;
  /** The function name, as the module declares it. */
  readonly fn: string;
}

export interface WalkResult {
  /** `file#fn` for every function that runs before the read path yields. */
  readonly reached: readonly string[];
  /** Every synchronous spawn on that prefix. Empty is the passing state. */
  readonly offences: readonly Offence[];
  /** Entry points whose function could not be found — a rename, or a moved file. */
  readonly unresolved: readonly EntryPoint[];
}

/**
 * How the walk reads a module, and how it finds the next one.
 *
 * Both are parameters and neither touches the filesystem by default, for the
 * reason `needs-real-board.ts` states about itself: the decision must be a
 * function of source TEXT, so its own tests can hand it invented modules. The
 * gate passes {@link onDisk}; the unit tests pass a map.
 *
 * `resolve` answers `null` for anything it will not follow — a bare package
 * specifier, or a relative path with no file behind it. `node:child_process` is
 * therefore never parsed: a synchronous spawn is recognised by the CALL name,
 * which is also what catches it when it arrives through a namespace import or a
 * re-export.
 */
export interface Sources {
  readonly read: (file: string) => string;
  readonly resolve: (fromFile: string, spec: string) => string | null;
}

/**
 * The real repository: read with `fs`, resolve a relative import to a `.ts` file.
 *
 * The sources import each other with a `.js` suffix (NodeNext), so the suffix is
 * rewritten before the file is looked for.
 */
export const onDisk: Sources = {
  read: (file) => fs.readFileSync(file, 'utf8'),
  resolve: (fromFile, spec) => {
    if (!spec.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), spec);
    const candidates = [base.replace(/\.js$/, '.ts'), `${base}.ts`, path.join(base, 'index.ts')];
    return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
  },
};

/**
 * A set of modules held in memory, addressed by basename.
 *
 * What the walker's own tests run on, and the reason the two arms cannot drift
 * from what the gate applies: one implementation, two source providers.
 */
export const inMemory = (files: Readonly<Record<string, string>>): Sources => ({
  read: (file) => {
    const found = files[path.basename(file)];
    if (found === undefined) throw new Error(`no such module: ${file}`);
    return found;
  },
  resolve: (fromFile, spec) => {
    if (!spec.startsWith('.')) return null;
    const name = `${path.basename(spec).replace(/\.js$/, '')}.ts`;
    return name in files ? path.join(path.dirname(fromFile), name) : null;
  },
});

/**
 * Parse one module into the two maps the walk needs.
 *
 * `sources` is a parameter rather than `fs` so the unit tests can hand this
 * invented modules — the same reason `needs-real-board.ts` is a function of
 * text. The gate passes {@link onDisk}.
 */
export const moduleFacts = (file: string, sources: Sources): ModuleFacts => {
  const sf = ts.createSourceFile(file, sources.read(file), ts.ScriptTarget.ESNext, true);
  const defs = new Map<string, FunctionNode>();
  const imported = new Map<string, string>();

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause
        && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = sources.resolve(file, node.moduleSpecifier.text);
      if (target !== null) {
        const clause = node.importClause;
        if (clause.name) imported.set(clause.name.text, target);
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            imported.set(element.name.text, target);
          }
        }
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) defs.set(node.name.text, node);
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer
            && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          defs.set(decl.name.text, decl.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return { defs, imported };
};

/**
 * The calls this function makes BEFORE it yields, in the order they run.
 *
 * The three rules, each one a statement about when code runs rather than about
 * where it is written:
 *
 * - `await x` — `x` itself is evaluated on this stack, so it is walked; then the
 *   prefix ends, because everything after resumes on a later tick.
 * - a nested function — skipped whole. Its body runs when it is invoked, which
 *   is not here.
 * - a call — its arguments evaluate first, then its callee. Both are on the
 *   stack, in that order.
 */
export const prefixCalls = (fn: FunctionNode): string[] => {
  const calls: string[] = [];
  let yielded = false;

  const walk = (node: ts.Node): void => {
    if (yielded) return;
    if (node !== fn
        && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
            || ts.isArrowFunction(node))) {
      return;
    }
    if (ts.isAwaitExpression(node)) {
      walk(node.expression);
      yielded = true;
      return;
    }
    if (ts.isCallExpression(node)) {
      for (const arg of node.arguments) walk(arg);
      if (yielded) return;
      const callee = node.expression;
      if (ts.isIdentifier(callee)) calls.push(callee.text);
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
        // A method call is recorded by its member name so `cp.execFileSync(...)`
        // is caught, and the receiver is still walked — `f().g()` runs `f` first.
        walk(callee.expression);
        calls.push(callee.name.text);
      } else walk(callee);
      return;
    }
    ts.forEachChild(node, walk);
  };

  ts.forEachChild(fn, walk);
  return calls;
};

/**
 * Walk the read path from its entry points and report every synchronous spawn on
 * it.
 *
 * Each function is entered once. That is a statement about the answer and not
 * merely about cost: the question is *can a request reach a synchronous spawn*,
 * so one witnessing trail per function is enough, and a cyclic call graph
 * terminates.
 *
 * @param entries - the functions a read route calls directly.
 * @param sources - how to read a module and how to find the next one. The gate
 *   passes {@link onDisk}; the unit tests pass {@link inMemory}, which is what
 *   keeps this a function of text.
 * @returns what was reached, what offends, and which entries did not resolve.
 */
export const walkReadPath = (
  entries: readonly EntryPoint[],
  sources: Sources,
): WalkResult => {
  const facts = new Map<string, ModuleFacts>();
  const factsFor = (file: string): ModuleFacts => {
    const known = facts.get(file);
    if (known) return known;
    const parsed = moduleFacts(file, sources);
    facts.set(file, parsed);
    return parsed;
  };

  const reached = new Set<string>();
  const offences: Offence[] = [];
  const unresolved: EntryPoint[] = [];

  const visit = (file: string, name: string, trail: readonly string[]): void => {
    const key = `${file}#${name}`;
    if (reached.has(key)) return;
    const module = factsFor(file);
    const fn = module.defs.get(name);
    if (!fn) return;
    reached.add(key);
    const here = [...trail, `${path.basename(file)}:${name}`];
    for (const call of prefixCalls(fn)) {
      if (SYNC_SPAWN_SET.has(call)) {
        offences.push({ trail: [...here, call].join(' -> '), call });
        continue;
      }
      if (module.defs.has(call)) visit(file, call, here);
      else {
        const from = module.imported.get(call);
        if (from !== undefined) visit(from, call, here);
      }
    }
  };

  for (const entry of entries) {
    const module = factsFor(entry.file);
    if (!module.defs.has(entry.fn)) unresolved.push(entry);
    visit(entry.file, entry.fn, []);
  }

  return { reached: [...reached].sort(), offences, unresolved };
};

/**
 * Every function the walk can reach if `await` is ignored — the whole call graph
 * under a read route, whichever tick each part runs on.
 *
 * The companion to {@link walkReadPath} and NOT a second gate. What it measures
 * is how much of the board a read request eventually drives, which is the number
 * that says whether the prefix walk is looking at a real program: a prefix of 11
 * functions is only meaningful beside the 165 it is a prefix of.
 *
 * It is also where the surviving synchronous spawns are counted. Three remain,
 * all of them behind an await and all of them documented by the wave that left
 * them; a fourth appearing here is a finding, and one MOVING onto the prefix is
 * the regression the gate refuses.
 */
export const walkWholeGraph = (
  entries: readonly EntryPoint[],
  sources: Sources,
): WalkResult => {
  const facts = new Map<string, ModuleFacts>();
  const factsFor = (file: string): ModuleFacts => {
    const known = facts.get(file);
    if (known) return known;
    const parsed = moduleFacts(file, sources);
    facts.set(file, parsed);
    return parsed;
  };

  const reached = new Set<string>();
  const offences: Offence[] = [];

  /** Every call in the body, at any depth, regardless of `await` — but not into a nested function. */
  const allCalls = (fn: FunctionNode): string[] => {
    const calls: string[] = [];
    const walk = (node: ts.Node): void => {
      if (node !== fn
          && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
              || ts.isArrowFunction(node))) {
        return;
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee)) calls.push(callee.text);
        else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
          calls.push(callee.name.text);
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(fn, walk);
    return calls;
  };

  const visit = (file: string, name: string, trail: readonly string[]): void => {
    const key = `${file}#${name}`;
    if (reached.has(key)) return;
    const module = factsFor(file);
    const fn = module.defs.get(name);
    if (!fn) return;
    reached.add(key);
    const here = [...trail, `${path.basename(file)}:${name}`];
    for (const call of allCalls(fn)) {
      if (SYNC_SPAWN_SET.has(call)) {
        offences.push({ trail: [...here, call].join(' -> '), call });
        continue;
      }
      if (module.defs.has(call)) visit(file, call, here);
      else {
        const from = module.imported.get(call);
        if (from !== undefined) visit(from, call, here);
      }
    }
  };

  for (const entry of entries) visit(entry.file, entry.fn, []);
  return { reached: [...reached].sort(), offences, unresolved: [] };
};
