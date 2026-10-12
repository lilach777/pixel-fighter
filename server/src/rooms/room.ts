import { stepMatch, forfeitMatch, type GameEvent } from '../../../shared/src/engine/sim';
import { createMatch, type MatchConfig, type MatchState, type Slot } from '../../../shared/src/engine/state';
import { sanitizeInput } from '../../../shared/src/input';
import { toNetState, type RoomInfo, type RoomPhase } from '../../../shared/src/protocol';
import type { Player } from './player';

export interface RoomOptions {
  /** Send a snapshot every N simulation frames (2 = 30 Hz). */
  snapshotEvery: number;
  /** How long a disconnected player's slot is held during a match. */
  reconnectGraceMs: number;
  countdownMs: number;
  /** Inputs older than this are treated as neutral (backgrounded / stalled clients). */
  inputStaleMs: number;
  /** Simulation steps per tick (1 in production; tests may fast-forward). */
  speed: number;
  /** Frames the simulation keeps running after a match ends (victory animations). */
  postMatchFrames: number;
  match: Partial<MatchConfig>;
  now: () => number;
  log: (msg: string) => void;
}

/**
 * A two-player room. In 'playing' the server owns the match state: clients only send
 * inputs; the server steps the shared engine and broadcasts snapshots + events.
 */
export class Room {
  readonly players: [Player | null, Player | null] = [null, null];
  phase: RoomPhase = 'lobby';
  deadline: number | null = null;
  state: MatchState | null = null;
  matchId = 0;
  lastActivity: number;
  private pendingEvents: GameEvent[] = [];
  private postFrames = 0;
  private matchEndSent = false;

  constructor(
    readonly code: string,
    private opts: RoomOptions,
  ) {
    this.lastActivity = opts.now();
  }

  get playerCount(): number {
    return this.players.filter(Boolean).length;
  }

  isEmpty(): boolean {
    return this.playerCount === 0;
  }

  info(): RoomInfo {
    return {
      code: this.code,
      phase: this.phase,
      deadline: this.deadline,
      players: this.players
        .filter((p): p is Player => p !== null)
        .map((p) => ({ slot: p.slot, name: p.name, char: p.char, ready: p.ready, connected: p.connected, rematch: p.rematch })),
    };
  }

  broadcastRoom(): void {
    for (const p of this.players) if (p) p.send({ t: 'room', you: p.slot, room: this.info() });
  }

  private other(p: Player): Player | null {
    return this.players[1 - p.slot] ?? null;
  }

  /** Adds a player; returns false when the room is full. */
  add(p: Player): boolean {
    const free = this.players.findIndex((x) => x === null);
    if (free === -1) return false;
    p.slot = free as Slot;
    p.room = this;
    p.char = null;
    p.resetForLobby();
    this.players[free] = p;
    this.touch();
    if (this.phase === 'finished' || this.phase === 'countdown') this.toLobby();
    this.broadcastRoom();
    return true;
  }

  /** Removes a player (left voluntarily or reconnect grace expired). */
  remove(p: Player, reason: 'leave' | 'timeout'): void {
    if (this.players[p.slot] !== p) return;
    const opp = this.other(p);
    if ((this.phase === 'playing' || this.phase === 'paused') && this.state && opp) {
      this.finishMatch(forfeitMatch(this.state, opp.slot), 'forfeit');
    }
    this.players[p.slot] = null;
    p.room = null;
    p.resetForLobby();
    this.opts.log(`room ${this.code}: player ${p.name} removed (${reason})`);
    if (this.phase === 'countdown' || this.phase === 'lobby') this.toLobby();
    if (this.phase === 'finished' && opp) {
      opp.rematch = false;
    }
    p.send({ t: 'left' });
    this.broadcastRoom();
  }

  selectCharacter(p: Player, char: string): string | null {
    if (this.phase === 'finished') this.toLobby();
    if (this.phase !== 'lobby' && this.phase !== 'countdown') return 'Cannot change fighter during a match.';
    if (p.ready) return 'Cancel ready before changing fighter.';
    p.char = char;
    this.touch();
    this.broadcastRoom();
    return null;
  }

  setReady(p: Player, ready: boolean): string | null {
    if (this.phase === 'finished') {
      if (!ready) {
        this.toLobby();
        this.broadcastRoom();
        return null;
      }
      return 'Match already finished — vote rematch or change fighter.';
    }
    if (this.phase !== 'lobby' && this.phase !== 'countdown') return 'Match in progress.';
    if (ready && !p.char) return 'Choose a fighter first.';
    p.ready = ready;
    this.touch();
    if (this.phase === 'countdown' && !ready) {
      this.phase = 'lobby';
      this.deadline = null;
    }
    this.maybeStartCountdown();
    this.broadcastRoom();
    return null;
  }

  voteRematch(p: Player, vote: boolean): string | null {
    if (this.phase !== 'finished') return 'No finished match to rematch.';
    const opp = this.other(p);
    if (!opp || !opp.connected) return 'Your opponent is not here.';
    p.rematch = vote;
    this.touch();
    if (p.rematch && opp.rematch) {
      this.startMatch();
      return null;
    }
    this.broadcastRoom();
    return null;
  }

  setInput(p: Player, seq: number, bits: number): void {
    if (seq <= p.lastSeq) return; // stale or replayed
    p.lastSeq = seq;
    p.input = sanitizeInput(bits);
    p.lastInputAt = this.opts.now();
  }

  onDisconnect(p: Player): void {
    p.disconnectedAt = this.opts.now();
    p.input = 0;
    const opp = this.other(p);
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.deadline = this.opts.now() + this.opts.reconnectGraceMs;
      opp?.send({ t: 'opponentStatus', connected: false, graceMs: this.opts.reconnectGraceMs });
    } else if (this.phase === 'paused') {
      // Both gone: keep the earlier deadline.
    } else if (this.phase === 'countdown') {
      p.ready = false;
      this.phase = 'lobby';
      this.deadline = null;
    }
    this.broadcastRoom();
  }

  onReconnect(p: Player): void {
    p.disconnectedAt = null;
    p.lastInputAt = this.opts.now();
    const opp = this.other(p);
    opp?.send({ t: 'opponentStatus', connected: true, graceMs: 0 });
    if (this.phase === 'paused' && this.players.every((x) => !x || x.connected)) {
      this.phase = 'playing';
      this.deadline = null;
    }
    p.send({ t: 'room', you: p.slot, room: this.info() });
    if (this.state && (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'finished')) {
      p.send({ t: 'matchStart', matchId: this.matchId, chars: [this.state.fighters[0].char, this.state.fighters[1].char], you: p.slot });
      if (this.phase === 'finished' && this.state.matchWinner !== null) {
        p.send({ t: 'matchEnd', matchId: this.matchId, winner: this.state.matchWinner, reason: this.state.lastRound?.reason ?? 'ko' });
      }
      this.sendSnapshot();
    }
    this.broadcastRoom();
  }

  private toLobby(): void {
    this.phase = 'lobby';
    this.deadline = null;
    this.state = null;
    for (const p of this.players) p?.resetForLobby();
  }

  private maybeStartCountdown(): void {
    if (this.phase !== 'lobby') return;
    const [a, b] = this.players;
    if (a && b && a.ready && b.ready && a.char && b.char && a.connected && b.connected) {
      this.phase = 'countdown';
      this.deadline = this.opts.now() + this.opts.countdownMs;
    }
  }

  private startMatch(): void {
    const [a, b] = this.players;
    if (!a || !b || !a.char || !b.char) return;
    this.matchId++;
    this.state = createMatch(a.char, b.char, this.opts.match);
    this.phase = 'playing';
    this.deadline = null;
    this.pendingEvents = [];
    this.postFrames = 0;
    this.matchEndSent = false;
    for (const p of [a, b]) {
      p.rematch = false;
      p.input = 0;
      p.lastInputAt = this.opts.now();
      p.send({ t: 'matchStart', matchId: this.matchId, chars: [a.char, b.char], you: p.slot });
    }
    this.opts.log(`room ${this.code}: match ${this.matchId} started (${a.char} vs ${b.char})`);
    this.broadcastRoom();
    this.sendSnapshot();
  }

  private finishMatch(events: GameEvent[], reason: string): void {
    if (!this.state || this.matchEndSent) return;
    this.pendingEvents.push(...events);
    this.phase = 'finished';
    this.deadline = null;
    this.matchEndSent = true;
    const winner = this.state.matchWinner ?? 'draw';
    for (const p of this.players) {
      if (!p) continue;
      p.rematch = false;
      p.ready = false;
      p.send({ t: 'matchEnd', matchId: this.matchId, winner, reason });
    }
    this.opts.log(`room ${this.code}: match ${this.matchId} finished (winner ${winner}, ${reason})`);
    this.sendSnapshot();
    this.broadcastRoom();
  }

  private sendSnapshot(): void {
    if (!this.state) return;
    const net = toNetState(this.state);
    const events = this.pendingEvents;
    this.pendingEvents = [];
    for (const p of this.players) {
      if (p) p.send({ t: 'snapshot', matchId: this.matchId, frame: this.state.frame, ack: p.lastSeq, state: net, events });
    }
  }

  private touch(): void {
    this.lastActivity = this.opts.now();
  }

  /** Called at 60 Hz by the server loop. */
  tick(): void {
    const now = this.opts.now();
    if (this.phase === 'countdown' && this.deadline !== null && now >= this.deadline) {
      this.startMatch();
      return;
    }
    if (this.phase === 'paused' && this.deadline !== null && now >= this.deadline) {
      // Grace expired: whoever is still disconnected forfeits.
      const gone = this.players.filter((p): p is Player => !!p && !p.connected);
      const stay = this.players.find((p) => p && p.connected) ?? null;
      if (this.state && stay) this.finishMatch(forfeitMatch(this.state, stay.slot), 'forfeit');
      for (const p of gone) this.remove(p, 'timeout');
      if (!stay) this.toLobby();
      return;
    }
    if (!this.state) return;
    if (this.phase === 'playing') {
      for (let k = 0; k < this.opts.speed; k++) {
        const inputs = this.players.map((p) => (p && now - p.lastInputAt <= this.opts.inputStaleMs ? p.input : 0)) as [number, number];
        const events = stepMatch(this.state, inputs);
        this.pendingEvents.push(...events);
        if (this.state.phase === 'matchEnd') {
          this.finishMatch([], this.state.lastRound?.reason ?? 'ko');
          return;
        }
        if (this.state.frame % this.opts.snapshotEvery === 0) this.sendSnapshot();
      }
      this.touch();
    } else if (this.phase === 'finished' && this.postFrames < this.opts.postMatchFrames) {
      for (let k = 0; k < this.opts.speed; k++) {
        this.pendingEvents.push(...stepMatch(this.state, [0, 0]));
        this.postFrames++;
        if (this.state.frame % this.opts.snapshotEvery === 0) this.sendSnapshot();
      }
    }
  }

  /** Test/ops helper: current slot of a player id. */
  slotOf(id: string): Slot | -1 {
    const i = this.players.findIndex((p) => p?.id === id);
    return i === -1 ? -1 : (i as Slot);
  }
}
