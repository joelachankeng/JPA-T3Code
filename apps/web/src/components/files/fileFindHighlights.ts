import type { FileFindMatch } from "./fileFind";

/**
 * Find matches are painted with the CSS Custom Highlight API over whichever
 * rows the renderer currently has mounted, so highlighting never touches the
 * rendered DOM, its caches, or the editor's own selection. The `::highlight()`
 * rules ride along in the surface's `unsafeCSS`, because a highlight rule only
 * styles text inside its own tree — and for the same reason they are installed
 * in the document as well, since a rendered document is painted in the light
 * DOM rather than the renderer's shadow root.
 */
const FILE_FIND_MATCH_HIGHLIGHT = "t3-file-find";
const FILE_FIND_ACTIVE_HIGHLIGHT = "t3-file-find-active";

export const FILE_FIND_HIGHLIGHT_UNSAFE_CSS = `
  ::highlight(${FILE_FIND_MATCH_HIGHLIGHT}) {
    background-color: light-dark(#ff963288, #ff963266);
  }

  ::highlight(${FILE_FIND_ACTIVE_HIGHLIGHT}) {
    background-color: light-dark(#ff9632, #ffab4d);
    color: #1a1205;
  }
`;

interface SharedHighlights {
  readonly match: Highlight;
  readonly active: Highlight;
}

let sharedHighlights: SharedHighlights | null | undefined;

const FILE_FIND_STYLE_ELEMENT_ID = "t3-file-find-highlight-styles";

/**
 * Installs the same rules in the document, once, for surfaces that paint in
 * the light DOM. Written from the one constant so the two trees cannot drift.
 */
function installDocumentHighlightStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(FILE_FIND_STYLE_ELEMENT_ID) !== null) return;
  const style = document.createElement("style");
  style.id = FILE_FIND_STYLE_ELEMENT_ID;
  style.textContent = FILE_FIND_HIGHLIGHT_UNSAFE_CSS;
  document.head.append(style);
}

/**
 * Two registry entries shared by every file surface on the page; each painter
 * adds and removes only its own ranges. Undefined where the browser has no
 * highlight registry, which leaves find working without the paint.
 */
function getSharedHighlights(): SharedHighlights | null {
  if (sharedHighlights !== undefined) return sharedHighlights;
  if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") {
    sharedHighlights = null;
    return null;
  }
  installDocumentHighlightStyles();
  sharedHighlights = { match: new Highlight(), active: new Highlight() };
  CSS.highlights.set(FILE_FIND_MATCH_HIGHLIGHT, sharedHighlights.match);
  CSS.highlights.set(FILE_FIND_ACTIVE_HIGHLIGHT, sharedHighlights.active);
  return sharedHighlights;
}

/** A DOM range over `[start, end)` characters of a rendered line's text. */
export function createLineTextRange(
  lineElement: Element,
  start: number,
  end: number,
): Range | null {
  const walker = lineElement.ownerDocument.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let node = walker.nextNode();
  while (node !== null) {
    const text = node as Text;
    const length = text.data.length;
    if (startNode === null && start < consumed + length) {
      startNode = text;
      startOffset = start - consumed;
    }
    if (startNode !== null && end <= consumed + length) {
      const range = lineElement.ownerDocument.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(text, end - consumed);
      return range;
    }
    consumed += length;
    node = walker.nextNode();
  }
  return null;
}

/**
 * How a match becomes a range to paint. A source surface resolves through the
 * renderer's mounted rows; a rendered document resolves through the text nodes
 * behind its transcript. Either way the painter only ever sees ranges.
 */
export type FileFindRangeResolver = (match: FileFindMatch) => Range | null;

/**
 * Resolves against the rows the renderer currently has mounted. Lookups are
 * memoised for the one paint pass that owns the resolver, because a line with
 * many matches would otherwise re-query the row for each of them.
 */
export function createLineRangeResolver(container: HTMLElement): FileFindRangeResolver {
  const root = container.shadowRoot ?? container;
  const rows = new Map<number, Element | null>();
  return (match) => {
    let lineElement = rows.get(match.line);
    if (lineElement === undefined) {
      lineElement = root.querySelector(`[data-line="${match.line}"]`);
      rows.set(match.line, lineElement);
    }
    if (lineElement === null) return null;
    return createLineTextRange(lineElement, match.column, match.column + (match.end - match.start));
  };
}

interface FileFindPainter {
  /** Repaint what is mounted. Safe to call on every render pass. */
  paint(
    resolve: FileFindRangeResolver,
    matches: ReadonlyArray<FileFindMatch>,
    activeIndex: number | null,
  ): void;
  clear(): void;
}

export function createFileFindPainter(): FileFindPainter {
  let painted: Range[] = [];

  const release = () => {
    const highlights = getSharedHighlights();
    if (highlights !== null) {
      for (const range of painted) {
        highlights.match.delete(range);
        highlights.active.delete(range);
      }
    }
    painted = [];
  };

  return {
    paint(resolve, matches, activeIndex) {
      release();
      const highlights = getSharedHighlights();
      if (highlights === null || matches.length === 0) return;

      const active = activeIndex === null ? undefined : matches[activeIndex];
      for (const match of matches) {
        const range = resolve(match);
        if (range === null) continue;
        (match === active ? highlights.active : highlights.match).add(range);
        painted.push(range);
      }
    },
    clear() {
      release();
    },
  };
}
