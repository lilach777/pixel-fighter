import { useEffect, useState } from 'react';
import { ROSTER } from '../../../shared/src/characters/roster';
import type { ButtonName } from '../../../shared/src/input';
import { Menu } from '../components/Menu';
import { audio } from '../game/audio/audio';
import { BUTTON_LABELS, BUTTON_ORDER, P1_DEFAULT, keyLabel, type Bindings } from '../game/input/bindings';
import { resetSettings, updateSettings, useSettings } from '../settings';
import { isTypingTarget } from '../components/isTyping';

export function TitleScreen({ onStart }: { onStart: () => void }) {
  useEffect(() => {
    const go = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return; // never steal keys from text fields
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyF') {
        e.preventDefault();
        audio.unlock();
        audio.sfx('confirm');
        onStart();
      }
    };
    window.addEventListener('keydown', go);
    return () => window.removeEventListener('keydown', go);
  }, [onStart]);
  return (
    <div
      className="screen-inner over-scene title-layout"
      data-testid="title-screen"
      onClick={() => {
        audio.unlock();
        audio.sfx('confirm');
        onStart();
      }}
      style={{ cursor: 'pointer' }}
    >
      <div className="logo">
        <span className="l1">PIXEL</span>
        <span className="l2">FIGHTERS</span>
        <span className="tag">— ARCADE —</span>
      </div>
      <div className="hint title-sub">{ROSTER.length} fighters · CPU · Online</div>
      <div style={{ flex: 1 }} />
      <div className="title-prompt">
        <span className="hint">ENTER / CLICK</span>
        <button className="btn primary blink" data-testid="press-start">
          PRESS START
        </button>
        <span className="hint">TO BEGIN</span>
      </div>
    </div>
  );
}

export function MainMenu({ onPlay, onHowTo, onOptions }: { onPlay: () => void; onHowTo: () => void; onOptions: () => void }) {
  return (
    <div className="screen-inner over-scene" data-testid="main-menu">
      <div className="logo" style={{ marginTop: '2cqh', transform: 'rotate(-3deg) scale(0.75)' }}>
        <span className="l1">PIXEL</span>
        <span className="l2">FIGHTERS</span>
      </div>
      <Menu
        items={[
          { label: 'PLAY', desc: 'Single player vs CPU or online versus', testId: 'menu-play', onSelect: onPlay },
          { label: 'HOW TO PLAY', desc: 'Controls and move lists', testId: 'menu-howto', onSelect: onHowTo },
          { label: 'OPTIONS', desc: 'Audio, display, rules, keys', testId: 'menu-options', onSelect: onOptions },
        ]}
      />
      <div className="footer-hints">
        <span>↑↓ / W S MOVE</span>
        <span>ENTER SELECT</span>
        <span>ESC BACK</span>
      </div>
    </div>
  );
}

export function PlayMenu({ onCpu, onOnline, onBack }: { onCpu: () => void; onOnline: () => void; onBack: () => void }) {
  return (
    <div className="screen-inner over-scene" data-testid="play-menu">
      <h2 className="heading" style={{ marginTop: '6cqh' }}>
        SELECT MODE
      </h2>
      <Menu
        onBack={onBack}
        items={[
          { label: '1 PLAYER  VS CPU', desc: 'Fight the computer (Easy / Normal / Hard)', testId: 'mode-cpu', onSelect: onCpu },
          { label: 'ONLINE  VERSUS', desc: 'Create or join a room over the internet', testId: 'mode-online', onSelect: onOnline },
          { label: 'BACK', testId: 'mode-back', onSelect: onBack },
        ]}
      />
    </div>
  );
}

function KeysTable({ b }: { b: Bindings }) {
  return (
    <table className="keys-table">
      <tbody>
        {BUTTON_ORDER.map((n) => (
          <tr key={n}>
            <td>{BUTTON_LABELS[n]}</td>
            <td>{b[n].map(keyLabel).join(' / ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HowToPlay({ onBack }: { onBack: () => void }) {
  const s = useSettings();
  useEscape(onBack);
  const [charIdx, setCharIdx] = useState(0);
  const c = ROSTER[charIdx];
  const order = ['lp', 'hp', 'lk', 'hk', 'crLk', 'launcher', 'airPunch', 'airKick', 'special', 'specialAlt', 'super'] as const;
  const inputs: Record<(typeof order)[number], string> = {
    lp: 'LP',
    hp: 'HP',
    lk: 'LK',
    hk: 'HK',
    crLk: 'Down + LK',
    launcher: 'Down + HK',
    airPunch: 'Air LP/HP',
    airKick: 'Air LK/HK',
    special: 'SPECIAL',
    specialAlt: 'Down + SPECIAL',
    super: 'SUPER (full meter)',
  };
  return (
    <div className="screen-inner" data-testid="howto-screen">
      <h2 className="heading">HOW TO PLAY</h2>
      <div className="columns">
        <div className="panel scroll">
          <div className="sub" style={{ textAlign: 'left', color: 'var(--p1)' }}>CONTROLS</div>
          <KeysTable b={s.p1} />
          <div className="movelist" style={{ marginTop: '2cqh' }}>
            <h4>BASICS</h4>
            Hold <b>back</b> to block (crouch-block lows, stand-block overheads and jump-ins). Double-tap forward/back to dash.
            Connect a light attack, then press a heavy or special during its cancel window to combo. Hits fill the SUPER meter —
            when it reads SUPER READY press SUPER. Win 2 rounds of 60 seconds. ESC pauses (offline).
          </div>
        </div>
        <div className="panel scroll movelist" data-testid="movelist">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn" onClick={() => setCharIdx((charIdx + ROSTER.length - 1) % ROSTER.length)} data-testid="movelist-prev">
              ◀
            </button>
            <span className="pixel" style={{ color: c.accent, fontSize: '1.2cqw' }} data-testid="movelist-name">
              {c.name.toUpperCase()}
            </span>
            <button className="btn" onClick={() => setCharIdx((charIdx + 1) % ROSTER.length)} data-testid="movelist-next">
              ▶
            </button>
          </div>
          <div style={{ color: 'var(--muted)', margin: '1cqh 0' }}>
            {c.archetype} — {c.tagline}
          </div>
          {order.map((slot) => {
            const m = c.moves[slot];
            return (
              <div key={slot}>
                <h4>
                  {inputs[slot]} · {m.name}
                </h4>
                {m.description} <span style={{ color: 'var(--muted)' }}>({m.startup}f startup, {m.damage + (m.projectile?.damage ?? 0)} dmg)</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={onBack} data-testid="howto-back">
          BACK
        </button>
      </div>
    </div>
  );
}

function useEscape(fn: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return; // never steal keys from text fields
      if (e.code === 'Escape') {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [fn]);
}

function BindingEditor() {
  const s = useSettings();
  const player = 'p1';
  const b = s[player];
  const [listening, setListening] = useState<ButtonName | null>(null);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') updateSettings({ [player]: { ...b, [listening]: [e.code] } });
      setListening(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [listening, b, player]);
  return (
    <div>
      {BUTTON_ORDER.map((n) => (
        <div className="option-row" key={n}>
          <span>{BUTTON_LABELS[n]}</span>
          <button
            className={`keycap ${listening === n ? 'listening' : ''}`}
            data-testid={`bind-${player}-${n}`}
            onClick={() => setListening(n)}
          >
            {listening === n ? 'PRESS KEY' : b[n].map(keyLabel).join('/')}
          </button>
        </div>
      ))}
    </div>
  );
}

export function Options({ onBack }: { onBack: () => void }) {
  const s = useSettings();
  useEscape(onBack);
  const toggle = (k: 'sfx' | 'music' | 'showHitboxes' | 'crt', label: string) => (
    <div className="option-row">
      <span>{label}</span>
      <button
        className="btn"
        data-testid={`opt-${k}`}
        onClick={() => {
          updateSettings({ [k]: !s[k] });
          if (k === 'music') {
            if (s.music) audio.stopMusic();
            else setTimeout(() => audio.startMusic(), 0);
          }
        }}
      >
        {s[k] ? 'ON' : 'OFF'}
      </button>
    </div>
  );
  return (
    <div className="screen-inner" data-testid="options-screen">
      <h2 className="heading">OPTIONS</h2>
      <div className="columns">
        <div className="panel scroll">
          <div className="option-row">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.volume}
              data-testid="opt-volume"
              onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
            />
          </div>
          {toggle('sfx', 'Sound effects')}
          {toggle('music', 'Music')}
          {toggle('crt', 'CRT scanlines')}
          {toggle('showHitboxes', 'Show hitboxes (debug)')}
          <div className="option-row">
            <span>CPU difficulty</span>
            <div className="segmented">
              {(['easy', 'normal', 'hard'] as const).map((d) => (
                <button key={d} className={s.difficulty === d ? 'on' : ''} onClick={() => updateSettings({ difficulty: d })} data-testid={`opt-diff-${d}`}>
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="option-row">
            <span>Round time</span>
            <div className="segmented">
              {[30, 60, 99].map((t) => (
                <button key={t} className={s.roundSeconds === t ? 'on' : ''} onClick={() => updateSettings({ roundSeconds: t })} data-testid={`opt-time-${t}`}>
                  {t}s
                </button>
              ))}
            </div>
          </div>
          <div className="option-row">
            <span>Match length</span>
            <div className="segmented">
              {[1, 2, 3].map((r) => (
                <button key={r} className={s.roundsToWin === r ? 'on' : ''} onClick={() => updateSettings({ roundsToWin: r })} data-testid={`opt-rounds-${r}`}>
                  BEST OF {r * 2 - 1}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ marginTop: '2cqh' }}>
            <button className="btn" onClick={() => updateSettings({ p1: P1_DEFAULT })}>
              RESET KEYS
            </button>
            <button className="btn" onClick={resetSettings} data-testid="opt-reset">
              RESET ALL
            </button>
          </div>
        </div>
        <div className="panel scroll">
          <div className="sub" style={{ textAlign: 'left', color: 'var(--p1)' }}>KEYS (single player and online)</div>
          <BindingEditor />
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={onBack} data-testid="options-back">
          BACK
        </button>
      </div>
    </div>
  );
}
