/**
 * Tracks held keys by KeyboardEvent.code. Keys that are bound to game buttons have
 * their default action suppressed while active (no page scrolling with arrows/space).
 * Held keys are cleared when the window loses focus so nobody gets stuck walking.
 */
export class KeyboardState {
  readonly held = new Set<string>();
  private captured = new Set<string>();
  private listeners: ((code: string) => void)[] = [];

  constructor(private target: Window = window) {
    target.addEventListener('keydown', this.onDown, { capture: true });
    target.addEventListener('keyup', this.onUp, { capture: true });
    target.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
  }

  /** Codes whose default browser behaviour should be blocked while the game runs. */
  capture(codes: Iterable<string>): void {
    this.captured = new Set(codes);
  }

  onPress(fn: (code: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown, { capture: true });
    this.target.removeEventListener('keyup', this.onUp, { capture: true });
    this.target.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.held.clear();
  }

  private onDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    if (this.captured.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      this.held.add(e.code);
      for (const l of this.listeners) l(e.code);
    }
  };

  private onUp = (e: KeyboardEvent) => {
    if (this.captured.has(e.code)) e.preventDefault();
    this.held.delete(e.code);
  };

  private onBlur = () => {
    this.held.clear();
  };
}
