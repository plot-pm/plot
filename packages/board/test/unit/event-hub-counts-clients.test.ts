import { EventEmitter } from 'node:events';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startEventHub, type EventHub } from '../../src/server/channel-events.js';

/**
 * `onClients` reports the stream count on every attach and every detach, so the
 * board can run its pulse exactly while a stream is attached. The request and
 * response are fakes: the hub reads only their events and `write`/`writeHead`.
 */

interface FakeStream {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  close: () => void;
}

const fakeStream = (): FakeStream => {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writeHead: () => res,
    write: () => true,
    end: () => {
      res.writableEnded = true;
    },
  });
  return {
    req: req as unknown as http.IncomingMessage,
    res: res as unknown as http.ServerResponse,
    // A browser that goes away closes both sides; the hub hears each.
    close: () => {
      req.emit('close');
      res.emit('close');
    },
  };
};

let hub: EventHub | undefined;

afterEach(() => {
  hub?.close();
  hub = undefined;
});

const hubCounting = (): number[] => {
  const counts: number[] = [];
  hub = startEventHub({
    // No channel listens here; the hub retries quietly on unref'd timers.
    address: path.join(os.tmpdir(), `plot-no-channel-${process.pid}-${Date.now()}.sock`),
    onClients: (count) => counts.push(count),
  });
  return counts;
};

describe('startEventHub onClients', () => {
  it('reports 1, 2, 1, 0 for attach, attach, detach, detach', () => {
    const counts = hubCounting();
    const a = fakeStream();
    const b = fakeStream();
    hub!.attach(a.req, a.res);
    hub!.attach(b.req, b.res);
    a.close();
    b.close();
    expect(counts).toEqual([1, 2, 1, 0]);
    expect(hub!.clients()).toBe(0);
  });

  it('reports one detach when the request, the response and an error all fire', () => {
    const counts = hubCounting();
    const a = fakeStream();
    hub!.attach(a.req, a.res);
    a.close();
    (a.res as unknown as EventEmitter).emit('error', new Error('reset'));
    expect(counts).toEqual([1, 0]);
  });

  it('reports 0 once when the hub closes with streams attached', () => {
    const counts = hubCounting();
    const a = fakeStream();
    hub!.attach(a.req, a.res);
    hub!.close();
    hub = undefined;
    expect(counts).toEqual([1, 0]);
  });
});
