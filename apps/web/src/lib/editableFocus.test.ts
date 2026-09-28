import { describe, expect, it } from "vite-plus/test";

import { deepActiveElement } from "./editableFocus";

/**
 * A stand-in for the DOM's focus chain. Only `activeElement` and `shadowRoot`
 * matter here, and jsdom cannot focus inside a shadow root the way a browser
 * does, so the chain is built directly.
 */
function host(activeElement: unknown, shadowActive?: unknown) {
  return {
    activeElement,
    ...(shadowActive === undefined ? {} : { shadowRoot: { activeElement: shadowActive } }),
  };
}

describe("deepActiveElement", () => {
  it("returns the active element when nothing is in a shadow root", () => {
    const button = {};
    expect(deepActiveElement(host(button) as never)).toBe(button);
  });

  it("descends into the shadow root a focused host stands in for", () => {
    // The diff and file renderers put their editable region in a shadow root,
    // where `document.activeElement` reports the host instead of the caret.
    const editable = {};
    const shadowHost = host(editable, editable);
    expect(deepActiveElement(host(shadowHost, editable) as never)).toBe(editable);
  });

  it("keeps descending through nested shadow roots", () => {
    const innermost = {};
    const inner = host(innermost, innermost);
    const outer = host(inner, inner);
    expect(deepActiveElement(host(outer, inner) as never)).toBe(innermost);
  });

  it("returns null when nothing holds focus", () => {
    expect(deepActiveElement(host(null) as never)).toBe(null);
  });
});
