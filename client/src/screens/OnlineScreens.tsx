import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ROSTER, getCharacter } from '../../../shared/src/characters/roster';
import { isValidRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from '../../../shared/src/protocol';
import { HudView } from '../components/Hud';
import { Menu } from '../components/Menu';
import { audio } from '../game/audio/audio';
import { portraitUrl } from '../game/animation/sprites';
import type { NetClient, NetView } from '../multiplayer/netClient';
import { OnlineRunner } from '../multiplayer/onlineRunner';
import { getSettings, updateSettings } from '../settings';
import { TEST_HOOKS } from '../testHooks';

function useNet(net: NetClient): NetView {
  return useSyncExternalStore(net.subscribe, net.getView);
}

function statusLabel(v: NetView): string {
  switch (v.status) {
    case 'connecting':
      return 'CONNECTING...';
    case 'connected':
      return `ONLINE${v.rtt !== null ? ` · ${v.rtt}MS` : ''}`;
    case 'reconnecting':
      return 'RECONNECTING...';
    case 'unavailable':
      return 'SERVER UNAVAILABLE';
    case 'closed':
      return 'DISCONNECTED';
    default:
      return 'OFFLINE';
  }
}

/** Entry point for online play: routes between lobby, waiting room and match. */
export function OnlineFlow({ net, stage, onExit }: { net: NetClient; stage: string; onExit: () => void }) {
  const v = useNet(net);
  const inMatch = v.room && v.match && (v.room.phase === 'playing' || v.room.phase === 'paused' || v.room.phase === 'finished');
  if (inMatch) return <OnlineMatchScreen key={v.match!.id} net={net} stage={stage} />;
  if (v.room) return <RoomScreen net={net} />;
  return <OnlineLobby net={net} onExit={onExit} />;
}

function OnlineLobby({ net, onExit }: { net: NetClient; onExit: () => void }) {
  const v = useNet(net);
  const [name, setName] = useState(() => getSettings().playerName || `Player${Math.floor(Math.random() * 900 + 100)}`);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'menu' | 'join'>('menu');
  const connected = v.status === 'connected';

  useEffect(() => {
    if (v.status === 'idle' || v.status === 'closed') void net.connect(name).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveName = () => updateSettings({ playerName: name });
  const create = async () => {
    saveName();
    await net.connect(name).catch(() => undefined);
    net.createRoom(name);
  };
  const join = async () => {
    const c = normalizeRoomCode(code);
    saveName();
    await net.connect(name).catch(() => undefined);
    net.joinRoom(c, name);
  };
  const back = () => {
    net.disconnect();
    onExit();
  };

  return (
    <div className="screen-inner grid-bg" data-testid="online-lobby">
      <h2 className="heading" style={{ marginTop: '4cqh' }}>
        ONLINE VERSUS
      </h2>
      <div className="ok-note" data-testid="conn-status" data-status={v.status}>
        {statusLabel(v)}
      </div>
      <div className="row">
        <span className="sub">YOUR NAME</span>
        <input
          className="text-input"
          value={name}
          maxLength={16}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          data-testid="name-input"
          aria-label="Your name"
        />
      </div>
      {v.error && (
        <div className="alert" data-testid="online-error">
          {v.error}
        </div>
      )}
      {v.status === 'unavailable' && (
        <button className="btn" data-testid="retry-connect" onClick={() => void net.connect(name).catch(() => undefined)}>
          RETRY CONNECTION
        </button>
      )}
      {mode === 'menu' ? (
        <Menu
          onBack={back}
          items={[
            { label: 'CREATE ROOM', desc: 'Get a code to share with a friend', testId: 'create-room', disabled: !connected, onSelect: () => void create() },
            { label: 'JOIN ROOM', desc: 'Enter a friend’s room code', testId: 'join-room', disabled: !connected, onSelect: () => setMode('join') },
            { label: 'BACK', testId: 'online-back', onSelect: back },
          ]}
        />
      ) : (
        <form
          className="panel"
          style={{ display: 'flex', flexDirection: 'column', gap: '2cqh', alignItems: 'center' }}
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <span className="sub">ENTER ROOM CODE</span>
          <input
            className="text-input"
            autoFocus
            value={code}
            maxLength={ROOM_CODE_LENGTH + 2}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDE"
            data-testid="code-input"
            aria-label="Room code"
          />
          {code.length > 0 && !isValidRoomCode(normalizeRoomCode(code)) && <span className="hint">Codes are {ROOM_CODE_LENGTH} letters/numbers</span>}
          <div className="row">
            <button type="submit" className="btn primary" data-testid="join-submit" disabled={!connected || normalizeRoomCode(code).length === 0}>
              JOIN
            </button>
            <button type="button" className="btn" onClick={() => setMode('menu')}>
              CANCEL
            </button>
          </div>
        </form>
      )}
      <div className="hint" style={{ marginTop: 'auto' }}>
        Server: {net.url}
      </div>
    </div>
  );
}

function RoomScreen({ net }: { net: NetClient }) {
  const v = useNet(net);
  const room = v.room!;
  const me = room.players.find((p) => p.slot === v.you);
  const opp = room.players.find((p) => p.slot !== v.you);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);
  const countdown = room.phase === 'countdown' && room.deadline ? Math.max(0, Math.ceil((room.deadline - now) / 1000)) : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const pick = (id: string) => {
    if (me?.ready) return;
    audio.sfx('select');
    net.selectCharacter(id);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') net.leaveRoom();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [net]);

  const slotView = (p: typeof me, label: string) => (
    <div className="panel player-slot" data-testid={`slot-${label}`}>
      {p?.char ? <img src={portraitUrl(p.char)} alt="" /> : <div style={{ width: '6cqw' }} />}
      <div className="pinfo">
        <span style={{ color: label === 'you' ? 'var(--p1)' : 'var(--p2)' }}>{label === 'you' ? 'YOU' : 'OPPONENT'}</span>
        {p ? (
          <>
            <span>{p.name}</span>
            <span>{p.char ? getCharacter(p.char).name.toUpperCase() : 'CHOOSING...'}</span>
            <span className={!p.connected ? 'tag-off' : p.ready ? 'tag-ready' : 'tag-wait'} data-testid={`${label}-ready`}>
              {!p.connected ? 'DISCONNECTED' : p.ready ? 'READY' : 'NOT READY'}
            </span>
          </>
        ) : (
          <span className="tag-wait blink" data-testid="waiting-opponent">
            WAITING FOR OPPONENT...
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="screen-inner" data-testid="room-screen" data-phase={room.phase}>
      <div className="row" style={{ width: '100%', justifyContent: 'space-between' }}>
        <span className="ok-note">{statusLabel(v)}</span>
        <h2 className="heading" style={{ fontSize: '2cqw' }}>
          ROOM
        </h2>
        <span className="ok-note">{room.phase.toUpperCase()}</span>
      </div>
      <div className="row">
        <div className="code-display" data-testid="room-code">
          {room.code}
        </div>
        <button className="btn" onClick={() => void copy()} data-testid="copy-code">
          {copied ? 'COPIED!' : 'COPY CODE'}
        </button>
      </div>
      <div className="hint">Share this code with your opponent. They choose ONLINE VERSUS → JOIN ROOM.</div>
      {v.error && <div className="alert">{v.error}</div>}
      <div className="players">
        {slotView(me, 'you')}
        {slotView(opp, 'opponent')}
      </div>
      <div className="select-grid" style={{ '--cols': ROSTER.length, '--cell': '8.2cqw' } as React.CSSProperties}>
        {ROSTER.map((c) => (
          <button
            key={c.id}
            className={`portrait-card ${me?.char === c.id ? 'p1' : ''} ${opp?.char === c.id ? 'p2' : ''}`}
            style={{ height: '11cqh' }}
            onClick={() => pick(c.id)}
            disabled={me?.ready}
            data-testid={`online-char-${c.id}`}
            aria-label={c.name}
          >
            <img src={portraitUrl(c.id)} alt="" />
            <span className="pname">{c.name.toUpperCase()}</span>
          </button>
        ))}
      </div>
      {countdown !== null ? (
        <div className="heading" data-testid="countdown">
          MATCH STARTS IN {countdown}
        </div>
      ) : (
        <div className="row">
          <button
            className={`btn ${me?.ready ? '' : 'primary'}`}
            disabled={!me?.char}
            onClick={() => {
              audio.sfx('confirm');
              net.setReady(!me?.ready);
            }}
            data-testid="ready-toggle"
          >
            {me?.ready ? 'CANCEL READY' : 'READY'}
          </button>
          <button className="btn" onClick={() => net.leaveRoom()} data-testid="leave-room">
            LEAVE ROOM
          </button>
        </div>
      )}
      <div className="hint">{!opp ? 'Both players must join and press READY.' : !opp.ready || !me?.ready ? 'Both players must press READY to start.' : ''}</div>
    </div>
  );
}

function OnlineMatchScreen({ net, stage }: { net: NetClient; stage: string }) {
  const v = useNet(net);
  const match = v.match!;
  const room = v.room!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [runner] = useState(() => {
    const names = [0, 1].map((slot) => room.players.find((p) => p.slot === slot)?.name ?? `P${slot + 1}`) as [string, string];
    return new OnlineRunner(net, match.id, match.chars, stage, names);
  });
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    runner.attach(canvasRef.current!);
    audio.startMusic();
    if (TEST_HOOKS) window.__PF = { runner, getState: () => runner.current, mode: 'online' };
    return () => {
      runner.detach();
      if (TEST_HOOKS && window.__PF?.runner === runner) delete window.__PF;
    };
  }, [runner]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') setMenu((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const me = room.players.find((p) => p.slot === v.you);
  const opp = room.players.find((p) => p.slot !== v.you);
  const ended = room.phase === 'finished' && v.matchEnd?.id === match.id;
  // Leaving returns to the online lobby (connection stays open).
  const leave = () => net.leaveRoom();
  let title = '';
  if (ended && v.matchEnd) {
    title = v.matchEnd.winner === 'draw' ? 'DRAW GAME' : v.matchEnd.winner === v.you ? 'YOU WIN!' : 'YOU LOSE';
  }
  const graceLeft = room.phase === 'paused' && room.deadline ? Math.max(0, Math.ceil((room.deadline - now) / 1000)) : null;
  const badge = `YOU: P${(v.you ?? 0) + 1} · ${statusLabel(v)}`;

  return (
    <div className="match" data-testid="online-match" data-you={v.you ?? -1}>
      <canvas ref={canvasRef} data-testid="arena" />
      <HudView store={runner.hud} netBadge={badge} />
      {(v.status === 'reconnecting' || room.phase === 'paused') && !ended && (
        <div className="overlay" data-testid="net-paused">
          <h2 className="heading">{v.status === 'reconnecting' ? 'RECONNECTING...' : 'OPPONENT DISCONNECTED'}</h2>
          {graceLeft !== null && v.status !== 'reconnecting' && <div className="sub">Waiting {graceLeft}s for them to return...</div>}
          <button className="btn" onClick={leave}>
            LEAVE
          </button>
        </div>
      )}
      {menu && !ended && (
        <div className="overlay" data-testid="online-menu">
          <h2 className="heading">MENU</h2>
          <div className="sub">Online matches cannot be paused.</div>
          <Menu
            onBack={() => setMenu(false)}
            items={[
              { label: 'RETURN TO FIGHT', testId: 'online-resume', onSelect: () => setMenu(false) },
              { label: 'FORFEIT & LEAVE', testId: 'online-forfeit', onSelect: leave },
            ]}
          />
        </div>
      )}
      {ended && (
        <div className="overlay" data-testid="online-results">
          <h2 className="title" data-testid="result-title">
            {title}
          </h2>
          {v.matchEnd?.reason === 'forfeit' && <div className="sub">OPPONENT LEFT THE MATCH</div>}
          <div className="sub" data-testid="rematch-status">
            {me?.rematch && opp?.rematch
              ? 'STARTING REMATCH...'
              : me?.rematch
                ? 'WAITING FOR OPPONENT TO ACCEPT...'
                : opp?.rematch
                  ? 'OPPONENT WANTS A REMATCH!'
                  : opp && !opp.connected
                    ? 'OPPONENT DISCONNECTED'
                    : ' '}
          </div>
          <div className="row">
            <button
              className={`btn ${me?.rematch ? '' : 'primary'}`}
              data-testid="vote-rematch"
              disabled={!opp || !opp.connected}
              onClick={() => net.voteRematch(!me?.rematch)}
            >
              {me?.rematch ? 'CANCEL REMATCH' : 'REMATCH'}
            </button>
            <button className="btn" data-testid="change-fighter" onClick={() => net.setReady(false)}>
              CHANGE FIGHTER
            </button>
            <button className="btn" data-testid="leave-after" onClick={leave}>
              LEAVE ROOM
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
