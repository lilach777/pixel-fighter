import type { Slot } from '../../../shared/src/engine/state';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type RoomInfo,
  type ServerMessage,
} from '../../../shared/src/protocol';

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'closed';

export interface NetView {
  status: ConnStatus;
  room: RoomInfo | null;
  you: Slot | null;
  error: string | null;
  rtt: number | null;
  opponentConnected: boolean;
  opponentGraceMs: number;
  match: { id: number; chars: [string, string]; you: Slot } | null;
  matchEnd: { id: number; winner: Slot | 'draw'; reason: string } | null;
}

/** Resolves the WebSocket URL: VITE_WS_URL in production builds, same-origin /ws otherwise. */
export function resolveWsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  // Development only: ?server=wss://host/ws points the client at another server.
  // Disabled in production so a crafted link cannot redirect players (and their
  // session tokens) to an untrusted server.
  if (import.meta.env.DEV) {
    const override = new URLSearchParams(location.search).get('server');
    if (override && /^wss?:\/\//.test(override)) return override;
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

const RESUME_PREFIX = 'pixel-fighters.resume:';

/**
 * Client side of the online protocol. Owns the socket, tracks lobby/room state,
 * reconnects automatically (with the server-issued resume token) after drops.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private view: NetView = {
    status: 'idle',
    room: null,
    you: null,
    error: null,
    rtt: null,
    opponentConnected: true,
    opponentGraceMs: 0,
    match: null,
    matchEnd: null,
  };
  private subs = new Set<() => void>();
  private snapshotSubs = new Set<(m: Extract<ServerMessage, { t: 'snapshot' }>) => void>();
  private name = 'Player';
  private intentionalClose = false;
  private reconnectAttempts = 0;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private welcomeWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  private seq = 0;
  readonly url: string;
  /** Resume tokens are stored per server URL, so a token is only ever sent back to the server that issued it. */
  private get resumeKey(): string {
    return RESUME_PREFIX + this.url;
  }

  constructor(url = resolveWsUrl()) {
    this.url = url;
  }

  // ------------------------------------------------------------- store
  getView = (): NetView => this.view;
  subscribe = (cb: () => void): (() => void) => {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  };
  onSnapshot(cb: (m: Extract<ServerMessage, { t: 'snapshot' }>) => void): () => void {
    this.snapshotSubs.add(cb);
    return () => this.snapshotSubs.delete(cb);
  }
  private patch(p: Partial<NetView>): void {
    this.view = { ...this.view, ...p };
    for (const s of this.subs) s();
  }

  // ------------------------------------------------------------- connection
  connect(name: string): Promise<void> {
    this.name = name || 'Player';
    this.intentionalClose = false;
    if (this.ws && this.view.status === 'connected') return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.welcomeWaiters.push({ resolve, reject });
      // A socket is already opening (e.g. React StrictMode re-ran the effect): just wait for it.
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
      this.open();
    });
  }

  private open(): void {
    this.patch({ status: this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting', error: null });
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.fail('Invalid server address.');
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      let resume: string | undefined;
      try {
        resume = sessionStorage.getItem(this.resumeKey) ?? undefined;
      } catch {
        resume = undefined;
      }
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, resume });
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      this.stopPing();
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.intentionalClose) {
        this.patch({ status: 'closed' });
        return;
      }
      if (!opened && this.reconnectAttempts === 0) {
        this.fail('Game server unavailable. Check your connection or try again later.');
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows and decides what to do.
    };
  }

  private fail(error: string): void {
    this.patch({ status: 'unavailable', error });
    const waiters = this.welcomeWaiters;
    this.welcomeWaiters = [];
    for (const w of waiters) w.reject(new Error(error));
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 6) {
      this.fail('Connection lost. The server could not be reached.');
      return;
    }
    this.reconnectAttempts++;
    this.patch({ status: 'reconnecting' });
    const delay = Math.min(4000, 400 * 2 ** (this.reconnectAttempts - 1));
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    try {
      sessionStorage.removeItem(this.resumeKey);
    } catch {
      // ignore
    }
    this.patch({ status: 'closed', room: null, you: null, match: null, matchEnd: null });
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
  }
  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome': {
        this.reconnectAttempts = 0;
        try {
          sessionStorage.setItem(this.resumeKey, msg.resume);
        } catch {
          // ignore
        }
        this.patch({ status: 'connected', error: null });
        this.startPing();
        const waiters = this.welcomeWaiters;
        this.welcomeWaiters = [];
        for (const w of waiters) w.resolve();
        break;
      }
      case 'error':
        this.patch({ error: msg.message });
        if (msg.code === 'version_mismatch') this.fail(msg.message);
        break;
      case 'room':
        this.patch({ room: msg.room, you: msg.you, error: null });
        break;
      case 'left':
        this.patch({ room: null, you: null, match: null, matchEnd: null });
        break;
      case 'matchStart':
        this.patch({ match: { id: msg.matchId, chars: msg.chars, you: msg.you }, matchEnd: null, opponentConnected: true });
        break;
      case 'snapshot':
        for (const s of this.snapshotSubs) s(msg);
        break;
      case 'matchEnd':
        this.patch({ matchEnd: { id: msg.matchId, winner: msg.winner, reason: msg.reason } });
        break;
      case 'opponentStatus':
        this.patch({ opponentConnected: msg.connected, opponentGraceMs: msg.graceMs });
        break;
      case 'pong':
        this.patch({ rtt: Math.round(performance.now() - msg.ts) });
        break;
    }
  }

  // ------------------------------------------------------------- actions
  createRoom(name?: string): void {
    if (name) this.name = name;
    this.patch({ error: null });
    this.send({ t: 'createRoom', name: this.name });
  }
  joinRoom(code: string, name?: string): void {
    if (name) this.name = name;
    this.patch({ error: null });
    this.send({ t: 'joinRoom', code, name: this.name });
  }
  selectCharacter(char: string): void {
    this.send({ t: 'selectCharacter', char });
  }
  setReady(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }
  sendInput(bits: number): void {
    this.send({ t: 'input', seq: ++this.seq, bits });
  }
  voteRematch(vote: boolean): void {
    this.send({ t: 'rematch', vote });
  }
  leaveRoom(): void {
    this.send({ t: 'leaveRoom' });
    this.patch({ room: null, you: null, match: null, matchEnd: null });
  }
  clearMatch(): void {
    this.patch({ match: null, matchEnd: null });
  }
}
