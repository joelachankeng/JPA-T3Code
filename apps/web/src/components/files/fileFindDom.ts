/**
 * Find inside a rendered document, such as Markdown in view mode.
 *
 * A source surface searches the text it paints and addresses matches by line,
 * because the renderer mounts one `[data-line]` row per line. A rendered
 * document has neither: the reader sees `Title`, never `## Title`, and the
 * tree it reads is paragraphs and list items rather than rows. So matching runs
 * over a flat transcript of the rendered text and matches are resolved back
 * through the text nodes that produced it.
 *
 * Block boundaries become newlines in the transcript, which keeps the per-line
 * matching in `fileFind` honest: `^` and `$` anchor per paragraph, `.` cannot
 * run from one list item into the next, and a match never spans two blocks.
 */

import { THREAD_FIND_BLOCK_TAGS } from "@t3tools/shared/threadFindText";

interface RenderedTextSegment {
  readonly node: Text;
  /** Offset of this node's first character within the transcript. */
  readonly start: number;
}

export interface RenderedTextIndex {
  /** Every rendered character, with a newline between blocks. */
  readonly text: string;
  readonly segments: ReadonlyArray<RenderedTextSegment>;
  /** Transcript offset each one-based line starts at. */
  readonly lineStarts: ReadonlyArray<number>;
}

/**
 * The block a text node belongs to. Inline markup inside a paragraph resolves
 * to the paragraph, so emphasis in the middle of a sentence does not split it.
 */
function nearestBlock(node: Text, root: HTMLElement): Element {
  let element = node.parentElement;
  while (element !== null && element !== root) {
    if (THREAD_FIND_BLOCK_TAGS.has(element.tagName.toLowerCase())) return element;
    element = element.parentElement;
  }
  return root;
}

export function indexRenderedText(root: HTMLElement): RenderedTextIndex {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  const segments: RenderedTextSegment[] = [];
  const lineStarts: number[] = [0];
  let text = "";
  let previousBlock: Element | null = null;

  const append = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === "\n") lineStarts.push(text.length + index + 1);
    }
    text += value;
  };

  let node = walker.nextNode();
  while (node !== null) {
    if (node.nodeType === 1) {
      // A hard break reads as a line ending, so it ends one here too.
      if ((node as Element).tagName === "BR" && text.length > 0) append("\n");
      node = walker.nextNode();
      continue;
    }
    const textNode = node as Text;
    if (textNode.data.length > 0) {
      const block = nearestBlock(textNode, root);
      // The separator belongs to no node on purpose: matching is per line, so
      // no match can ever land on it and need resolving back to the DOM.
      if (previousBlock !== null && block !== previousBlock) append("\n");
      previousBlock = block;
      segments.push({ node: textNode, start: text.length });
      append(textNode.data);
    }
    node = walker.nextNode();
  }

  return { text, segments, lineStarts };
}

/** The segment covering an offset, or -1 past the end of the transcript. */
function segmentIndexAt(index: RenderedTextIndex, offset: number): number {
  let low = 0;
  let high = index.segments.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = index.segments[middle];
    if (segment === undefined) break;
    if (segment.start <= offset) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * The segment an offset falls inside. Null past the end of the transcript, and
 * null on a separator, which belongs to no node.
 */
function segmentCovering(index: RenderedTextIndex, offset: number): number {
  const found = segmentIndexAt(index, offset);
  if (found === -1) return -1;
  const segment = index.segments[found];
  if (segment === undefined) return -1;
  return offset < segment.start + segment.node.data.length ? found : -1;
}

/** A DOM range over `[start, end)` of the transcript, across inline markup. */
export function renderedFindRange(
  index: RenderedTextIndex,
  start: number,
  end: number,
): Range | null {
  const first = segmentCovering(index, start);
  if (first === -1) return null;
  const startSegment = index.segments[first];
  if (startSegment === undefined) return null;

  const range = startSegment.node.ownerDocument.createRange();
  range.setStart(startSegment.node, start - startSegment.start);
  for (let cursor = first; cursor < index.segments.length; cursor += 1) {
    const segment = index.segments[cursor];
    if (segment === undefined) break;
    if (end <= segment.start + segment.node.data.length) {
      range.setEnd(segment.node, Math.max(0, end - segment.start));
      return range;
    }
  }
  return null;
}

/** The element that painted the text at an offset, for scrolling it into view. */
export function renderedFindElement(index: RenderedTextIndex, offset: number): HTMLElement | null {
  const found = segmentCovering(index, offset);
  if (found === -1) return null;
  return index.segments[found]?.node.parentElement ?? null;
}

/** The one-based transcript line an offset sits on. */
export function renderedFindLineAt(index: RenderedTextIndex, offset: number): number {
  let low = 0;
  let high = index.lineStarts.length - 1;
  let line = 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const start = index.lineStarts[middle];
    if (start === undefined) break;
    if (start <= offset) {
      line = middle + 1;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return line;
}
