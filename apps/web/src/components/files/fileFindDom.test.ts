// @vitest-environment jsdom

import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_FILE_FIND_OPTIONS, findFileMatches } from "./fileFind";
import {
  indexRenderedText,
  renderedFindElement,
  renderedFindLineAt,
  renderedFindRange,
} from "./fileFindDom";

function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("indexRenderedText", () => {
  it("reads what the document renders, not the markup behind it", () => {
    const index = indexRenderedText(render("<h1>Title</h1><p>Body text</p>"));
    expect(index.text).toBe("Title\nBody text");
  });

  it("joins inline markup into one searchable line", () => {
    const index = indexRenderedText(render("<p>hello <strong>brave</strong> world</p>"));
    expect(index.text).toBe("hello brave world");
  });

  it("separates blocks so a match cannot span two of them", () => {
    const index = indexRenderedText(render("<ul><li>alpha</li><li>beta</li></ul>"));
    expect(index.text).toBe("alpha\nbeta");
    expect(findFileMatches(index.text, "alpha\nbeta", DEFAULT_FILE_FIND_OPTIONS)).toHaveLength(0);
  });

  it("ends a line on a hard break", () => {
    const index = indexRenderedText(render("<p>first<br>second</p>"));
    expect(index.text).toBe("first\nsecond");
  });

  it("keeps the newlines inside a code block", () => {
    const index = indexRenderedText(render("<pre><code>one\ntwo</code></pre>"));
    expect(index.text).toBe("one\ntwo");
    expect(renderedFindLineAt(index, index.text.indexOf("two"))).toBe(2);
  });
});

describe("renderedFindRange", () => {
  it("selects the matched text", () => {
    const root = render("<p>the quick brown fox</p>");
    const index = indexRenderedText(root);
    const [match] = findFileMatches(index.text, "quick", DEFAULT_FILE_FIND_OPTIONS);
    expect(match).toBeDefined();
    const range = renderedFindRange(index, match!.start, match!.end);
    expect(range?.toString()).toBe("quick");
  });

  it("selects a match that runs across inline markup", () => {
    const root = render("<p>hello <strong>brave</strong> world</p>");
    const index = indexRenderedText(root);
    const [match] = findFileMatches(index.text, "lo brave wo", DEFAULT_FILE_FIND_OPTIONS);
    expect(match).toBeDefined();
    const range = renderedFindRange(index, match!.start, match!.end);
    expect(range?.toString()).toBe("lo brave wo");
  });

  it("resolves a match in a later block to that block's element", () => {
    const root = render("<p>alpha</p><p id='second'>beta</p>");
    const index = indexRenderedText(root);
    const [match] = findFileMatches(index.text, "beta", DEFAULT_FILE_FIND_OPTIONS);
    expect(match).toBeDefined();
    expect(renderedFindRange(index, match!.start, match!.end)?.toString()).toBe("beta");
    expect(renderedFindElement(index, match!.start)?.id).toBe("second");
  });

  it("has nothing to resolve past the end of the document", () => {
    const index = indexRenderedText(render("<p>alpha</p>"));
    expect(renderedFindRange(index, 99, 104)).toBeNull();
    expect(renderedFindElement(index, 99)).toBeNull();
  });
});
