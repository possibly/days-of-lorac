/**
 * Transport shapes shared by the real socket and the peer transport.
 *
 * `SocketLike` is the slice of WebSocket that `GameClient` touches: a ready
 * state, send, close, and four handlers. A data channel or an in-memory
 * loopback can satisfy it, which is what lets the same client code play against
 * a remote server, the host tab, or itself.
 */
import type { ServerMessage } from '@shared/protocol';
import type { ClientConnection } from '../../../server/rooms.js';

export const SOCKET_CONNECTING = 0;
export const SOCKET_OPEN = 1;
export const SOCKET_CLOSED = 3;

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/** Wraps an RTCDataChannel so `GameClient` can treat it as a socket. */
export function rtcSocket(channel: RTCDataChannel): SocketLike {
  const socket: SocketLike = {
    readyState: channel.readyState === 'open' ? SOCKET_OPEN : SOCKET_CONNECTING,
    send: (data) => {
      if (channel.readyState === 'open') channel.send(data);
    },
    close: () => {
      try {
        channel.close();
      } catch {
        // already closed
      }
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  channel.onopen = () => {
    socket.readyState = SOCKET_OPEN;
    socket.onopen?.();
  };
  channel.onmessage = (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? event.data : '';
    if (data) socket.onmessage?.({ data });
  };
  channel.onclose = () => {
    socket.readyState = SOCKET_CLOSED;
    socket.onclose?.();
  };
  channel.onerror = () => {
    socket.onerror?.();
  };
  return socket;
}

export interface DeferredSocket extends SocketLike {
  /** Hand over the real channel once the host connects back. */
  attach(socket: SocketLike): void;
}

/**
 * A socket that exists before its transport does.
 *
 * The guest has to attach the game client before the host has even pasted the
 * reply, otherwise the first messages (the welcome, above all) arrive while
 * nobody is listening. Sends queue until the channel appears and the open event
 * fires at the right moment.
 */
export function createDeferredSocket(): DeferredSocket {
  const outbox: string[] = [];
  let real: SocketLike | null = null;
  let closed = false;
  let opened = false;

  const socket: DeferredSocket = {
    readyState: SOCKET_CONNECTING,
    send: (data) => {
      if (real) real.send(data);
      else outbox.push(data);
    },
    close: () => {
      closed = true;
      try {
        real?.close();
      } catch {
        // already closed
      }
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    attach: (next) => {
      real = next;
      next.onopen = () => markOpen();
      next.onmessage = (event) => socket.onmessage?.(event);
      next.onclose = () => {
        socket.readyState = SOCKET_CLOSED;
        socket.onclose?.();
      };
      next.onerror = () => socket.onerror?.();
      if (next.readyState === SOCKET_OPEN) markOpen();
      if (closed) next.close();
    },
  };

  function markOpen(): void {
    if (opened) return;
    opened = true;
    socket.readyState = SOCKET_OPEN;
    socket.onopen?.();
    if (!real) return;
    const queued = outbox.splice(0);
    for (const data of queued) real.send(data);
  }

  return socket;
}

export interface LoopbackPair {
  /** The client end, handed to `GameClient`. */
  socket: SocketLike;
  /** The server end, handed to the RoomManager. */
  conn: ClientConnection;
  /** Host sets this before `open()` to receive client messages. */
  onClientMessage: ((raw: string) => void) | null;
  open(): void;
  close(): void;
}

/**
 * An in-memory socket pair, used for the host's own seat. Messages cross on a
 * timer tick so the host behaves exactly like a remote client: no synchronous
 * reentrancy into the manager, and the welcome arrives after `onopen`.
 */
export function createLoopback(id = 'host'): LoopbackPair {
  let open = false;
  const clientQueue: string[] = [];
  const serverQueue: string[] = [];
  let pumping = false;

  const pair: LoopbackPair = {
    socket: {
      readyState: SOCKET_CONNECTING,
      send: (data) => {
        if (!open) return;
        serverQueue.push(data);
        pump();
      },
      close: () => pair.close(),
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    },
    conn: {
      id,
      send: (message: ServerMessage) => {
        if (!open) return;
        clientQueue.push(JSON.stringify(message));
        pump();
      },
      close: () => pair.close(),
    },
    onClientMessage: null,
    open: () => {
      if (open) return;
      open = true;
      pair.socket.readyState = SOCKET_OPEN;
      pair.socket.onopen?.();
      pump();
    },
    close: () => {
      if (!open) return;
      open = false;
      pair.socket.readyState = SOCKET_CLOSED;
      pair.socket.onclose?.();
    },
  };

  function pump(): void {
    if (pumping) return;
    pumping = true;
    setTimeout(() => {
      pumping = false;
      while (open && clientQueue.length > 0) {
        const data = clientQueue.shift();
        if (data !== undefined) pair.socket.onmessage?.({ data });
      }
      while (open && serverQueue.length > 0) {
        const data = serverQueue.shift();
        if (data !== undefined) pair.onClientMessage?.(data);
      }
    }, 0);
  }

  return pair;
}
