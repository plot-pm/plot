import { z } from 'zod';
import {
  FindingNameSchema,
  MEASURED_BY,
  findingKey,
  type Finding,
  type FindingName,
} from '../entities/finding.js';
import {
  PurposeSchema,
  isServed,
  serves,
  type Admission,
  type Subscription,
} from '../entities/subscription.js';

/**
 * Every condition a subscriber may wait for.
 *
 * Derived from the monitors' own vocabulary rather than restated, so a fourth
 * monitor adding a finding cannot leave this list behind. `clear` is excluded
 * for the reason `MEASURED_BY` omits it: waiting for a retraction is waiting
 * for nothing in particular.
 */
export const MEASURABLE: readonly FindingName[] = Object.keys(MEASURED_BY) as FindingName[];

/**
 * The conditions this channel is asked for but does not measure.
 *
 * `CI is green` is named rather than merely absent, because it is the request
 * the plan refuses ON PURPOSE and a refusal that says *unknown condition* would
 * read as an oversight. No monitor asks the host about a check run, and adding
 * one to satisfy a request is how the five-minute budget stops meaning
 * anything.
 */
const REFUSED_BY_DESIGN: Readonly<Record<string, string>> = {
  'ci is green':
    'no monitor asks the host about a check run; adding one to serve this would put a host question on a fast loop',
  'ci is red':
    'no monitor asks the host about a check run; adding one to serve this would put a host question on a fast loop',
};

/**
 * May this purpose be served, and if not, what could not be?
 *
 * REFUSED IMMEDIATELY, WHICH IS THE POINT. A subscriber left pending on a
 * condition nobody checks is the failure this channel exists to end, reproduced
 * inside the mechanism meant to end it. So an unmeasured purpose is answered on
 * the request rather than never.
 *
 * The refusal NAMES what it cannot serve and lists what it can, because a
 * subscriber that is told only *no* has to guess, and the vocabulary is not
 * something it can discover any other way.
 *
 * @param id the connection's id, assigned by whoever accepted it
 * @param raw the request as received — unparsed, so a malformed purpose is
 *   refused with a reason rather than thrown out with none
 * @returns the subscription to hold, or the refusal to send back
 */
export const admit = (id: string, raw: unknown): Admission => {
  // THE CONDITION IS JUDGED BEFORE THE SHAPE IS. An unmeasured condition is a
  // valid request this channel cannot serve, not a malformed one — and the
  // schema cannot tell them apart, because an unknown finding fails its enum
  // exactly as a typo does. Asking first is what lets `CI is green` be refused
  // with the reason the design gives it rather than a parser's generic no.
  const asked = describeAsked(raw);
  if (asked !== '') {
    const refusal = REFUSED_BY_DESIGN[asked.toLowerCase()];
    if (refusal) return { ok: false, reason: refusal, asked, measurable: MEASURABLE };
    // `clear` is a finding a monitor PUBLISHES but not one a subscriber may
    // wait for: the publishing vocabulary and the waitable one are different
    // sets, and `MEASURABLE` is the second.
    if (!MEASURABLE.includes(asked as FindingName)) {
      return {
        ok: false,
        reason: `this channel does not measure '${asked}'`,
        asked,
        measurable: MEASURABLE,
      };
    }
  }

  const parsed = SubscribeRequestShape.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'a subscription must carry a purpose: either everything, or until <condition> holds',
      asked,
      measurable: MEASURABLE,
    };
  }

  const { subscriber, purpose } = parsed.data;
  return { ok: true, subscription: { id, subscriber, purpose } };
};

/**
 * The request as `admit` reads it.
 *
 * Lenient about `subscriber` — it is a label for the log and nothing reads it —
 * so that the purpose is the only thing a subscription can be refused for.
 */
const SubscribeRequestShape = z.object({
  subscriber: z.string().default(''),
  purpose: PurposeSchema,
});

/**
 * What condition did a rejected request appear to ask for?
 *
 * Best effort on a shape that failed to parse: a subscriber that asked for
 * `until CI is green` deserves to be told that phrase back, and a refusal that
 * echoed nothing would be the same *no* for every mistake.
 */
const describeAsked = (raw: unknown): string => {
  if (typeof raw !== 'object' || raw === null) return '';
  const purpose = (raw as { purpose?: unknown }).purpose;
  if (typeof purpose !== 'object' || purpose === null) return '';
  const finding = (purpose as { finding?: unknown }).finding;
  return typeof finding === 'string' ? finding : '';
};

/**
 * What a subscriber is sent the moment it is admitted.
 *
 * The CURRENT findings, not a replay: a channel carries what is true now, so a
 * subscriber joining late is level with one that has been listening since the
 * monitor started. `everything` receives the whole board; an `until` purpose
 * receives only what serves it — and if that is already true, it is served
 * immediately and never has to wait for the condition to happen twice.
 */
export const onJoin = (
  subscription: Subscription,
  current: readonly Finding[],
): { send: readonly Finding[]; finished: boolean } => {
  const send = current.filter((f) => serves(subscription.purpose, f));
  const finished = send.some((f) => isServed(subscription.purpose, f));
  return { send, finished };
};

/**
 * Who receives this finding, and which of them are finished by it.
 *
 * EVERY SUBSCRIBER IS ASKED INDEPENDENTLY, which is the property that makes
 * this a channel rather than a return value: two subscribers each receive every
 * finding that serves them, and neither appears in the other's answer.
 */
export const route = (
  subscriptions: readonly Subscription[],
  finding: Finding,
): { send: readonly Subscription[]; finished: readonly Subscription[] } => {
  const send = subscriptions.filter((s) => serves(s.purpose, finding));
  const finished = send.filter((s) => isServed(s.purpose, finding));
  return { send, finished };
};

/**
 * The findings a channel currently holds, after this one arrives.
 *
 * CHANNEL, NOT QUEUE: a second reading from one monitor about one branch
 * REPLACES the first. The list is current state, and its length is bounded by
 * the number of monitor/branch pairs rather than by how long the fleet has been
 * running.
 */
export const absorb = (current: readonly Finding[], arriving: Finding): readonly Finding[] => {
  const key = findingKey(arriving);
  const rest = current.filter((f) => findingKey(f) !== key);
  return [...rest, arriving];
};

/**
 * What a subscriber can tell about a monitor that has said nothing.
 *
 * SILENCE-BECAUSE-HEALTHY VERSUS SILENCE-BECAUSE-GONE is the distinction the
 * whole design rests on, and a dropped connection does NOT draw it: the monitor
 * publishes, nothing watches its end of the socket, and a publisher that died
 * quietly looks exactly like one with nothing to say.
 *
 * So the heartbeat draws it instead. A monitor that is alive says so on a
 * cadence even when it has no finding; one that has gone stops, and `measuredAt`
 * is what makes that legible — the reason DESIGN-machine.md requires the field.
 *
 * @param lastSeen when this monitor last said anything, ISO-8601; `''` when it
 *   has never been heard from
 * @param now the current time, ISO-8601
 * @param toleranceMs how long silence may last before it means gone. Defaults
 *   to three missed beats, so one late sample does not read as a death.
 */
export const monitorLiveness = (
  lastSeen: string,
  now: string,
  toleranceMs: number,
): 'alive' | 'gone' | 'never-seen' => {
  if (lastSeen === '') return 'never-seen';
  const last = Date.parse(lastSeen);
  const at = Date.parse(now);
  if (Number.isNaN(last) || Number.isNaN(at)) return 'never-seen';
  return at - last > toleranceMs ? 'gone' : 'alive';
};

/**
 * How long silence may last before it means the monitor is gone.
 *
 * Three beats rather than one: a sample can be late — a loaded machine, a slow
 * host call — and a channel that called that a death would report a dead
 * monitor every time the machine was busy, which is precisely when the findings
 * matter most.
 */
export const missedBeatsTolerance = (intervalMs: number): number => intervalMs * 3;

/** Every finding name a purpose may name, for a refusal that teaches. */
export const measurableConditions = (): readonly FindingName[] => MEASURABLE;

/** Re-exported so a caller validating a condition need not reach for the entity. */
export { FindingNameSchema };
