import { useEffect, useRef, useState } from 'react';
import { audio } from '../game/audio/audio';

export interface MenuItem {
  label: string;
  desc?: string;
  testId: string;
  disabled?: boolean;
  onSelect: () => void;
}

/** Vertical arcade menu: arrow keys / W-S move, Enter / Space / F select, Escape triggers onBack. */
export function Menu({ items, onBack, autoFocus = true }: { items: MenuItem[]; onBack?: () => void; autoFocus?: boolean }) {
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((i) => !i.disabled)));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (autoFocus) refs.current[index]?.focus({ preventScroll: true });
  }, [index, autoFocus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const list = itemsRef.current;
      const move = (d: number) => {
        e.preventDefault();
        setIndex((i) => {
          let n = i;
          for (let k = 0; k < list.length; k++) {
            n = (n + d + list.length) % list.length;
            if (!list[n].disabled) break;
          }
          if (n !== i) audio.sfx('select');
          return n;
        });
      };
      if (e.code === 'ArrowDown' || e.code === 'KeyS') move(1);
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') move(-1);
      else if (e.code === 'Escape' || e.code === 'Backspace') {
        if (onBack) {
          e.preventDefault();
          audio.sfx('back');
          onBack();
        }
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        setIndex((i) => {
          const it = list[i];
          if (it && !it.disabled) {
            audio.sfx('confirm');
            queueMicrotask(it.onSelect);
          }
          return i;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div className="menu" role="menu">
      {items.map((it, i) => (
        <button
          key={it.testId}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="menuitem"
          data-testid={it.testId}
          className={`menu-item ${i === index ? 'active' : ''}`}
          disabled={it.disabled}
          onMouseEnter={() => !it.disabled && setIndex(i)}
          onFocus={() => setIndex(i)}
          onClick={() => {
            audio.unlock();
            audio.sfx('confirm');
            it.onSelect();
          }}
        >
          {it.label}
          {it.desc && <span className="desc">{it.desc}</span>}
        </button>
      ))}
    </div>
  );
}
