import { describe, expect, it } from 'vitest';
import { Mux, StreamResetError, type MuxStream } from '@process/services/remoteTunnel/mux';
import {
  FRAME,
  INITIAL_WINDOW,
  MAX_DATA_CHUNK,
  ProtocolError,
  decodeFrame,
  encodeFrame,
  filterRawHeaders,
  parseHead,
  parseHello,
  parseOpen,
  type OpenMeta,
} from '@process/services/remoteTunnel/protocol';

const meta: OpenMeta = { method: 'GET', url: '/x', headers: ['host', 'a.r.test'], ip: '203.0.113.1', upgrade: false };

/** Two muxes wired back to back, delivering frames asynchronously like a real socket would. */
function pair(onStream: (s: MuxStream, m: OpenMeta) => void, maxStreams?: number) {
  const wire: { toA: Buffer[]; toB: Buffer[] } = { toA: [], toB: [] };
  // eslint-disable-next-line prefer-const
  let a: Mux;
  // eslint-disable-next-line prefer-const
  let b: Mux;
  const pump = (): void => {
    queueMicrotask(() => {
      while (wire.toA.length || wire.toB.length) {
        const x = wire.toB.shift();
        if (x) b.receive(x);
        const y = wire.toA.shift();
        if (y) a.receive(y);
      }
    });
  };
  a = new Mux({
    send: (f) => {
      wire.toB.push(f);
      pump();
    },
  });
  b = new Mux({
    send: (f) => {
      wire.toA.push(f);
      pump();
    },
    onStream,
    maxStreams,
  });
  return { a, b, wire };
}

describe('frame codec', () => {
  it('round-trips type, stream id and payload', () => {
    const f = decodeFrame(encodeFrame(FRAME.DATA, 0xfffffffe, Buffer.from('hi')));
    expect(f.type).toBe(FRAME.DATA);
    expect(f.streamId).toBe(0xfffffffe);
    expect(f.payload.toString()).toBe('hi');
  });

  it.each([
    ['too short', Buffer.from([1, 0, 0])],
    ['unknown type', Buffer.from([99, 0, 0, 0, 1])],
    ['oversize', Buffer.alloc(300 * 1024, 5)],
  ])('refuses a %s frame', (_n, buf) => {
    expect(() => decodeFrame(buf)).toThrow(ProtocolError);
  });

  it('validates control payloads instead of trusting them', () => {
    const json = (v: unknown): Buffer => Buffer.from(JSON.stringify(v));
    expect(() => parseHello(json({ v: 1, subdomain: 5, secret: 'x' }))).toThrow(ProtocolError);
    expect(() => parseOpen(json({ ...meta, headers: ['odd'] }))).toThrow(ProtocolError);
    expect(() => parseOpen(json({ ...meta, headers: [1, 2] }))).toThrow(ProtocolError);
    expect(() => parseOpen(Buffer.from('not json'))).toThrow(ProtocolError);
    expect(() => parseHead(json({ status: 99, message: '', headers: [] }))).toThrow(ProtocolError);
    expect(parseOpen(json(meta))).toEqual(meta);
  });
});

describe('filterRawHeaders', () => {
  it('drops hop-by-hop headers and the named ones, keeps order and duplicates', () => {
    const out = filterRawHeaders(
      [
        'Host',
        'h',
        'Connection',
        'close',
        'Set-Cookie',
        'a=1',
        'Transfer-Encoding',
        'chunked',
        'X-Real-IP',
        '1.1.1.1',
        'Set-Cookie',
        'b=2',
      ],
      { drop: new Set(['x-real-ip']) }
    );
    expect(out).toEqual(['Host', 'h', 'Set-Cookie', 'a=1', 'Set-Cookie', 'b=2']);
  });

  it('keeps Connection/Upgrade only for an upgrade', () => {
    const raw = ['Connection', 'Upgrade', 'Upgrade', 'websocket'];
    expect(filterRawHeaders(raw)).toEqual([]);
    expect(filterRawHeaders(raw, { keepUpgrade: true })).toEqual(raw);
  });
});

describe('Mux', () => {
  it('moves bytes both ways and ends cleanly', async () => {
    const received: string[] = [];
    const { a } = pair((s) => {
      s.on('data', (c: Buffer) => received.push(c.toString()));
      s.on('end', () => s.end('pong'));
    });
    const s = a.open(meta);
    const reply = new Promise<string>((resolve) => s.once('data', (c: Buffer) => resolve(c.toString())));
    s.end('ping');
    expect(await reply).toBe('pong');
    expect(received.join('')).toBe('ping');
    await new Promise((r) => s.on('close', r));
    expect(a.activeStreams).toBe(0);
  });

  it('splits large writes into bounded frames', async () => {
    const sizes: number[] = [];
    const { a, wire } = pair(() => undefined);
    const orig = wire.toB.push.bind(wire.toB);
    wire.toB.push = (...f: Buffer[]) => {
      for (const x of f) if (x.readUInt8(0) === FRAME.DATA) sizes.push(x.length - 5);
      return orig(...f);
    };
    const s = a.open(meta);
    s.write(Buffer.alloc(100 * 1024));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_DATA_CHUNK);
    expect(sizes.reduce((x, y) => x + y, 0)).toBe(100 * 1024);
  });

  it('stops sending when the credit is used up and resumes when the reader drains', async () => {
    let remote!: MuxStream;
    const { a } = pair((s) => {
      remote = s;
      s.pause(); // a consumer that is not reading
    });
    const s = a.open(meta);
    const total = INITIAL_WINDOW * 4;
    let written = 0;
    const done = new Promise<void>((resolve) => {
      const chunk = Buffer.alloc(16 * 1024);
      const writeMore = (): void => {
        while (written < total) {
          written += chunk.length;
          if (!s.write(chunk)) {
            s.once('drain', writeMore);
            return;
          }
        }
        s.end();
        resolve();
      };
      writeMore();
    });
    await new Promise((r) => setTimeout(r, 50));
    // Nothing is draining the receiver, so the sender is held at about one window.
    expect(written).toBeLessThan(total);
    expect(remote.readableLength).toBeLessThanOrEqual(INITIAL_WINDOW);

    let got = 0;
    remote.on('data', (c: Buffer) => (got += c.length));
    remote.resume();
    await done;
    await new Promise((r) => remote.on('end', r));
    expect(got).toBe(total);
  });

  it('resets the stream when the peer sends more than it was allowed', async () => {
    let remote!: MuxStream;
    const { b, wire } = pair((s) => {
      remote = s;
      s.on('error', () => undefined);
    });
    // Hand-craft an OPEN, then more DATA than the window.
    b.receive(encodeFrame(FRAME.OPEN, 7, meta));
    for (let sent = 0; sent < INITIAL_WINDOW; sent += MAX_DATA_CHUNK) {
      b.receive(encodeFrame(FRAME.DATA, 7, Buffer.alloc(MAX_DATA_CHUNK)));
    }
    b.receive(encodeFrame(FRAME.DATA, 7, Buffer.alloc(1)));
    expect(remote.destroyed).toBe(true);
    expect(wire.toA.some((f) => f.readUInt8(0) === FRAME.RESET)).toBe(true);
  });

  it('rejects an OPEN on a side that does not accept streams, and duplicate ids', () => {
    const { a, b } = pair(() => undefined);
    expect(() => a.receive(encodeFrame(FRAME.OPEN, 1, meta))).toThrow(ProtocolError);
    b.receive(encodeFrame(FRAME.OPEN, 3, meta));
    expect(() => b.receive(encodeFrame(FRAME.OPEN, 3, meta))).toThrow(ProtocolError);
  });

  it('refuses streams beyond the limit with a RESET instead of failing the tunnel', () => {
    const { b, wire } = pair(() => undefined, 1);
    b.receive(encodeFrame(FRAME.OPEN, 1, meta));
    b.receive(encodeFrame(FRAME.OPEN, 2, meta));
    expect(b.activeStreams).toBe(1);
    const reset = wire.toA.find((f) => f.readUInt8(0) === FRAME.RESET);
    expect(reset?.readUInt32BE(1)).toBe(2);
  });

  it('ignores frames for streams it no longer knows', () => {
    const { b } = pair(() => undefined);
    expect(() => {
      b.receive(encodeFrame(FRAME.DATA, 99, Buffer.from('late')));
      b.receive(encodeFrame(FRAME.END, 99));
      b.receive(encodeFrame(FRAME.RESET, 99, 'x'));
      b.receive(encodeFrame(FRAME.WINDOW, 99, Buffer.from([0, 0, 0, 1])));
    }).not.toThrow();
  });

  it('a peer RESET destroys the stream with a remote StreamResetError', async () => {
    let remote!: MuxStream;
    const { a } = pair((s) => {
      remote = s;
      s.on('error', () => undefined);
    });
    const s = a.open(meta);
    await new Promise((r) => setTimeout(r, 5));
    const err = new Promise<Error>((resolve) => s.once('error', resolve));
    remote.destroy(new Error('boom'));
    const e = await err;
    expect(e).toBeInstanceOf(StreamResetError);
    expect((e as StreamResetError).remote).toBe(true);
  });

  it('close() fails every open stream and refuses new ones', () => {
    const { a } = pair(() => undefined);
    const s = a.open(meta);
    s.on('error', () => undefined);
    a.close();
    expect(s.destroyed).toBe(true);
    expect(() => a.open(meta)).toThrow(StreamResetError);
  });
});

describe('window auto-tuning', () => {
  /** Two muxes with a fixed one-way delay between them, like a long-distance link. */
  function slowPair(oneWayMs: number, onStream: (s: MuxStream, m: OpenMeta) => void) {
    let a!: Mux;
    let b!: Mux;
    a = new Mux({ send: (f) => void setTimeout(() => b.receive(f), oneWayMs) });
    b = new Mux({ send: (f) => void setTimeout(() => a.receive(f), oneWayMs), onStream });
    return { a, b };
  }

  it('is not capped at window / round-trip time on a high-latency link', async () => {
    const total = 12 * 1024 * 1024;
    let got = 0;
    const { a } = slowPair(30, (s) => {
      s.on('data', (c: Buffer) => (got += c.length));
      s.on('end', () => s.end());
    });
    const s = a.open(meta);
    s.resume();
    const started = Date.now();
    const chunk = Buffer.alloc(64 * 1024);
    await new Promise<void>((resolve) => {
      let sent = 0;
      const more = (): void => {
        while (sent < total) {
          sent += chunk.length;
          if (!s.write(chunk)) {
            s.once('drain', more);
            return;
          }
        }
        s.end();
        resolve();
      };
      more();
    });
    await new Promise((r) => s.on('close', r));
    const elapsed = Date.now() - started;
    expect(got).toBe(total);
    // A fixed INITIAL_WINDOW over a 60 ms round trip moves ~4.2 MB/s, i.e. ~3 s for 12 MiB.
    expect(elapsed).toBeLessThan(2000);
  }, 20_000);
});
