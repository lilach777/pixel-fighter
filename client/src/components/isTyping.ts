/**
 * True when a key event comes from a field the user is typing into (text inputs, textareas,
 * selects, contenteditable). Page-wide shortcuts must ignore these events, otherwise e.g.
 * Backspace in the online name field would act as "back" instead of deleting a character.
 * Sliders, checkboxes and buttons are not typing fields, so shortcuts still work there.
 */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type.toLowerCase());
  return false;
}
