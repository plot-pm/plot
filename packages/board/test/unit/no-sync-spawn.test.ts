import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  inMemory,
  moduleFacts,
  prefixCalls,
  walkReadPath,
  walkWholeGraph,
} from '../gate/no-sync-spawn.js';

/**
 * THE WALKER'S OWN TESTS, over invented sources.
 *
 * `test/unit/a-read-route-spawns-nothing.test.ts` applies this to the real read
 * path, where it answers *is there a spawn on the stack today* — and today the
 * answer is no. That is the state a gate should be in, and it is also the state
 * in which the gate proves nothing about itself: a walker that returned an empty
 * list unconditionally would pass exactly the same way.
 *
 * So the two directions are separated the way `needs-real-board.ts` separates
 * them. The decision is a function of source TEXT: `Sources` is a parameter,
 * these tests pass `inMemory`, and the gate passes `onDisk`. One
 * implementation, so the two cannot drift.
 *
 * **The direction that matters most is the one the live suite cannot show**: a
 * spawn the walk MUST find. Proving it needs a program with a spawn in it, and
 * nobody should leave one in `src/` to be found.
 */

/** A one-file program, addressed by an absolute-looking path the resolver accepts. */
const dir = path.resolve('/virtual');
const at = (name: string): string => path.join(dir, name);

const sourcesFrom = inMemory;

describe('prefixCalls — what runs before a function yields', () => {
  const only = (source: string): string[] => {
    const facts = moduleFacts(at('m.ts'), inMemory({ 'm.ts': source }));
    const fn = facts.defs.get('f');
    expect(fn, 'the fixture must define `f`').toBeTruthy();
    return prefixCalls(fn!);
  };

  it('reads calls in the order they run', () => {
    expect(only('function f() { a(); b(); }')).toEqual(['a', 'b']);
  });

  it('stops at the first await — what follows resumes on a later tick', () => {
    // The whole basis of the gate. A spawn after an await is a different defect
    // with a different blast radius, and this plan deliberately does not own it.
    expect(only('async function f() { a(); await x(); b(); }')).toEqual(['a', 'x']);
  });

  it('follows the awaited call itself', () => {
    // An async callee runs synchronously up to ITS first await, on this stack.
    // `fleet.ts:refresh` is the measured case: three forks sat before its first
    // await and ran on the request thread of whichever poll warmed the cache.
    expect(only('async function f() { await slow(); }')).toEqual(['slow']);
  });

  it('does not enter a nested function — it does not run here', () => {
    // A callback handed to `setInterval` runs on the timer, not on this stack.
    expect(only('function f() { setInterval(() => boom(), 5); a(); }'))
      .toEqual(['setInterval', 'a']);
  });

  it('evaluates arguments before the call they belong to', () => {
    expect(only('function f() { outer(inner()); }')).toEqual(['inner', 'outer']);
  });

  it('stops on an await inside an argument', () => {
    expect(only('async function f() { outer(await inner(), later()); }'))
      .toEqual(['inner']);
  });

  it('records a method call by its member name', () => {
    // `cp.execFileSync(...)` must be caught, so the spelling is the member and
    // not the receiver.
    expect(only('function f() { cp.execFileSync("git"); }')).toEqual(['execFileSync']);
  });

  it('walks a receiver before the method called on it', () => {
    expect(only('function f() { make().use(); }')).toEqual(['make', 'use']);
  });
});

describe('walkReadPath — the read path as a call graph', () => {
  it('finds a spawn the entry point makes itself', () => {
    const result = walkReadPath(
      [{ file: at('route.ts'), fn: 'handle' }],
      sourcesFrom({ 'route.ts': 'export async function handle() { execFileSync("git"); }' }),
    );
    expect(result.offences.map((o) => o.call)).toEqual(['execFileSync']);
  });

  it('finds a spawn three modules down, across imports', () => {
    // The reason this is a call graph and not a per-file grep: the controller
    // holds no spawn and reaches fourteen modules that might.
    const result = walkReadPath(
      [{ file: at('route.ts'), fn: 'handle' }],
      sourcesFrom({
        'route.ts': 'import { build } from "./mid.js";\nexport async function handle() { build(); }',
        'mid.ts': 'import { deep } from "./deep.js";\nexport function build() { deep(); }',
        'deep.ts': 'export function deep() { spawnSync("git"); }',
      }),
    );
    expect(result.offences).toHaveLength(1);
    expect(result.offences[0]!.trail)
      .toBe('route.ts:handle -> mid.ts:build -> deep.ts:deep -> spawnSync');
  });

  it('ignores a spawn that only runs after an await', () => {
    // The survivors in `fleet.ts:refresh` are exactly this shape, and calling
    // them offences would redden three files the plan leaves to a later slice.
    const result = walkReadPath(
      [{ file: at('route.ts'), fn: 'handle' }],
      sourcesFrom({
        'route.ts': 'import { slow } from "./slow.js";\n'
          + 'export async function handle() { await slow(); execFileSync("git"); }',
        'slow.ts': 'export async function slow() { await nothing(); execFileSync("git"); }',
      }),
    );
    expect(result.offences).toEqual([]);
  });

  it('ignores a spawn in a body that is deferred, not called', () => {
    const result = walkReadPath(
      [{ file: at('route.ts'), fn: 'handle' }],
      sourcesFrom({
        'route.ts': 'export function handle() { setInterval(() => execFileSync("git"), 5); }',
      }),
    );
    expect(result.offences).toEqual([]);
  });

  it('terminates on a cycle', () => {
    const result = walkReadPath(
      [{ file: at('route.ts'), fn: 'a' }],
      sourcesFrom({ 'route.ts': 'function b() { a(); }\nfunction a() { b(); }' }),
    );
    expect(result.reached).toHaveLength(2);
    expect(result.offences).toEqual([]);
  });

  it('reports an entry point it cannot resolve rather than walking nothing', () => {
    // A gate over an empty set passes and proves nothing. A renamed controller
    // is the way this shape dies quietly, so it is an answer and not a silence.
    const result = walkReadPath(
      [{ file: at('route.ts'), fn: 'gone' }],
      sourcesFrom({ 'route.ts': 'export function handle() {}' }),
    );
    expect(result.unresolved.map((e) => e.fn)).toEqual(['gone']);
    expect(result.reached).toEqual([]);
  });

  it('reaches an arrow bound to a name, not only a declaration', () => {
    // The domain style is arrows, and `fleet-state.ts` exports them.
    const result = walkReadPath(
      [{ file: at('route.ts'), fn: 'handle' }],
      sourcesFrom({ 'route.ts': 'export const handle = async () => { execSync("git"); };' }),
    );
    expect(result.offences.map((o) => o.call)).toEqual(['execSync']);
  });

  it('does not follow a bare package import', () => {
    // `node:child_process` is recognised by the call name, never by the import,
    // so a package is not parsed and cannot make the walk fail.
    const result = walkReadPath(
      [{ file: at('route.ts'), fn: 'handle' }],
      sourcesFrom({
        'route.ts': 'import { execFileSync } from "node:child_process";\n'
          + 'export function handle() { execFileSync("git"); }',
      }),
    );
    expect(result.offences.map((o) => o.call)).toEqual(['execFileSync']);
  });
});

describe('walkWholeGraph — the same call graph, ignoring await', () => {
  it('sees a spawn the prefix walk correctly skips', () => {
    // The two arms differ in exactly one place, and this is it: the survivor
    // count is what makes a spawn behind an await visible to a reviewer rather
    // than silent.
    const sources = sourcesFrom({
      'route.ts': 'export async function handle() { await pause(); execFileSync("git"); }',
    });
    const entries = [{ file: at('route.ts'), fn: 'handle' }];
    expect(walkReadPath(entries, sources).offences).toEqual([]);
    expect(walkWholeGraph(entries, sources).offences.map((o) => o.call)).toEqual(['execFileSync']);
  });

  it('still refuses to enter a deferred body', () => {
    // Not a second, laxer gate: a callback's body runs when it is invoked, and
    // ignoring `await` does not change that.
    const result = walkWholeGraph(
      [{ file: at('route.ts'), fn: 'handle' }],
      sourcesFrom({ 'route.ts': 'export function handle() { on(() => execFileSync("git")); }' }),
    );
    expect(result.offences).toEqual([]);
  });
});
