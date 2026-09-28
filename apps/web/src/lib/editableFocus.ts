const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(",");

/**
 * Whether a text-editing element owns the keyboard. Shortcuts that share
 * their chord with native editing (mod+z) must yield when this is true.
 */
export function isEditableFocused(target: EventTarget | null = document.activeElement): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;
}

/**
 * The element that actually holds the caret.
 *
 * `document.activeElement` stops at a shadow host, so an editor mounted inside
 * one (the diff and file renderers are) reads as an ordinary element and every
 * "is the reader typing?" check answers no.
 */
export function deepActiveElement(root: Document | ShadowRoot = document): Element | null {
  const active = root.activeElement;
  return active?.shadowRoot ? deepActiveElement(active.shadowRoot) : active;
}
