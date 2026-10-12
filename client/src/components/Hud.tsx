import { useSyncExternalStore } from 'react';
import { bustUrl } from '../game/animation/sprites';
import type { HudData, HudSide, HudStore } from '../game/hud';

function Side({ s, side, roundsToWin }: { s: HudSide; side: 'left' | 'right'; roundsToWin: number }) {
  const pct = Math.max(0, (s.health / s.maxHealth) * 100);
  const p = side === 'left' ? 'p1' : 'p2';
  return (
    <div className={`side ${side}`}>
      <div className="who">
        <img className="bust" src={bustUrl(s.char)} alt="" />
        <span data-testid={`${p}-name`}>{s.name.toUpperCase()}</span>
        <div className="pips" data-testid={`${p}-wins`} data-wins={s.wins}>
          {Array.from({ length: roundsToWin }, (_, i) => (
            <span key={i} className={`pip ${i < s.wins ? 'on' : ''}`} />
          ))}
        </div>
      </div>
      <div
        className="healthbar"
        role="progressbar"
        aria-label={`${s.name} health`}
        aria-valuemin={0}
        aria-valuemax={s.maxHealth}
        aria-valuenow={s.health}
        data-testid={`${p}-health`}
        data-health={s.health}
        data-max={s.maxHealth}
      >
        <div className="lag" style={{ width: `${pct}%` }} />
        <div className={`fill ${pct < 25 ? 'low' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Meter({ s, side }: { s: HudSide; side: 'left' | 'right' }) {
  const p = side === 'left' ? 'p1' : 'p2';
  return (
    <div className={`meter ${side} ${s.superReady ? 'ready' : ''}`} data-testid={`${p}-meter`} data-meter={Math.floor(s.meter)}>
      <span className="label">{s.superReady ? 'SUPER READY!' : 'SUPER'}</span>
      <div className="bar">
        <div className="fill" style={{ width: `${s.meter}%` }} />
      </div>
    </div>
  );
}

export function HudView({ store, netBadge }: { store: HudStore; netBadge?: string | null }) {
  const hud: HudData | null = useSyncExternalStore(store.subscribe, store.get);
  if (!hud) return null;
  const [a, b] = hud.sides;
  return (
    <div className="hud" data-testid="hud" data-phase={hud.phase} data-round={hud.round}>
      {netBadge && <div className="net-badge" data-testid="net-badge">{netBadge}</div>}
      <div className="hud-top">
        <Side s={a} side="left" roundsToWin={hud.roundsToWin} />
        <div className="timer" data-testid="timer" data-seconds={hud.timer}>
          {String(Math.min(99, hud.timer)).padStart(2, '0')}
          <span className="rnd" data-testid="round">
            ROUND {hud.round}
          </span>
        </div>
        <Side s={b} side="right" roundsToWin={hud.roundsToWin} />
      </div>
      {a.combo >= 2 && (
        <div className="combo left" data-testid="p1-combo">
          {a.combo} HIT<small>COMBO</small>
        </div>
      )}
      {b.combo >= 2 && (
        <div className="combo right" data-testid="p2-combo">
          {b.combo} HIT<small>COMBO</small>
        </div>
      )}
      {hud.banner && (
        <div className="banner" key={hud.banner} data-testid="banner">
          {hud.banner}
          {hud.subBanner && <span className="subb">{hud.subBanner}</span>}
        </div>
      )}
      {hud.superBanner && (
        <div className="super-banner" data-testid="super-banner">
          {hud.superBanner.name}
        </div>
      )}
      <div className="status-line" data-testid="match-status">
        {hud.status}
      </div>
      <div className="hud-bottom">
        <Meter s={a} side="left" />
        <Meter s={b} side="right" />
      </div>
    </div>
  );
}
