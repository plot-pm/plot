import http from 'node:http';
import https from 'node:https';

import { budgetFile } from '../budget/budget-file.js';
import { slotsFile } from '../slots/slots-file.js';
import type { BudgetEntry } from '../../entities/budget.js';
import { decodeEntry } from '../../entities/budget.js';
import type { LimitReading } from '../../entities/limit.js';
import type { BudgetRecord } from '../../ports/budget.js';
import type { HostRefusal, LimitObservation } from '../../ports/host.js';
import type { Slots } from '../../ports/slots.js';
import { boundFromLimit, SLOT_POLL_MS, SLOT_WAIT_MAX_MS } from '../../rules/concurrency.js';

/** How long one request may take before it answers `failed`, in milliseconds. */
export const REQUEST_BOUND_MS = 30_000;

/** The proxy variables Node's agent reads, upper and lower case. */
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'] as const;

/** What a connector answered. */
export interface ConnectorReply {
  /** The HTTP status. */
  readonly status: number;
  /** The response headers, names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  /** The parsed JSON body, or the raw text where it is not JSON. */
  readonly body: unknown;
}

/** The outcome of one transport attempt: a reply, or why none came. */
export type Sent = { reply: ConnectorReply } | { error: string; timedOut: boolean };

/** What one request charges the ledger, read off the reply. */
export interface Spend {
  /** The bucket the request counts against. */
  readonly bucket: string;
  /** The window's limit, or null where the reply named none. */
  readonly limit: number | null;
  /** What remains of the window, or null where unknown. */
  readonly remaining: number | null;
  /** When the window resets, epoch milliseconds, or null where unknown. */
  readonly resetAt: number | null;
  /** How well the reading is known. */
  readonly basis: BudgetEntry['basis'];
}

/** One request, with everything the connector chooses already decided. */
export interface ConnectorCall {
  /** The full URL. `http:` is allowed, for a stub server. */
  readonly url: URL;
  /** The HTTP method. */
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** The request headers, credentials included; the module reads and logs none of them. */
  readonly headers: Readonly<Record<string, string>>;
  /** The JSON body, where the request carries one. */
  readonly body?: unknown;
  /** The connector word the ledger entry carries, such as `github`. */
  readonly connector: string;
  /** The account the ledger entry and the host slot are charged to. */
  readonly account: string;
  /** The key the host slot is taken under; defaults to `account`. */
  readonly slotKey?: string;
  /** Reads the bucket, window and basis off the reply, or off none where no reply came. */
  readonly spend: (reply: ConnectorReply | null) => Spend;
}

/** The seams the transport reads; every one has a production default. */
export interface ConnectorHttpsOptions {
  /** Reads the proxy variables and the ledger and slot locations; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** The shared ledger; defaults to `budgetFile({ rotate: true })`. */
  budget?: BudgetRecord;
  /** The shared host slots; defaults to `slotsFile()`. */
  slots?: Slots;
  /** The clock, epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** The per-request bound; defaults to {@link REQUEST_BOUND_MS}. */
  boundMs?: number;
  /** How often a caller at the slot bound asks again; defaults to `SLOT_POLL_MS`. */
  pollMs?: number;
  /** How long a caller waits for a slot before it proceeds; defaults to `SLOT_WAIT_MAX_MS`. */
  waitMaxMs?: number;
}

/** The one HTTPS request module every connector client builds on. */
export interface ConnectorHttps {
  /** The per-request bound in milliseconds. */
  readonly boundMs: number;
  /** Sends one request through the proxy agents under the bound. Never rejects; charges nothing. */
  send(call: ConnectorCall): Promise<Sent>;
  /** Appends one ledger entry for a request already sent. */
  charge(call: ConnectorCall, reply: ConnectorReply | null): Promise<void>;
  /** Takes a host slot, sends, charges one ledger entry and releases the slot. Never rejects. */
  exchange(call: ConnectorCall): Promise<Sent>;
}

/**
 * Reads an integer header.
 *
 * @param value - the header value, or undefined.
 * @returns the number, or null where the value is absent or not an integer.
 */
export const headerNumber = (value: string | undefined): number | null => {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return null;
  return Number(value.trim());
};

/**
 * Maps a `429` to the `throttled` refusal and reports it.
 *
 * A `Retry-After` header in whole seconds becomes `waitMs`; a `429` with none
 * carries no wait. Any other status answers null.
 *
 * @param reply - what the connector answered.
 * @param said - the connector's own message, kept verbatim.
 * @param observe - receives `throttled` where the status is `429`.
 * @returns the refusal, or null where the status is not `429`.
 */
export const throttledOf = (
  reply: ConnectorReply,
  said: string,
  observe?: (observed: LimitObservation) => void,
): HostRefusal | null => {
  if (reply.status !== 429) return null;
  observe?.('throttled');
  const retryAfter = headerNumber(reply.headers['retry-after']);
  return retryAfter === null ? { kind: 'throttled', said } : { kind: 'throttled', said, waitMs: retryAfter * 1000 };
};

/** The limit reading a ledger entry records. */
const readingOf = (entry: BudgetEntry): LimitReading => ({
  connector: entry.key.connector,
  bucket: entry.key.bucket,
  limit: entry.limit,
  remaining: entry.remaining,
  resetAt: entry.resetAt,
  basis: entry.basis,
});

/**
 * Builds the shared HTTPS transport.
 *
 * Each request goes through an agent built from `HTTPS_PROXY`, `HTTP_PROXY`
 * and `NO_PROXY`, ends after the bound with `timeout`, and `exchange` wraps it
 * in one host slot (where the ledger licenses a bound for the connector and
 * account) and one appended `BudgetEntry`. The connector word, account, bucket
 * and reading basis come from the caller on every call.
 *
 * @param options - the seams.
 * @returns the transport.
 */
export const connectorHttps = (options: ConnectorHttpsOptions = {}): ConnectorHttps => {
  const env = options.env ?? process.env;
  const budget = options.budget ?? budgetFile({ env, rotate: true });
  const slots = options.slots ?? slotsFile({ env });
  const now = options.now ?? Date.now;
  const boundMs = options.boundMs ?? REQUEST_BOUND_MS;
  const pollMs = options.pollMs ?? SLOT_POLL_MS;
  const waitMaxMs = options.waitMaxMs ?? SLOT_WAIT_MAX_MS;

  const proxyEnv: Record<string, string> = {};
  for (const name of PROXY_VARS) {
    const value = env[name];
    if (value !== undefined && value !== '') proxyEnv[name] = value;
  }
  const agents = {
    'https:': new https.Agent({ proxyEnv }),
    'http:': new http.Agent({ proxyEnv }),
  };
  const bounds = new Map<string, number | null>();

  const send = (call: ConnectorCall): Promise<Sent> =>
    new Promise((resolve) => {
      const payload = call.body === undefined ? undefined : JSON.stringify(call.body);
      const transport = call.url.protocol === 'http:' ? http : https;
      let settled = false;
      const finish = (sent: Sent): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(sent);
      };
      const req = transport.request(
        call.url,
        {
          method: call.method,
          agent: call.url.protocol === 'http:' ? agents['http:'] : agents['https:'],
          headers: {
            ...call.headers,
            ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('error', (error) => finish({ error: error.message, timedOut: false }));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let body: unknown = text;
            try {
              body = text === '' ? null : JSON.parse(text);
            } catch {
              body = text;
            }
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(res.headers)) {
              if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
            }
            finish({ reply: { status: res.statusCode ?? 0, headers, body } });
          });
        },
      );
      const timer = setTimeout(() => {
        finish({ error: 'timeout', timedOut: true });
        req.destroy();
      }, boundMs);
      req.on('error', (error) => finish({ error: error.message, timedOut: false }));
      if (payload !== undefined) req.write(payload);
      req.end();
    });

  const boundKey = (call: ConnectorCall): string => `${call.connector}\t${call.account}`;

  const charge = async (call: ConnectorCall, reply: ConnectorReply | null): Promise<void> => {
    const spent = call.spend(reply);
    const entry: BudgetEntry = {
      key: { connector: call.connector, account: call.account, bucket: spent.bucket },
      at: now(),
      spent: 1,
      limit: spent.limit,
      remaining: spent.remaining,
      resetAt: spent.resetAt,
      basis: spent.basis,
    };
    if (spent.basis !== 'unknown') bounds.set(boundKey(call), boundFromLimit(readingOf(entry)));
    await budget.append(entry);
  };

  const boundFor = async (call: ConnectorCall): Promise<number | null> => {
    const key = boundKey(call);
    if (bounds.has(key)) return bounds.get(key) ?? null;
    const lines = await budget.lines();
    let bound: number | null = null;
    if (lines.ok) {
      const latest = lines.value
        .map(decodeEntry)
        .filter((e): e is BudgetEntry => e !== null && e.key.connector === call.connector && e.key.account === call.account)
        .filter((e) => e.basis !== 'unknown')
        .sort((a, b) => b.at - a.at)[0];
      if (latest !== undefined) bound = boundFromLimit(readingOf(latest));
    }
    bounds.set(key, bound);
    return bound;
  };

  // ONE ACQUIRE AT A TIME IN THIS PROCESS. `slotsFile` names its scratch claim
  // by pid and millisecond, so two acquires from one process in one
  // millisecond would share it and both fail.
  let acquiring: Promise<unknown> = Promise.resolve();
  const acquireOne = (key: string, bound: number): ReturnType<Slots['acquire']> => {
    const next = acquiring.then(() => slots.acquire(key, bound));
    acquiring = next.catch(() => undefined);
    return next;
  };

  const takeSlot = async (call: ConnectorCall, key: string): Promise<number | null> => {
    const bound = await boundFor(call);
    if (bound === null) return null;
    const started = now();
    for (;;) {
      const asked = await acquireOne(key, bound);
      if (!asked.ok) return null;
      if (asked.value !== null) return asked.value;
      if (now() - started >= waitMaxMs) return null;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  };

  const exchange = async (call: ConnectorCall): Promise<Sent> => {
    const key = call.slotKey ?? call.account;
    const slot = await takeSlot(call, key);
    try {
      const sent = await send(call);
      await charge(call, 'reply' in sent ? sent.reply : null);
      return sent;
    } finally {
      if (slot !== null) await slots.release(key, slot);
    }
  };

  return { boundMs, send, charge, exchange };
};
