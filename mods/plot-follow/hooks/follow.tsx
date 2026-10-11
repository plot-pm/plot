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

const isAnnounced = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The persisted gate, or an empty one where the store holds anything else. */
const readGate = async ($: EngineInterface, cwd: string): Promise<TurnGateState> => {
  const stored = (await $.store.get(gateKey(cwd))) as Partial<TurnGateState> | undefined;
  if (!stored || typeof stored.count !== 'number' || !Array.isArray(stored.held)) return EMPTY_TURN_GATE;
  // A line stored as a bare string predates slots; it keeps its text and can no longer be cleared.
  const held = stored.held.map((h) => (typeof h === 'string' ? { slot: '', line: h } : h));
  const announced = isAnnounced(stored.announced) ? stored.announced : {};
  return { ...EMPTY_TURN_GATE, ...stored, held, announced };
};

/**
 * Runs one finding through the gate. `owned` is the follower's claim: `false`
 * when another session of this repository claimed the reading first.
 */
const arrive = async ($: EngineInterface, cwd: string, finding: FollowedFinding, listed: string[], owned: boolean) => {
  const decided = turnGate(await readGate($, cwd), finding, await $.clock.now(), listed, owned);
  await $.store.set(gateKey(cwd), decided.state);
  if (decided.isNew && raisesToast(finding.finding)) $.ui.toast(`${finding.finding} — ${finding.branch}`);
  if (decided.start) void $.prompt.submit({ text: decided.text });
};

/** What one module instance keeps: a reload builds a new one and the old loop is gone. */
interface Link {
  isRunning: boolean;
  isTimed: boolean;
}

/**
 * Runs the follower and relays its lines; resolves to the follower's exit code
 * once it has ended. The loop awaits each arrival before it reads the next
 * line, so two arrivals never interleave their read-modify-write of the gate.
 */
const follow = async ($: EngineInterface, cwd: string, listed: string[]): Promise<number | null> => {
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
          const current: FollowedFinding[] = message.current;
          await update($, held, () => ({ findings: current, heard: true, stale: false }));
          $.ui.status(undefined);
          // A finding published while no follower ran arrives in the welcome alone;
          // the gate tells it from one already announced.
          for (const [i, finding] of current.entries()) {
            await arrive($, cwd, finding, listed, message.claimed?.[i] ?? true);
          }
        } else if (message.type === 'finding') {
          await update($, held, (h) => ({ ...h, findings: [...absorbFinding(h.findings, message.finding)] }));
          await arrive($, cwd, message.finding, listed, message.claimed ?? true);
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
  return code;
};

const connect = async ($: EngineInterface, cwd: string, listed: string[], link: Link) => {
  if (link.isRunning) return;
  link.isRunning = true;
  let code: number | null = null;
  try {
    code = await follow($, cwd, listed);
  } catch {
    // A throw leaves `code` null: the status says the channel is not running.
  } finally {
    // Whatever ended the follower, the pane has stopped hearing the channel.
    await update($, held, (h) => ({ ...h, heard: false }));
    // The exit code tells a quiet channel from a dead follower; silence does not.
    $.ui.status(code === 0 ? undefined : NOT_RUNNING);
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
  const link: Link = { isRunning: false, isTimed: false };

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
