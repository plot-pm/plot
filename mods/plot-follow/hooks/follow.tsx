import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register } from 'claude-code';

import type { Held } from '../types';

import {
  EMPTY_TURN_GATE,
  absorbFinding,
  isRepeat,
  paneLines,
  raisesToast,
  turnGate,
  type FollowedFinding,
  type TurnGateState,
} from './follow-channel.ts';

// The mod draws, toasts and submits. Every decision is follow-channel.ts's,
// a copy of packages/domain/src/rules/follow-channel.ts.

const PANE = 'plot-follow';
const RETRY_MS = 30_000;
const NOT_RUNNING = 'fleet channel: not running';

const held = atom({ plugin: 'plot-follow', key: 'held' } as const, { findings: [], heard: false } as Held);

const parseList = (raw: unknown): string[] =>
  String(raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');

/** The store key of one repository's gate; two repositories never share held lines. */
const gateKey = (cwd: string): string => `turn-gate:${cwd}`;

/** The persisted gate, or an empty one where the store holds anything else. */
const readGate = async ($: EngineInterface, cwd: string): Promise<TurnGateState> => {
  const stored = (await $.store.get(gateKey(cwd))) as Partial<TurnGateState> | undefined;
  if (!stored || typeof stored.count !== 'number' || !Array.isArray(stored.held)) return EMPTY_TURN_GATE;
  // A line stored as a bare string predates slots; it keeps its text and can no longer be cleared.
  const held = stored.held.map((h) => (typeof h === 'string' ? { slot: '', line: h } : h));
  return { ...EMPTY_TURN_GATE, ...stored, held };
};

const arrive = async ($: EngineInterface, cwd: string, finding: FollowedFinding, listed: string[]) => {
  // A finding the pane already holds, unchanged, is a republish after a fleetd restart.
  if (isRepeat((await read($, held)).findings, finding)) return;
  await update($, held, (h) => ({ ...h, findings: [...absorbFinding(h.findings, finding)] }));
  if (raisesToast(finding.finding)) $.ui.toast(`${finding.finding} — ${finding.branch}`);
  const decided = turnGate(await readGate($, cwd), finding, await $.clock.now(), listed);
  await $.store.set(gateKey(cwd), decided.state);
  if (decided.start) void $.prompt.submit({ text: decided.text });
};

/** What one module instance keeps: a reload builds a new one and the old loop is gone. */
interface Link {
  isRunning: boolean;
  isTimed: boolean;
  queue: Promise<unknown>;
}

// One arrival at a time: a read-modify-write of the gate must not interleave
// with the next finding's, or the later write drops the earlier held line.
const arriveInTurn = (
  $: EngineInterface,
  cwd: string,
  finding: FollowedFinding,
  listed: string[],
  link: Link,
) => {
  const run = link.queue.then(() => arrive($, cwd, finding, listed));
  link.queue = run.catch(() => undefined);
  return run;
};

/** Runs the follower and relays its lines; resolves when it has ended. */
const follow = async (
  $: EngineInterface,
  cwd: string,
  listed: string[],
  link: Link,
) => {
  const child = $.process.spawn({ argv: ['node', `${$.plugin.root}/bin/follow.mjs`, cwd] });
  const lines = child[Symbol.asyncIterator]();
  let buffer = '';
  let code: number | null = null;
  let exhausted = false;
  try {
    for (;;) {
      const step = await lines.next();
      if (step.done) {
        exhausted = true;
        code = step.value.code;
        break;
      }
      if (step.value.stream !== 'stdout') continue;
      buffer += step.value.text;
      let at = buffer.indexOf('\n');
      let ended = false;
      while (at !== -1) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf('\n');
        const message = JSON.parse(line);
        if (message.type === 'welcome') {
          await update($, held, () => ({ findings: message.current, heard: true, stale: false }));
          $.ui.status(undefined);
        } else if (message.type === 'finding') {
          await arriveInTurn($, cwd, message.finding, listed, link);
        } else if (message.type === 'served' || message.type === 'refused') {
          ended = true;
        }
      }
      // A served subscription is over, whatever the follower does next.
      if (ended) break;
    }
  } finally {
    // Whatever ended the loop, a follower still running is closed here, once.
    if (!exhausted) await lines.return?.(undefined as never);
  }
  // The exit code tells a quiet channel from a dead follower; silence does not.
  await update($, held, (h) => ({ ...h, heard: false }));
  $.ui.status(code === 0 ? undefined : NOT_RUNNING);
};

const connect = async ($: EngineInterface, cwd: string, listed: string[], link: Link) => {
  if (link.isRunning) return;
  link.isRunning = true;
  try {
    await follow($, cwd, listed, link);
  } catch {
    $.ui.status(NOT_RUNNING);
  } finally {
    link.isRunning = false;
  }
};

const ensureFollowing = ($: EngineInterface, cwd: string, listed: string[], link: Link) => {
  void connect($, cwd, listed, link);
  if (!link.isTimed) {
    link.isTimed = true;
    $.clock.every(RETRY_MS, () => void connect($, cwd, listed, link));
  }
};

export const register: Register = (on, options) => {
  const listed = parseList(options.turnOn);
  const link: Link = { isRunning: false, isTimed: false, queue: Promise.resolve() };

  on('session.start', async ($, e, next) => {
    const started = await next(e);
    void $.ui.open({ id: PANE, title: 'Fleet findings' });

    // Detached: session.start is awaited before the first prompt, and a
    // channel that is not there must not delay it.
    void (async () => {
      $.ui.status(NOT_RUNNING);
      // A reload re-runs this hook with the atom intact: what it holds was heard
      // on a connection that is gone, and stays marked until the channel answers.
      await update($, held, (h) => ({ ...h, stale: h.heard || h.findings.length > 0 }));
      ensureFollowing($, e.cwd, listed, link);
    })();

    return started;
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const { findings, heard, stale } = await read($, held);

    return (
      <Box flexDirection="column">
        {paneLines(findings, heard, stale).map((line) => (
          <Text>{line}</Text>
        ))}
      </Box>
    );
  });
};
