import { useEffect, useRef } from 'react';
import { TitleDemo } from '../game/demo/titleDemo';
import { TEST_HOOKS } from '../testHooks';

declare global {
  interface Window {
    __PFDemo?: TitleDemo['stats'];
  }
}

/**
 * Animated fight scene behind the title and menus. `dim` darkens it behind menus so the
 * text stays readable. It is decorative: hidden from assistive tech and click-through.
 */
export function TitleScene({ dim }: { dim: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const demo = new TitleDemo(ref.current!);
    demo.start();
    if (TEST_HOOKS) window.__PFDemo = demo.stats;
    return () => {
      demo.stop();
    };
  }, []);
  return (
    <div className={`title-scene ${dim ? 'dim' : ''}`} aria-hidden="true" data-testid="title-scene">
      <canvas ref={ref} />
      <div className="title-scene-shade" />
    </div>
  );
}
