import WebSocket from 'ws';
import type { NetState, ServerMessage } from '../../shared/src/protocol';
import { PROTOCOL_VERSION } from '../../shared/src/protocol';

type Pred = (m: ServerMessage) => boolean;

/** Minimal real WebSocket client for integration tests. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  private waiters: { pred: Pred; resolve: (m: ServerMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  closed = false;
  closeCode: number | null = null;
  latestState: NetState | null = null;
  latestFrame = -1;
  resume = '';
  private seq = 0;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(m);
      if (m.t === 'snapshot' && m.frame > this.latestFrame) {
        this.latestFrame = m.frame;
        this.latestState = m.state;
      }
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          clearTimeout(w.timer);
          this.waiters = this.waiters.filter((x) => x !== w);
          w.resolve(m);
        }
      }
    });
    ws.on('close', (code) => {
      this.closed = true;
      this.closeCode = code;
    });
  }

  static open(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const c = new TestClient(ws);
      ws.once('open', () => resolve(c));
      ws.once('error', reject);
    });
  }

  static async connect(port: number, name: string, resume?: string): Promise<TestClient> {
    const c = await TestClient.open(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, name, resume });
    const w = (await c.wait((m) => m.t === 'welcome')) as Extract<ServerMessage, { t: 'welcome' }>;
    c.resume = w.resume;
    return c;
  }

  send(obj: unknown): void {
    this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  input(bits: number): void {
    this.send({ t: 'input', seq: ++this.seq, bits });
  }

  /** Resolves with the first future message matching `pred`. */
  wait<T extends ServerMessage = ServerMessage>(pred: Pred, timeoutMs = 8000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x.timer !== timer);
        reject(new Error(`timeout waiting for message; last: ${JSON.stringify(this.messages.slice(-3)).slice(0, 400)}`));
      }, timeoutMs);
      this.waiters.push({ pred, resolve: resolve as (m: ServerMessage) => void, reject, timer });
    });
  }

  /** Resolves when the room state matches: immediately if the LATEST room message already does. */
  untilRoom(pred: (m: Extract<ServerMessage, { t: 'room' }>) => boolean, timeoutMs = 8000): Promise<Extract<ServerMessage, { t: 'room' }>> {
    const latest = this.lastRoom();
    if (latest && pred(latest)) return Promise.resolve(latest);
    return this.wait((m) => m.t === 'room' && pred(m), timeoutMs);
  }

  lastRoom(): Extract<ServerMessage, { t: 'room' }> | undefined {
    return [...this.messages].reverse().find((m) => m.t === 'room') as Extract<ServerMessage, { t: 'room' }> | undefined;
  }

  close(): Promise<void> {
    return new Promise((r) => {
      if (this.closed) return r();
      this.ws.once('close', () => r());
      this.ws.close();
    });
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
