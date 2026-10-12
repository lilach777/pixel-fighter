import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getCharacter } from '../../../shared/src/characters/roster';
import { HudView } from '../components/Hud';
import { DebugPanel } from '../components/DebugPanel';
import { TEST_HOOKS } from '../testHooks';
import { Menu } from '../components/Menu';
import { audio } from '../game/audio/audio';
import { LocalRunner, type LocalMatchOptions } from '../game/engine/localRunner';
import { updateSettings, useSettings } from '../settings';

declare global {
  interface Window {
    __PF?: { runner?: unknown; getState?: () => unknown; mode?: string };
  }
}

export function MatchScreen({
  opts,
  onCharacterSelect,
  onMainMenu,
  onNewOpponent,
}: {
  opts: LocalMatchOptions;
  onCharacterSelect: () => void;
  onMainMenu: () => void;
  /** Single player only: re-roll the automatic opponent. Rematch keeps the current one. */
  onNewOpponent?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [runner] = useState(() => new LocalRunner(opts));
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const settings = useSettings();
  const hud = useSyncExternalStore(runner.hud.subscribe, runner.hud.get);

  useEffect(() => {
    runner.attach(canvasRef.current!);
    runner.onMatchEnd = () => setTimeout(() => setEnded(true), 1800);
    audio.startMusic();
    if (TEST_HOOKS) window.__PF = { runner, getState: () => runner.state, mode: opts.mode };
    return () => {
      runner.detach();
      if (TEST_HOOKS && window.__PF?.runner === runner) delete window.__PF;
    };
  }, [runner, opts.mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Escape' || e.code === 'KeyP') && !ended) {
        e.preventDefault();
        setPaused((p) => {
          if (p) runner.resume();
          else runner.pause();
          return !p;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runner, ended]);

  const resume = () => {
    runner.resume();
    setPaused(false);
  };
  const restart = () => {
    runner.restart();
    setPaused(false);
    setEnded(false);
  };

  let resultTitle = '';
  if (hud?.matchWinner !== null && hud?.matchWinner !== undefined) {
    if (hud.matchWinner === 'draw') resultTitle = 'DRAW GAME';
    else if (opts.mode === 'cpu') resultTitle = hud.matchWinner === 0 ? 'YOU WIN!' : 'YOU LOSE';
    else resultTitle = `PLAYER ${hud.matchWinner + 1} WINS!`;
  }
  const winnerName = hud && typeof hud.matchWinner === 'number' ? getCharacter(hud.sides[hud.matchWinner].char).name : '';

  return (
    <div className="match" data-testid="match-screen" data-mode={opts.mode} data-p1={opts.p1} data-p2={opts.p2} data-controllers={runner.controllers.join(',')}>
      <canvas ref={canvasRef} data-testid="arena" />
      <HudView store={runner.hud} />
      <DebugPanel runner={runner} />
      {paused && !ended && (
        <div className="overlay" data-testid="pause-menu">
          <h2 className="heading">PAUSED</h2>
          <Menu
            onBack={resume}
            items={[
              { label: 'RESUME', testId: 'pause-resume', onSelect: resume },
              { label: 'RESTART MATCH', testId: 'pause-restart', onSelect: restart },
              {
                label: settings.showHitboxes ? 'HIDE HITBOXES' : 'SHOW HITBOXES',
                testId: 'pause-hitboxes',
                onSelect: () => updateSettings({ showHitboxes: !settings.showHitboxes }),
              },
              { label: 'CHARACTER SELECT', testId: 'pause-select', onSelect: onCharacterSelect },
              { label: 'MAIN MENU', testId: 'pause-main', onSelect: onMainMenu },
            ]}
          />
        </div>
      )}
      {ended && hud && (
        <div className="overlay" data-testid="results">
          <h2 className="title" data-testid="result-title">
            {resultTitle}
          </h2>
          {winnerName && <div className="sub">{winnerName.toUpperCase()} TAKES THE MATCH</div>}
          <div className="stats panel">
            <span>Rounds</span>
            <span data-testid="result-rounds">
              {hud.sides[0].wins} - {hud.sides[1].wins}
            </span>
            <span>Best combo</span>
            <span>
              {hud.bestCombo[0]} / {hud.bestCombo[1]}
            </span>
          </div>
          <Menu
            items={[
              { label: 'REMATCH', desc: opts.mode === 'cpu' ? 'Same opponent' : undefined, testId: 'result-rematch', onSelect: restart },
              ...(onNewOpponent ? [{ label: 'NEW OPPONENT', desc: 'Random new CPU fighter', testId: 'result-new-opponent', onSelect: onNewOpponent }] : []),
              { label: 'CHARACTER SELECT', testId: 'result-select', onSelect: onCharacterSelect },
              { label: 'MAIN MENU', testId: 'result-main', onSelect: onMainMenu },
            ]}
          />
        </div>
      )}
    </div>
  );
}
