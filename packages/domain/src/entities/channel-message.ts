import { z } from 'zod';
import { FindingNameSchema, FindingSchema, MonitorNameSchema } from './finding.js';

/**
 * What the channel sends a subscriber, one JSON object per line.
 *
 * NDJSON over a stream socket, for the reason the transport was chosen at all:
 * the wrapper is *"a fresh shell that cannot reach"* the dispatcher
 * (`plot-dispatch.sh:275`), and a line of JSON on a filesystem path is what such
 * a shell can both write and read. A framing that needed a library would put a
 * dependency on the one participant that has none.
 */

/** The channel accepted a purpose, and here is what it holds right now. */
export const WelcomeSchema = z.object({
  type: z.literal('welcome'),
  /** Every finding that serves this purpose, as of now — state, not replay. */
  current: z.array(FindingSchema),
  /** What this channel can be asked to wait for, so a subscriber need not guess. */
  measurable: z.array(FindingNameSchema),
});

/** The channel refused a purpose, and here is what it could not serve. */
export const PurposeRefusalSchema = z.object({
  type: z.literal('refused'),
  /** Why, in a sentence a subscriber can print. */
  reason: z.string(),
  /** The condition asked for, echoed back; `''` when none was nameable. */
  asked: z.string(),
  /** What this channel does measure. */
  measurable: z.array(FindingNameSchema),
});

/** A monitor found something, or retracted what it found before. */
export const FindingMessageSchema = z.object({
  type: z.literal('finding'),
  finding: FindingSchema,
});

/**
 * The channel is alive and has nothing to say.
 *
 * THIS IS THE MESSAGE THAT MAKES SILENCE READABLE. Without it a subscriber
 * cannot tell a healthy fleet from a dead monitor: both send nothing. An
 * earlier draft of the plan claimed a dropped subscription would show it — it
 * would not, because the monitors publish and nothing watches their end.
 */
export const HeartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  /** When this beat was sent, ISO-8601 — a reading without one cannot be judged stale. */
  measuredAt: z.string(),
  /** Which monitors have been heard from, and when each last spoke. */
  monitors: z.array(
    z.object({
      monitor: MonitorNameSchema,
      lastSeen: z.string(),
    }),
  ),
});

/**
 * The purpose has been served, and the subscription is over.
 *
 * Sent rather than merely closing the socket, because a close is what a crash
 * looks like too. A subscriber that asked to wait until a branch was merged
 * needs to know the difference between being served and being dropped.
 */
export const ServedSchema = z.object({
  type: z.literal('served'),
  /** The finding that served the purpose. */
  finding: FindingSchema,
});

export const ChannelMessageSchema = z.discriminatedUnion('type', [
  WelcomeSchema,
  PurposeRefusalSchema,
  FindingMessageSchema,
  HeartbeatSchema,
  ServedSchema,
]);
export type ChannelMessage = z.infer<typeof ChannelMessageSchema>;
export type Welcome = z.infer<typeof WelcomeSchema>;
export type PurposeRefusal = z.infer<typeof PurposeRefusalSchema>;
export type Heartbeat = z.infer<typeof HeartbeatSchema>;
export type Served = z.infer<typeof ServedSchema>;

/** Encode one message as the single NDJSON line the channel writes. */
export const encode = (message: ChannelMessage): string => `${JSON.stringify(message)}\n`;

/**
 * Decode one NDJSON line, or `undefined` when it is not a channel message.
 *
 * Tolerant by design: a blank line between messages, or a line from a writer
 * that is not this protocol, is skipped rather than thrown. A subscriber that
 * died on one malformed line would be a subscriber that any stray write could
 * kill.
 */
export const decode = (line: string): ChannelMessage | undefined => {
  const trimmed = line.trim();
  if (trimmed === '') return undefined;
  try {
    const parsed = ChannelMessageSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};
