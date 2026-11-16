/**
 * Copyright 2026 One Work
 *
 * Stream multiplexer over a single message transport (see protocol.ts).
 *
 * `Mux` turns frames into `MuxStream`s — Node `Duplex` streams with credit-based flow
 * control — so request/response bodies and upgraded sockets are plain `pipe()`s on both
 * ends, and backpressure from a slow visitor reaches the sender through the credit window.
 */

import { Duplex } from 'node:stream';
import {
  FRAME,
  INITIAL_WINDOW,
  MAX_DATA_CHUNK,
  MAX_WINDOW,
  ProtocolError,
  decodeFrame,
  encodeFrame,
  parseHead,
  parseOpen,
  type Frame,
  type HeadMeta,
  type OpenMeta,
} from './protocol';

export class StreamResetError extends Error {
  constructor(
    message: string,
    /** True when the peer reset the stream (as opposed to a local failure or a closed transport). */
    readonly remote = false
  ) {
    super(message);
    this.name = 'StreamResetError';
  }
}

export type MuxOptions = {
  /** Transport write. Called synchronously for every outgoing frame. */
  send: (frame: Buffer) => void;
  /**
   * Called for each stream the peer opens. Omit on the side that never accepts streams;
   * an OPEN then is a protocol violation.
   */
  onStream?: (stream: MuxStream, meta: OpenMeta) => void;
  /** Most simultaneously open streams to accept from the peer. */
  maxStreams?: number;
};

export class MuxStream extends Duplex {
  /** Credit we may still spend sending DATA. */
  private sendCredit = INITIAL_WINDOW;
  /** Credit we granted the peer that it has not used yet. */
  private grantedOutstanding = INITIAL_WINDOW;
  /** How much unread data we are willing to hold; grows while the sender is starved by a fast consumer. */
  private window = INITIAL_WINDOW;
  private promptBytes = 0;
  private resumeWrite: (() => void) | null = null;
  private localEnded = false;
  private remoteEnded = false;
  private resetByPeer = false;
  private done = false;

  constructor(
    readonly id: number,
    private readonly mux: Mux
  ) {
    super({ allowHalfOpen: true, readableHighWaterMark: MAX_WINDOW, writableHighWaterMark: 64 * 1024 });
  }

  /** Send the response head. Valid once, before any DATA. */
  sendHead(meta: HeadMeta): void {
    if (this.done) return;
    this.mux.sendFrame(encodeFrame(FRAME.HEAD, this.id, meta));
  }

  // ----- Writable: bytes out, bounded by the credit the peer granted -----

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    let offset = 0;
    const pump = (): void => {
      if (this.done) {
        callback(new StreamResetError('stream closed'));
        return;
      }
      while (offset < chunk.length) {
        if (this.sendCredit <= 0) {
          this.resumeWrite = pump;
          return;
        }
        const n = Math.min(this.sendCredit, MAX_DATA_CHUNK, chunk.length - offset);
        this.mux.sendFrame(encodeFrame(FRAME.DATA, this.id, chunk.subarray(offset, offset + n)));
        this.sendCredit -= n;
        offset += n;
      }
      callback();
    };
    pump();
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (!this.done) {
      this.localEnded = true;
      this.mux.sendFrame(encodeFrame(FRAME.END, this.id));
    }
    callback();
  }

  // ----- Readable: bytes in, credit returned only as the consumer drains -----

  override _read(): void {
    this.grantCredit();
  }

  // `_read` is only called while no earlier call is still waiting for a push, so on its own it
  // misses the moment a paused consumer drains a full buffer. Every consumption goes through
  // `read()` (flowing mode and pipe() included), which is where credit must be returned.
  override read(size?: number): unknown {
    const chunk = super.read(size);
    this.grantCredit();
    return chunk;
  }

  private grantCredit(): void {
    if (this.done || this.remoteEnded) return;
    const want = this.window - this.readableLength - this.grantedOutstanding;
    // Batch small grants: a WINDOW frame per tiny read would double the frame count.
    if (want >= this.window / 4) {
      this.grantedOutstanding += want;
      this.mux.sendFrame(encodeFrame(FRAME.WINDOW, this.id, u32(want)));
    }
  }

  // ----- Entry points for incoming frames (called by Mux) -----

  /** @internal */
  receiveData(data: Buffer): void {
    if (this.remoteEnded || data.length > this.grantedOutstanding) {
      // The peer sent more than we allowed: do not buffer it, drop the stream.
      this.destroy(new StreamResetError('flow-control violation'));
      return;
    }
    this.grantedOutstanding -= data.length;
    this.push(data);
    // Grow on proven demand, like TCP slow start: every full window of data that our consumer
    // took without letting a backlog build doubles the window. Over a long link the sender is
    // otherwise capped at window / round-trip time (the receiver cannot see that idle gap, only
    // that data keeps arriving and being consumed). A slow consumer builds a backlog, never
    // accumulates here, and so never earns a bigger window.
    if (this.readableLength <= this.window / 4) {
      this.promptBytes += data.length;
      if (this.promptBytes >= this.window && this.window < MAX_WINDOW) {
        this.window = Math.min(this.window * 2, MAX_WINDOW);
        this.promptBytes = 0;
      }
    }
    this.grantCredit();
  }

  /** @internal */
  receiveEnd(): void {
    if (this.remoteEnded) return;
    this.remoteEnded = true;
    this.push(null);
  }

  /** @internal */
  receiveWindow(n: number): void {
    this.sendCredit += n;
    const resume = this.resumeWrite;
    this.resumeWrite = null;
    resume?.();
  }

  /** @internal */
  receiveReset(reason: string): void {
    this.resetByPeer = true;
    this.destroy(new StreamResetError(reason || 'reset by peer', true));
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (!this.done) {
      this.done = true;
      if (!this.resetByPeer && !(this.localEnded && this.remoteEnded)) {
        this.mux.sendFrame(encodeFrame(FRAME.RESET, this.id, error?.message?.slice(0, 200) ?? 'closed'));
      }
      this.mux.forget(this.id);
    }
    // A write waiting for credit must not hang forever.
    const resume = this.resumeWrite;
    this.resumeWrite = null;
    resume?.();
    callback(error);
  }
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};

export class Mux {
  private readonly streams = new Map<number, MuxStream>();
  private nextId = 1;
  private dead = false;

  constructor(private readonly opts: MuxOptions) {}

  get activeStreams(): number {
    return this.streams.size;
  }

  /** @internal Used by streams; swallows sends after the transport is gone. */
  sendFrame(frame: Buffer): void {
    if (this.dead) return;
    this.opts.send(frame);
  }

  /** @internal */
  forget(id: number): void {
    this.streams.delete(id);
  }

  /** Open a stream towards the peer. */
  open(meta: OpenMeta): MuxStream {
    if (this.dead) throw new StreamResetError('tunnel closed');
    const id = this.nextId++;
    const stream = new MuxStream(id, this);
    this.streams.set(id, stream);
    this.sendFrame(encodeFrame(FRAME.OPEN, id, meta));
    return stream;
  }

  /** Feed one received transport message. Throws {@link ProtocolError} on garbage. */
  receive(raw: Buffer): void {
    this.dispatch(decodeFrame(raw));
  }

  private dispatch(frame: Frame): void {
    const { type, streamId, payload } = frame;
    switch (type) {
      case FRAME.OPEN: {
        if (!this.opts.onStream) throw new ProtocolError('unexpected OPEN');
        const meta = parseOpen(payload);
        if (this.streams.has(streamId)) throw new ProtocolError('duplicate stream id');
        if (this.streams.size >= (this.opts.maxStreams ?? Infinity)) {
          this.sendFrame(encodeFrame(FRAME.RESET, streamId, 'too many streams'));
          return;
        }
        const stream = new MuxStream(streamId, this);
        this.streams.set(streamId, stream);
        this.opts.onStream(stream, meta);
        return;
      }
      case FRAME.HEAD:
        // Unknown ids are normal: the stream may have been reset while this was in flight.
        this.streams.get(streamId)?.emit('head', parseHead(payload));
        return;
      case FRAME.DATA:
        this.streams.get(streamId)?.receiveData(payload);
        return;
      case FRAME.END:
        this.streams.get(streamId)?.receiveEnd();
        return;
      case FRAME.WINDOW:
        if (payload.length !== 4) throw new ProtocolError('bad WINDOW');
        this.streams.get(streamId)?.receiveWindow(payload.readUInt32BE(0));
        return;
      case FRAME.RESET:
        this.streams.get(streamId)?.receiveReset(payload.toString('utf8'));
        return;
      default:
        throw new ProtocolError(`unexpected frame ${type}`);
    }
  }

  /** The transport is gone: fail every stream and refuse new ones. */
  close(reason = 'tunnel closed'): void {
    if (this.dead) return;
    this.dead = true;
    // Destroying a stream removes it from the map; deleting during Map iteration is well defined.
    for (const stream of this.streams.values()) stream.destroy(new StreamResetError(reason));
    this.streams.clear();
  }
}
