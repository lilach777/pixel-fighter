import { useEffect, useRef, useState } from 'react';
import type { Difficulty } from '../../../shared/src/ai/ai';
import { ROSTER } from '../../../shared/src/characters/roster';
import { pickOpponent } from '../../../shared/src/characters/opponent';
import { audio } from '../game/audio/audio';
import { portraitUrl } from '../game/animation/sprites';
import { STAGES } from '../game/rendering/stages';
import { getSettings, updateSettings, useSettings } from '../settings';

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
 * Character select. Local versus: P1 uses P1 keys, P2 uses P2 keys (LP confirms, HP cancels).
 * CPU mode: P1 picks only their own fighter; the opponent is then chosen automatically
 * (random, never the same character) and revealed on the VS screen.
 */
export function CharacterSelect({ mode, onBack, onDone }: { mode: 'cpu' | 'local'; onBack: () => void; onDone: (r: SelectResult) => void }) {
  const settings = useSettings();
  const [cursor, setCursor] = useState<[number, number]>([0, 4]);
  const [locked, setLocked] = useState<[boolean, boolean]>([false, false]);
  const state = useRef({ cursor, locked });
  state.current = { cursor, locked };
  const doneRef = useRef(false);

  const activeCpuSide = 0;

  const move = (side: 0 | 1, d: number) => {
    if (state.current.locked[side]) return;
    audio.sfx('select');
    setCursor((c) => {
      const n: [number, number] = [...c];
      n[side] = (n[side] + d + ROSTER.length) % ROSTER.length;
      return n;
    });
  };
  const lock = (side: 0 | 1, value: boolean) => {
    audio.sfx(value ? 'confirm' : 'back');
    setLocked((l) => {
      const n: [boolean, boolean] = [...l];
      n[side] = value;
      return n;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { locked: lk } = state.current;
      const s = getSettings();
      const is = (codes: string[]) => codes.includes(e.code);
      if (mode === 'cpu') {
        if (is(s.p1.LEFT) || e.code === 'ArrowLeft') move(0, -1);
        else if (is(s.p1.RIGHT) || e.code === 'ArrowRight') move(0, 1);
        else if (is(s.p1.LP) || e.code === 'Enter') {
          if (!lk[0]) lock(0, true);
        } else if (is(s.p1.HP) || e.code === 'Escape' || e.code === 'Backspace') {
          if (lk[0]) lock(0, false);
          else onBack();
        } else return;
        e.preventDefault();
        return;
      }
      // Local versus: independent cursors.
      if (is(s.p1.LEFT)) move(0, -1);
      else if (is(s.p1.RIGHT)) move(0, 1);
      else if (is(s.p1.LP) || e.code === 'Enter') lock(0, true);
      else if (is(s.p1.HP)) lock(0, false);
      else if (is(s.p2.LEFT)) move(1, -1);
      else if (is(s.p2.RIGHT)) move(1, 1);
      else if (is(s.p2.LP)) lock(1, true);
      else if (is(s.p2.HP)) lock(1, false);
      else if (e.code === 'Escape') {
        if (lk[0] || lk[1]) setLocked([false, false]);
        else onBack();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onBack]);

  useEffect(() => {
    const ready = mode === 'cpu' ? locked[0] : locked[0] && locked[1];
    if (ready && !doneRef.current) {
      doneRef.current = true;
      const p1 = ROSTER[cursor[0]].id;
      // Single player: the opponent is selected automatically (never a mirror match).
      const p2 = mode === 'cpu' ? pickOpponent(p1) : ROSTER[cursor[1]].id;
      const t = setTimeout(() => onDone({ p1, p2, difficulty: getSettings().difficulty }), 450);
      return () => {
        clearTimeout(t);
        doneRef.current = false;
      };
    }
  }, [locked, cursor, onDone, mode]);

  const clickCard = (i: number) => {
    audio.unlock();
    const side: 0 | 1 = mode === 'cpu' ? activeCpuSide : !locked[0] ? 0 : 1;
    if (locked[side]) return;
    setCursor((c) => {
      const n: [number, number] = [...c];
      n[side] = i;
      return n;
    });
    lock(side, true);
  };

  return (
    <div className="screen-inner" data-testid="character-select">
      <h2 className="heading">SELECT YOUR FIGHTER</h2>
      <div className="select-grid" style={{ '--cols': ROSTER.length } as React.CSSProperties}>
        {ROSTER.map((c, i) => {
          const p1 = cursor[0] === i;
          const p2 = mode === 'local' && cursor[1] === i;
          return (
            <button
              key={c.id}
              className={`portrait-card ${p1 ? 'p1' : ''} ${p2 ? 'p2' : ''}`}
              onClick={() => clickCard(i)}
              onMouseEnter={() => {
                const side: 0 | 1 = mode === 'cpu' ? activeCpuSide : !locked[0] ? 0 : 1;
                if (!locked[side])
                  setCursor((cur) => {
                    const n: [number, number] = [...cur];
                    n[side] = i;
                    return n;
                  });
              }}
              data-testid={`char-${c.id}`}
              aria-label={c.name}
            >
              <img src={portraitUrl(c.id)} alt="" loading="eager" />
              <span className="pname">{c.name.toUpperCase()}</span>
              {p1 && <span className="cursor-tag p1">1P</span>}
              {p2 && <span className="cursor-tag p2">2P</span>}
            </button>
          );
        })}
      </div>
      <div className="versus-row">
        <Preview idx={cursor[0]} side="left" label="PLAYER 1" locked={locked[0]} />
        <div className="vs-badge">VS</div>
        {mode === 'local' ? (
          <Preview idx={cursor[1]} side="right" label="PLAYER 2" locked={locked[1]} />
        ) : (
          <div className="preview right" data-testid="cpu-pending">
            <div className="info">
              <div className="cname">CPU</div>
              <div className="tagline">{locked[0] ? 'Choosing an opponent...' : 'Opponent is chosen automatically'}</div>
            </div>
          </div>
        )}
      </div>
      {mode === 'cpu' && (
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
      )}
      <div className="footer-hints">
        {mode === 'local' ? (
          <>
            <span>1P: A/D MOVE · F PICK · G CANCEL</span>
            <span>2P: ←/→ MOVE · {settings.p2.LP.map((k) => k.replace('Numpad', 'NUM')).join('/')} PICK</span>
          </>
        ) : (
          <>
            <span>←/→ MOVE</span>
            <span>ENTER / F LOCK IN</span>
            <span>ESC BACK</span>
          </>
        )}
      </div>
    </div>
  );
}

export function StageSelect({ onBack, onDone }: { onBack: () => void; onDone: (stage: string) => void }) {
  const [i, setI] = useState(0);
  const iRef = useRef(i);
  iRef.current = i;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') setI((v) => (v + STAGES.length - 1) % STAGES.length);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') setI((v) => (v + 1) % STAGES.length);
      else if (e.code === 'Enter' || e.code === 'KeyF') {
        audio.sfx('confirm');
        onDone(STAGES[iRef.current].id);
      } else if (e.code === 'Escape') onBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, onDone]);
  return (
    <div className="screen-inner grid-bg" data-testid="stage-select">
      <h2 className="heading" style={{ marginTop: '6cqh' }}>
        SELECT STAGE
      </h2>
      <div className="stage-cards">
        {STAGES.map((s, k) => (
          <button
            key={s.id}
            className={`stage-card ${k === i ? 'active' : ''}`}
            style={{ background: `linear-gradient(180deg, ${s.preview[0]} 0%, ${s.preview[0]} 55%, ${s.preview[1]} 100%)` }}
            onMouseEnter={() => setI(k)}
            onClick={() => {
              audio.sfx('confirm');
              onDone(s.id);
            }}
            data-testid={`stage-${s.id}`}
          >
            <span className="sname">{s.name.toUpperCase()}</span>
            <span style={{ color: 'var(--muted)' }}>{s.description}</span>
          </button>
        ))}
      </div>
      <div className="footer-hints">
        <span>←/→ CHOOSE</span>
        <span>ENTER FIGHT</span>
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
