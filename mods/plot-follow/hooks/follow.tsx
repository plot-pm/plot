import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register } from 'claude-code';

import type { Held } from '../types';

import {
  EMPTY_TURN_GATE,
  absorbFinding,
  paneLines,
  raisesToast,
  turnGate,
  type FollowedFinding,
  type TurnGateState,
} from './follow-channel.ts';

// The mod draws, toasts and submits. Every decision is follow-channel.ts's,
// a copy of packages/domain/src/rules/follow-channel.ts.

const PANE = 'plot-follow';
const GATE_KEY = 'turn-gate';
const RETRY_MS = 30_000;
const NOT_RUNNING = 'fleet channel: not running';

const held = atom({ plugin: 'plot-follow', key: 'held' } as const, { findings: [], heard: false } as Held);

const parseList = (raw: unknown): string[] =>
  String(raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');

/** The persisted gate, or an empty one where the store holds anything else. */
const readGate = async ($: EngineInterface): Promise<TurnGateState> => {
  const stored = (await $.store.get(GATE_KEY)) as Partial<TurnGateState> | undefined;
  return stored && typeof stored.count === 'number' && Array.isArray(stored.held)
    ? { ...EMPTY_TURN_GATE, ...stored }
    : EMPTY_TURN_GATE;
};

const arrive = async ($: EngineInterface, finding: FollowedFinding, listed: string[]) => {
  await update($, held, (h) => ({ ...h, findings: [...absorbFinding(h.findings, finding)] }));
  if (raisesToast(finding.finding)) $.ui.toast(`${finding.finding} — ${finding.branch}`);
  const decided = turnGate(await readGate($), finding, await $.clock.now(), listed);
  await $.store.set(GATE_KEY, decided.state);
  if (decided.start) void $.prompt.submit({ text: decided.text });
};

/** Runs the follower and relays its lines; resolves when it has ended. */
const follow = async ($: EngineInterface, cwd: string, listed: string[]) => {
  const child = $.process.spawn({ argv: ['node', `${$.plugin.root}/bin/follow.mjs`, cwd] });
  const lines = child[Symbol.asyncIterator]();
  let buffer = '';
  let code: number | null = null;
  for (;;) {
    const step = await lines.next();
    if (step.done) {
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
        await update($, held, () => ({ findings: message.current, heard: true }));
        $.ui.status(undefined);
      } else if (message.type === 'finding') {
        await arrive($, message.finding, listed);
      } else if (message.type === 'served' || message.type === 'refused') {
        ended = true;
      }
    }
    // A served subscription is over, whatever the follower does next.
    if (ended) {
      await lines.return?.(undefined as never);
      break;
    }
  }
  // The exit code tells a quiet channel from a dead follower; silence does not.
  await update($, held, (h) => ({ ...h, heard: false }));
  $.ui.status(code === 0 ? undefined : NOT_RUNNING);
};

export const register: Register = (on, options) => {
  const listed = parseList(options.turnOn);

  on('session.start', async ($, e, next) => {
    const started = await next(e);
    void $.ui.open({ id: PANE, title: 'Fleet findings' });

    // Detached: session.start is awaited before the first prompt, and a
    // channel that is not there must not delay it.
    void (async () => {
      $.ui.status(NOT_RUNNING);
      let isRunning = false;
      const connect = async () => {
        if (isRunning) return;
        isRunning = true;
        try {
          await follow($, e.cwd, listed);
        } catch {
          $.ui.status(NOT_RUNNING);
        } finally {
          isRunning = false;
        }
      };
      void connect();
      $.clock.every(RETRY_MS, () => void connect());
    })();

    return started;
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const { findings, heard } = await read($, held);

    return (
      <Box flexDirection="column">
        {paneLines(findings, heard).map((line) => (
          <Text>{line}</Text>
        ))}
      </Box>
    );
  });
};
