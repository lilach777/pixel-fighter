import { useEffect, useRef, useState } from 'react';
import type { Difficulty } from '../../../shared/src/ai/ai';
import { ROSTER } from '../../../shared/src/characters/roster';
import { pickOpponent } from '../../../shared/src/characters/opponent';
import { audio } from '../game/audio/audio';
import { portraitUrl } from '../game/animation/sprites';
import { getSettings, updateSettings, useSettings } from '../settings';
import { isTypingTarget } from '../components/isTyping';

export interface SelectResult {
  p1: string;
  p2: string;
  difficulty: Difficulty;
}

function Preview({ idx, side, label, locked }: { idx: number; side: 'left' | 'right'; label: string; locked: boolean }) {
  const c = ROSTER[idx];
  return (
    <div className={`preview ${side}`} data-testid={`preview-${side}`}>
      <img src={portraitUrl(c.id)} alt={c.name} />
      <div className="info">
        <div className="sub" style={{ color: side === 'left' ? 'var(--p1)' : 'var(--p2)', textAlign: side }}>
          {label}
        </div>
        <div className="cname" data-testid={`preview-${side}-name`}>
          {c.name.toUpperCase()}
        </div>
        <div className="arch">
          {c.archetype.toUpperCase()} · {c.difficulty.toUpperCase()}
        </div>
        <div className="tagline">{c.tagline}</div>
        <div className="locked">{locked ? 'LOCKED IN!' : 'CHOOSING...'}</div>
      </div>
    </div>
  );
}

/**
 * Character select (single player): pick your fighter; the opponent is then chosen
 * automatically (random, never the same character) and revealed on the VS screen.
 */
export function CharacterSelect({ onBack, onDone }: { onBack: () => void; onDone: (r: SelectResult) => void }) {
  const settings = useSettings();
  const [cursor, setCursor] = useState(0);
  const [locked, setLocked] = useState(false);
  const state = useRef({ cursor, locked });
  state.current = { cursor, locked };
  const doneRef = useRef(false);

  const move = (d: number) => {
    if (state.current.locked) return;
    audio.sfx('select');
    setCursor((c) => (c + d + ROSTER.length) % ROSTER.length);
  };
  const lock = (value: boolean) => {
    audio.sfx(value ? 'confirm' : 'back');
    setLocked(value);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return; // never steal keys from text fields
      const lk = state.current.locked;
      const s = getSettings();
      const is = (codes: string[]) => codes.includes(e.code);
      if (is(s.p1.LEFT) || e.code === 'ArrowLeft') move(-1);
      else if (is(s.p1.RIGHT) || e.code === 'ArrowRight') move(1);
      else if (is(s.p1.LP) || e.code === 'Enter') {
        if (!lk) lock(true);
      } else if (is(s.p1.HP) || e.code === 'Escape' || e.code === 'Backspace') {
        if (lk) lock(false);
        else onBack();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  useEffect(() => {
    if (locked && !doneRef.current) {
      doneRef.current = true;
      const p1 = ROSTER[cursor].id;
      // The opponent is selected automatically (never a mirror match).
      const p2 = pickOpponent(p1);
      const t = setTimeout(() => onDone({ p1, p2, difficulty: getSettings().difficulty }), 450);
      return () => {
        clearTimeout(t);
        doneRef.current = false;
      };
    }
  }, [locked, cursor, onDone]);

  const clickCard = (i: number) => {
    audio.unlock();
    if (locked) return;
    setCursor(i);
    lock(true);
  };

  return (
    <div className="screen-inner" data-testid="character-select">
      <h2 className="heading">SELECT YOUR FIGHTER</h2>
      <div className="select-grid" style={{ '--cols': ROSTER.length } as React.CSSProperties}>
        {ROSTER.map((c, i) => (
          <button
            key={c.id}
            className={`portrait-card ${cursor === i ? 'p1' : ''}`}
            onClick={() => clickCard(i)}
            onMouseEnter={() => {
              if (!locked) setCursor(i);
            }}
            data-testid={`char-${c.id}`}
            aria-label={c.name}
          >
            <img src={portraitUrl(c.id)} alt="" loading="eager" />
            <span className="pname">{c.name.toUpperCase()}</span>
            {cursor === i && <span className="cursor-tag p1">1P</span>}
          </button>
        ))}
      </div>
      <div className="versus-row">
        <Preview idx={cursor} side="left" label="PLAYER 1" locked={locked} />
        <div className="vs-badge">VS</div>
        <div className="preview right" data-testid="cpu-pending">
          <div className="info">
            <div className="cname">CPU</div>
            <div className="tagline">{locked ? 'Choosing an opponent...' : 'Opponent is chosen automatically'}</div>
          </div>
        </div>
      </div>
      <div className="row">
        <span className="sub">CPU LEVEL</span>
        <div className="segmented">
          {(['easy', 'normal', 'hard'] as const).map((d) => (
            <button key={d} className={settings.difficulty === d ? 'on' : ''} onClick={() => updateSettings({ difficulty: d })} data-testid={`diff-${d}`}>
              {d.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="footer-hints">
        <span>←/→ MOVE</span>
        <span>ENTER / F LOCK IN</span>
        <span>ESC BACK</span>
      </div>
    </div>
  );
}

/**
 * Versus transition (as in the reference): both portraits and names, then a 3-2-1
 * countdown before the match loads. Enter/click skips the wait.
 */
export function VersusScreen({ p1, p2, labels, onDone }: { p1: string; p2: string; labels: [string, string]; onDone: () => void }) {
  const [count, setCount] = useState(3);
  const done = useRef(false);
  const finish = useRef(onDone);
  finish.current = onDone;
  useEffect(() => {
    audio.sfx('round');
    const t = setInterval(() => setCount((c) => c - 1), 700);
    const skip = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return; // never steal keys from text fields
      if (e.code === 'Enter') setCount(0);
    };
    window.addEventListener('keydown', skip);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', skip);
    };
  }, []);
  useEffect(() => {
    if (count <= 0 && !done.current) {
      done.current = true;
      finish.current();
    }
  }, [count]);
  const a = ROSTER.find((c) => c.id === p1)!;
  const b = ROSTER.find((c) => c.id === p2)!;
  return (
    <div className="screen-inner grid-bg" data-testid="versus-screen" data-p1={p1} data-p2={p2} onClick={() => setCount(0)}>
      <div className="versus-row">
        <div className="preview left">
          <img src={portraitUrl(a.id)} alt={a.name} />
          <div className="info">
            <div className="sub" style={{ color: 'var(--p1)', textAlign: 'left' }}>{labels[0]}</div>
            <div className="cname" data-testid="vs-p1-name">{a.name.toUpperCase()}</div>
            <div className="arch">{a.archetype.toUpperCase()}</div>
          </div>
        </div>
        <div className="vs-badge" style={{ fontSize: '7cqw' }}>VS</div>
        <div className="preview right">
          <img src={portraitUrl(b.id)} alt={b.name} />
          <div className="info">
            <div className="sub" style={{ color: 'var(--p2)', textAlign: 'right' }}>{labels[1]}</div>
            <div className="cname" data-testid="vs-p2-name">{b.name.toUpperCase()}</div>
            <div className="arch">{b.archetype.toUpperCase()}</div>
          </div>
        </div>
      </div>
      <div className="heading" data-testid="vs-countdown">{count > 0 ? `FIGHT IN ${count}` : 'FIGHT!'}</div>
    </div>
  );
}
