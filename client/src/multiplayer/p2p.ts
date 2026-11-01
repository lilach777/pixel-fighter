import type { DataConnection, Peer, PeerOptions } from 'peerjs';
import { PROTOCOL_VERSION, type ClientMessage, type ErrorCode, type ServerMessage } from '../../../shared/src/protocol';
import { GameHub, type HubConnection } from '../../../shared/src/net/hub';
import type { Transport } from '../../../shared/src/net/player';
import { generateRoomCode } from '../../../shared/src/net/roomManager';

/**
 * Peer-to-peer online play over WebRTC (PeerJS), for static hosting (Vercel, Netlify,
 * GitHub Pages) where no game server can run.
 *
 * The room creator's browser is the host: it runs the same authoritative `GameHub` the
 * Node server runs and the guest connects to it over a WebRTC data channel. The PeerJS
 * signalling service is only used to introduce the two browsers; game traffic flows
 * directly between them (or through TURN when a direct path is impossible).
 *
 * `P2PSocket` looks like a WebSocket to `NetClient`, so the lobby, match and reconnect
 * code is shared by both online modes. Until the player joins someone else's room, the
 * client talks to its own in-browser hub (which answers hello/ping and hosts rooms).
 */

/** Peer ids are `<prefix><room code>`, so a code is all a guest needs to find the host. */
const PEER_PREFIX = 'pixel-fighters-v1-';
const JOIN_TIMEOUT_MS = 15000;

const env = import.meta.env;
const notFound = (code: string) => `Room "${code}" does not exist. Check the code and try again.`;

function peerOptions(): PeerOptions {
  const o: PeerOptions = { debug: 0 };
  // Optional self-hosted PeerJS signalling server; defaults to the public PeerJS cloud.
  if (env.VITE_PEER_HOST) {
    o.host = env.VITE_PEER_HOST as string;
    o.port = Number(env.VITE_PEER_PORT ?? 443);
    o.path = (env.VITE_PEER_PATH as string | undefined) ?? '/';
    o.secure = env.VITE_PEER_SECURE !== 'false';
    if (env.VITE_PEER_KEY) o.key = env.VITE_PEER_KEY as string;
  }
  // Optional TURN relay for networks that block direct connections.
  if (env.VITE_TURN_URL) {
    o.config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: String(env.VITE_TURN_URL).split(',').map((s) => s.trim()),
          username: env.VITE_TURN_USERNAME as string | undefined,
          credential: env.VITE_TURN_CREDENTIAL as string | undefined,
        },
      ],
    };
  }
  return o;
}

let peerModule: Promise<typeof import('peerjs')> | null = null;
/** PeerJS is loaded on demand, so single-player never downloads it. */
async function newPeer(id?: string): Promise<Peer> {
  peerModule ??= import('peerjs');
  const { Peer } = await peerModule;
  return id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
}

/** A hub transport backed by a WebRTC data channel (host side). */
function dataTransport(conn: DataConnection): Transport {
  return {
    send: (data) => void conn.send(data),
    close: () => conn.close(),
    isOpen: () => conn.open,
  };
}

interface RemoteLink {
  peer: Peer;
  conn: DataConnection | null;
  /** In the host's room (got a room update). */
  joined: boolean;
  /** Sent leaveRoom; waiting for the host to confirm before closing the link. */
  leaving: boolean;
}

export class P2PSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = P2PSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  /** This browser's hub: answers before a room exists, and hosts the room it creates. */
  private hub: GameHub;
  private local: HubConnection;
  private localOpen = true;
  /** Reserved room code while hosting. */
  private hostCode: string | null = null;
  private hostPeer: Peer | null = null;
  private guests = new Set<DataConnection>();
  /** Set while this player is in someone else's room. */
  private remote: RemoteLink | null = null;
  private busy = false;

  constructor() {
    this.hub = new GameHub({
      snapshotEvery: 2,
      reconnectGraceMs: 20000,
      countdownMs: 3000,
      inputStaleMs: 600,
      speed: 1,
      postMatchFrames: 300,
      match: {},
      now: () => Date.now(),
      log: () => {},
      maxRooms: 1,
      roomIdleMs: 15 * 60 * 1000,
      generateCode: () => this.hostCode ?? generateRoomCode(),
    });
    this.local = this.hub.connect({
      send: (data) => this.deliver(data, true),
      close: () => this.close(),
      isOpen: () => this.localOpen,
    });
    this.hub.start();
    queueMicrotask(() => {
      if (this.readyState !== P2PSocket.CONNECTING) return;
      this.readyState = P2PSocket.OPEN;
      this.onopen?.();
    });
  }

  send(text: string): void {
    if (this.readyState !== P2PSocket.OPEN) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      return;
    }
    const link = this.remote;
    if (link && !link.leaving) {
      // Guest: everything goes to the host. Leaving closes the link once the host confirms.
      link.conn?.send(text);
      if (msg.t === 'leaveRoom') {
        link.leaving = true;
        setTimeout(() => this.remote === link && this.dropRemote(), 1500);
      }
      return;
    }
    if (msg.t === 'createRoom') return void this.host(text);
    if (msg.t === 'joinRoom') return void this.join(msg.code, msg.name, text);
    this.local.message(text);
  }

  close(): void {
    if (this.readyState === P2PSocket.CLOSED) return;
    this.readyState = P2PSocket.CLOSED;
    this.dropRemote();
    this.stopHosting();
    this.localOpen = false;
    this.local.close();
    this.hub.stop();
    queueMicrotask(() => this.onclose?.());
  }

  // ------------------------------------------------------------- plumbing
  /** Messages reach NetClient asynchronously, like real socket events. */
  private deliver(data: string, fromLocal: boolean): void {
    if (fromLocal && this.remote && !this.remote.leaving) return; // the local hub is silent while we are a guest
    queueMicrotask(() => {
      if (this.readyState !== P2PSocket.OPEN) return;
      this.onmessage?.({ data });
      if (fromLocal && this.hostCode && (JSON.parse(data) as ServerMessage).t === 'left') this.stopHosting();
    });
  }

  private emit(msg: ServerMessage): void {
    this.deliver(JSON.stringify(msg), false);
  }

  private error(code: ErrorCode, message: string): void {
    this.emit({ t: 'error', code, message });
  }

  // ------------------------------------------------------------- hosting
  private async host(createMsg: string): Promise<void> {
    if (this.hostPeer) return this.local.message(createMsg); // already reserved: let the hub answer
    if (this.busy) return;
    this.busy = true;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateRoomCode();
        const result = await this.reserve(code);
        if (this.readyState !== P2PSocket.OPEN) {
          result.peer?.destroy();
          return;
        }
        if (result.peer) {
          this.hostPeer = result.peer;
          this.hostCode = code;
          this.local.message(createMsg);
          return;
        }
        if (result.reason !== 'unavailable-id') break;
      }
      this.error('server_full', 'Could not reach the online service. Check your connection and try again.');
    } finally {
      this.busy = false;
    }
  }

  /** Registers the peer id for a room code; guests then find this browser by the code. */
  private async reserve(code: string): Promise<{ peer: Peer | null; reason?: string }> {
    let peer: Peer;
    try {
      peer = await newPeer(PEER_PREFIX + code);
    } catch {
      return { peer: null, reason: 'load' };
    }
    return new Promise((resolve) => {
      let settled = false;
      peer.on('open', () => {
        if (settled) return;
        settled = true;
        resolve({ peer });
      });
      peer.on('error', (err) => {
        if (!settled) {
          settled = true;
          peer.destroy();
          resolve({ peer: null, reason: err.type });
        }
      });
      peer.on('connection', (conn) => this.acceptGuest(conn));
      // Lost signalling only stops new guests from finding the room; connected guests keep playing.
      peer.on('disconnected', () => {
        if (this.hostPeer === peer && !peer.destroyed) peer.reconnect();
      });
    });
  }

  private acceptGuest(conn: DataConnection): void {
    let hc: HubConnection | null = null;
    conn.on('open', () => {
      if (this.hostPeer === null) return conn.close();
      this.guests.add(conn);
      hc = this.hub.connect(dataTransport(conn));
    });
    conn.on('data', (data) => {
      if (!hc) return;
      if (typeof data === 'string') hc.message(data);
      else hc.message('', true);
    });
    conn.on('close', () => {
      this.guests.delete(conn);
      hc?.close();
      hc = null;
    });
    conn.on('error', () => conn.close());
  }

  private stopHosting(): void {
    for (const g of this.guests) g.close();
    this.guests.clear();
    this.hostPeer?.destroy();
    this.hostPeer = null;
    this.hostCode = null;
  }

  // ------------------------------------------------------------- joining
  private async join(code: string, name: string | undefined, joinMsg: string): Promise<void> {
    if (this.busy) return;
    if (this.hostCode && code === this.hostCode) return this.local.message(joinMsg);
    this.busy = true;
    let peer: Peer;
    try {
      peer = await newPeer();
    } catch {
      this.busy = false;
      return this.error('server_full', 'Could not load the online service. Refresh the page.');
    }
    if (this.readyState !== P2PSocket.OPEN) {
      this.busy = false;
      return peer.destroy();
    }
    // Leave any room hosted here first; a player is in one room at a time.
    this.local.message(JSON.stringify({ t: 'leaveRoom' } satisfies ClientMessage));
    const link: RemoteLink = { peer, conn: null, joined: false, leaving: false };
    this.remote = link;
    let opened = false;
    const fail = (code: ErrorCode, message: string) => {
      if (this.remote !== link) return;
      this.dropRemote();
      this.error(code, message);
    };
    const timer = setTimeout(
      () => fail('room_not_found', 'Could not connect to the host. Their network may block direct connections; try another network.'),
      JOIN_TIMEOUT_MS,
    );
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') fail('room_not_found', notFound(code));
      else if (!opened) fail('server_full', 'Could not reach the online service. Check your connection and try again.');
    });
    peer.on('open', () => {
      if (this.remote !== link) return;
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'raw' });
      link.conn = conn;
      conn.on('open', () => {
        opened = true;
        this.busy = false;
        clearTimeout(timer);
        conn.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: name ?? 'Player' } satisfies ClientMessage));
        conn.send(joinMsg);
      });
      conn.on('data', (data) => {
        if (this.remote !== link || typeof data !== 'string') return;
        let t: string;
        try {
          t = (JSON.parse(data) as ServerMessage).t;
        } catch {
          return;
        }
        if (link.leaving) {
          if (t === 'left') this.dropRemote();
          return;
        }
        this.deliver(data, false);
        if (t === 'room') link.joined = true;
        // A refused join (room full, rate limited) or being removed ends the link.
        else if ((t === 'error' && !link.joined) || t === 'left') this.dropRemote();
      });
      conn.on('close', () => {
        if (this.remote !== link) return;
        this.dropRemote();
        if (link.leaving) return;
        if (opened) {
          this.error('room_not_found', 'The host left the game.');
          this.emit({ t: 'left' });
        } else {
          this.error('room_not_found', notFound(code));
        }
      });
      conn.on('error', () => conn.close());
    });
    link.peer.on('disconnected', () => {
      // Signalling is no longer needed once the data channel is open.
      if (!opened) fail('server_full', 'Lost the connection to the online service.');
    });
  }

  private dropRemote(): void {
    const link = this.remote;
    if (!link) return;
    this.remote = null;
    this.busy = false;
    link.conn?.close();
    link.peer.destroy();
  }
}
