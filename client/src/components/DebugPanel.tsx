import { useEffect, useState } from 'react';
import { getCharacter } from '../../../shared/src/characters/roster';
import { currentMove, movePhase } from '../../../shared/src/engine/boxes';
import { describeInput } from '../../../shared/src/input';
import type { LocalRunner } from '../game/engine/localRunner';

/**
 * Development-only diagnostics overlay (F2 toggles; `?debug=1` opens it).
 * `import.meta.env.DEV` is false in production builds, so this never renders there.
 */
export function DebugPanel({ runner }: { runner: LocalRunner }) {
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has('debug'));
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F2') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    const t = setInterval(() => setTick((n) => n + 1), 100);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearInterval(t);
    };
  }, []);
  if (!import.meta.env.DEV || !open) return null;

  const s = runner.state;
  const f = s.fighters[0];
  const m = currentMove(f);
  const phase = m ? movePhase(m, f.actionFrame) : '—';
  const drawn = runner.renderer?.lastFrames[0];
  const hit = runner.debug.lastHit;
  const rows: [string, string][] = [
    ['mode', 'cpu'],
    ['player', getCharacter(runner.opts.p1).name],
    ['opponent', getCharacter(runner.opts.p2).name],
    ['controllers', runner.controllers.join(' / ')],
    ['player state', `${f.action} f${f.actionFrame}${f.airborne ? ' (air)' : ''}`],
    ['animation', drawn ? `${drawn.anim} ${drawn.key}` : runner.renderer?.spritesLoaded ? '—' : 'sprites loading'],
    ['last input P1', describeInput(runner.debug.lastInput[0])],
    ['last input P2', describeInput(runner.debug.lastInput[1])],
    ['attack', m ? `${m.name} (${phase})` : '—'],
    ['last hit', hit ? `P${hit.attacker + 1} ${hit.damage} dmg @${hit.frame}` : 'none'],
    ['health', `${s.fighters[0].health} / ${s.fighters[1].health}`],
    ['loop', `${runner.debug.loopRunning ? (runner.paused ? 'paused' : 'running') : 'stopped'} · steps ${runner.debug.steps} · ${s.phase}`],
  ];
  return (
    <div
      data-testid="debug-panel"
      style={{
        position: 'absolute',
        left: '2cqw',
        top: '14cqh',
        zIndex: 40,
        background: 'rgba(0,0,0,0.78)',
        border: '1px solid #4b2a7d',
        padding: '6px 8px',
        font: '13px ui-monospace, monospace',
        color: '#c8ffd8',
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: '#ffd23a' }}>DEBUG (F2)</div>
      {rows.map(([k, v]) => (
        <div key={k} data-debug={k}>
          <span style={{ color: '#a99cc4' }}>{k}:</span> {v}
        </div>
      ))}
    </div>
  );
}
