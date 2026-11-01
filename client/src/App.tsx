import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalMatchOptions } from './game/engine/localRunner';
import { audio } from './game/audio/audio';
import { NetClient } from './multiplayer/netClient';
import { HowToPlay, MainMenu, Options, PlayMenu, TitleScreen } from './screens/MenuScreens';
import { MatchScreen } from './screens/MatchScreen';
import { OnlineFlow } from './screens/OnlineScreens';
import { CharacterSelect, VersusScreen, type SelectResult } from './screens/SelectScreens';
import { pickOpponent } from '../../shared/src/characters/opponent';
import { STAGES } from './game/rendering/stages';
import { getSettings, useSettings } from './settings';
import { TitleScene } from './components/TitleScene';
import { TEST_HOOKS } from './testHooks';

type Route =
  | { s: 'title' }
  | { s: 'menu' }
  | { s: 'play' }
  | { s: 'howto' }
  | { s: 'options' }
  | { s: 'select' }
  | { s: 'versus'; opts: LocalMatchOptions }
  | { s: 'match'; opts: LocalMatchOptions; key: number }
  | { s: 'online' };

function initialRoute(): Route {
  // Deep links used by automated tests and for quick access: ?screen=online etc.
  const p = new URLSearchParams(location.search).get('screen');
  if (p === 'menu') return { s: 'menu' };
  if (p === 'online') return { s: 'online' };
  if (p === 'play') return { s: 'play' };
  return { s: 'title' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(initialRoute);
  const settings = useSettings();
  const netRef = useRef<NetClient | null>(null);
  const net = () => (netRef.current ??= new NetClient());

  useEffect(() => {
    if (route.s === 'title' || route.s === 'menu' || route.s === 'play') audio.stopMusic();
  }, [route.s]);

  const toMenu = useCallback(() => setRoute({ s: 'menu' }), []);
  const toPlay = useCallback(() => setRoute({ s: 'play' }), []);
  const leaveOnline = useCallback(() => {
    netRef.current?.disconnect();
    setRoute({ s: 'play' });
  }, []);

  let screen: React.ReactNode;
  switch (route.s) {
    case 'title':
      screen = <TitleScreen onStart={toMenu} />;
      break;
    case 'menu':
      screen = <MainMenu onPlay={toPlay} onHowTo={() => setRoute({ s: 'howto' })} onOptions={() => setRoute({ s: 'options' })} />;
      break;
    case 'play':
      screen = <PlayMenu onCpu={() => setRoute({ s: 'select' })} onOnline={() => setRoute({ s: 'online' })} onBack={toMenu} />;
      break;
    case 'howto':
      screen = <HowToPlay onBack={toMenu} />;
      break;
    case 'options':
      screen = <Options onBack={toMenu} />;
      break;
    case 'select':
      // Single player: pick your fighter -> automatic opponent -> VS screen -> fight.
      screen = <CharacterSelect onBack={toPlay} onDone={(pick) => setRoute({ s: 'versus', opts: matchOptions(pick) })} />;
      break;
    case 'versus':
      screen = (
        <VersusScreen
          p1={route.opts.p1}
          p2={route.opts.p2}
          labels={['PLAYER 1', `CPU · ${route.opts.difficulty.toUpperCase()}`]}
          onDone={() => setRoute({ s: 'match', key: Date.now(), opts: route.opts })}
        />
      );
      break;
    case 'match':
      screen = (
        <MatchScreen
          key={route.key}
          opts={route.opts}
          onCharacterSelect={() => setRoute({ s: 'select' })}
          onMainMenu={toMenu}
          onNewOpponent={() => setRoute({ s: 'versus', opts: { ...route.opts, p2: pickOpponent(route.opts.p1, () => Math.random()) } })}
        />
      );
      break;
    case 'online':
      screen = <OnlineFlow net={net()} stage="rooftop" onExit={leaveOnline} />;
      break;
  }

  return (
    <div className="stage-wrap">
      <div className="crt">
        <div className={`screen ${settings.crt ? '' : 'no-crt'}`} data-testid="screen" data-route={route.s}>
          {/* One persistent background fight for title/menu/mode select (unmounted in matches). */}
          {(route.s === 'title' || route.s === 'menu' || route.s === 'play') && <TitleScene dim={route.s !== 'title'} />}
          {screen}
        </div>
      </div>
    </div>
  );
}

/**
 * Test builds only (dev or VITE_E2E): `?cpu=idle` makes the CPU stand still and `?stage=<id>`
 * pins the stage, so browser tests can measure exact damage and pixels. Ignored in production.
 */
function testOverrides(): { idleOpponent: boolean; stage: string | null } {
  if (!TEST_HOOKS) return { idleOpponent: false, stage: null };
  const q = new URLSearchParams(location.search);
  const stage = q.get('stage');
  return { idleOpponent: q.get('cpu') === 'idle', stage: stage && STAGES.some((s) => s.id === stage) ? stage : null };
}

function matchOptions(pick: SelectResult): LocalMatchOptions {
  const s = getSettings();
  const t = testOverrides();
  const stage = t.stage ?? STAGES[Math.floor(Math.random() * STAGES.length)].id;
  return { p1: pick.p1, p2: pick.p2, difficulty: pick.difficulty, stage, roundSeconds: s.roundSeconds, roundsToWin: s.roundsToWin, idleOpponent: t.idleOpponent };
}
