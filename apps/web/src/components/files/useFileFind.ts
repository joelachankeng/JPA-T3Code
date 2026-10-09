import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { VirtualizedFile, type PostRenderPhase } from "@pierre/diffs";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { resolveShortcutCommand } from "~/keybindings";

import type { FileFindMode } from "./FileFindBar";
import {
  DEFAULT_FILE_FIND_OPTIONS,
  compileFileFindPattern,
  fileFindReplacement,
  findFileMatches,
  firstFileFindIndexFrom,
  firstFileFindIndexFromLine,
  stepFileFindIndex,
  type FileFindMatch,
  type FileFindOptions,
} from "./fileFind";
import {
  indexRenderedText,
  renderedFindElement,
  renderedFindLineAt,
  renderedFindRange,
  type RenderedTextIndex,
} from "./fileFindDom";
import {
  createFileFindPainter,
  createLineRangeResolver,
  createLineTextRange,
} from "./fileFindHighlights";
import { resolveFileFindScrollTop } from "./fileFindReveal";

/** One replacement, in the renderer's one-based line coordinates. */
export interface FileFindReplaceEdit {
  readonly line: number;
  readonly column: number;
  readonly length: number;
  readonly newText: string;
}

/**
 * The renderer's post-render hook, taken loosely: find only needs the mounted
 * rows and the virtualizer's line metrics, never the annotation type that makes
 * the renderer's own signature generic.
 */
type FileFindPostRender = (
  fileContainer: HTMLElement,
  instance: unknown,
  phase: PostRenderPhase,
) => void;

/**
 * Frames spent walking to a match. The virtualizer sizes unmeasured lines as
 * one row, so its estimate for a line far outside the mounted window starts out
 * badly wrong on a wrapped file and only sharpens as each scroll mounts and
 * measures more rows. Reapplying it every frame converges; this bounds the walk
 * the way the chat-link reveal bounds its own.
 */
const MAX_REVEAL_PASSES = 30;

/** The find row plus its top offset, and the same with the replace row below it. */
const FIND_BAR_RESERVED_HEIGHT = 52;
const REPLACE_BAR_RESERVED_HEIGHT = 94;

/** Room to keep either side of a match when the code scrolls sideways. */
const HORIZONTAL_REVEAL_MARGIN = 48;

/**
 * Bring a match on a long line into view sideways. With word wrap off the code
 * column is its own horizontal scroller, so a highlighted match can otherwise
 * sit painted but off screen.
 */
function revealMatchHorizontally(
  root: DocumentFragment | HTMLElement,
  lineElement: HTMLElement,
  match: FileFindMatch,
): void {
  const code = root.querySelector<HTMLElement>("[data-code]");
  if (code === null || code.scrollWidth <= code.clientWidth) return;
  const range = createLineTextRange(lineElement, match.column, match.column + match.text.length);
  const rect = range?.getBoundingClientRect();
  if (rect === undefined || rect.width === 0) return;
  const codeRect = code.getBoundingClientRect();
  if (rect.left < codeRect.left + HORIZONTAL_REVEAL_MARGIN) {
    code.scrollLeft += rect.left - codeRect.left - HORIZONTAL_REVEAL_MARGIN;
  } else if (rect.right > codeRect.right - HORIZONTAL_REVEAL_MARGIN) {
    code.scrollLeft += rect.right - codeRect.right + HORIZONTAL_REVEAL_MARGIN;
  }
}

/**
 * The scroller a rendered document sits in. A source surface always scrolls in
 * `.file-preview-virtualizer`; a rendered one is handed to whichever scroll
 * container the surface wrapped it in, so it is found by walking out.
 */
function nearestScroller(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current !== null) {
    if (current.scrollHeight > current.clientHeight + 1) {
      const overflowY = getComputedStyle(current).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return current;
    }
    current = current.parentElement;
  }
  return null;
}

interface FileFindBarState {
  readonly open: boolean;
  readonly mode: FileFindMode;
  readonly query: string;
  readonly replaceQuery: string;
  readonly options: FileFindOptions;
  readonly matchCount: number;
  readonly activeIndex: number;
  readonly invalidPattern: boolean;
  readonly focusField: FileFindMode;
  readonly focusRequestId: number;
  readonly onQueryChange: (query: string) => void;
  readonly onReplaceQueryChange: (query: string) => void;
  readonly onOptionsChange: (update: (current: FileFindOptions) => FileFindOptions) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onClose: () => void;
  readonly onReplace?: (() => void) | undefined;
  readonly onReplaceAll?: (() => void) | undefined;
}

interface FileFindController {
  readonly isOpen: boolean;
  readonly open: (mode: FileFindMode) => void;
  /** Composed into the surface's `onPostRender`, which is when rows mount. */
  readonly onPostRender: FileFindPostRender;
  readonly bar: FileFindBarState;
}

interface UseFileFindInput {
  /** The surface pane, which owns the shortcut while it holds the keyboard. */
  readonly surfaceRef: RefObject<HTMLElement | null>;
  /** The source text on screen, or null while the surface shows none. */
  readonly text: string | null;
  /** Identifies the open document, so a new file starts from its own matches. */
  readonly documentKey: string | null;
  readonly keybindings: ResolvedKeybindingsConfig;
  /** Absent in a read-only surface, which leaves the bar in find mode. */
  readonly applyReplace?: ((edits: ReadonlyArray<FileFindReplaceEdit>) => void) | undefined;
  /**
   * A rendered document to search instead of source text, such as Markdown in
   * view mode. What the reader sees is searched, so a heading matches `Title`
   * rather than `## Title`, and replace stays unavailable: the rendered tree is
   * not the file, so there is nothing there to edit.
   */
  readonly renderedRootRef?: RefObject<HTMLElement | null> | undefined;
}

export function useFileFind(input: UseFileFindInput): FileFindController {
  const { applyReplace, documentKey, keybindings, renderedRootRef, surfaceRef, text } = input;
  // A rendered document counts as searchable before its transcript is read:
  // the chord has to answer on the first press, and that press is what reads it.
  const enabled = text !== null || renderedRootRef !== undefined;
  // Never in a rendered document. Its tree is output, not the file, so there is
  // nothing in it to write back.
  const allowReplace = text !== null && applyReplace !== undefined;

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<FileFindMode>("find");
  const [query, setQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [options, setOptions] = useState<FileFindOptions>(DEFAULT_FILE_FIND_OPTIONS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focus, setFocus] = useState<{ field: FileFindMode; requestId: number }>({
    field: "find",
    requestId: 0,
  });

  const [renderedIndex, setRenderedIndex] = useState<RenderedTextIndex | null>(null);
  useEffect(() => {
    const root = renderedRootRef?.current ?? null;
    if (!isOpen || root === null) {
      setRenderedIndex(null);
      return;
    }
    let frame: number | null = null;
    const rebuild = () => {
      frame = null;
      setRenderedIndex(indexRenderedText(root));
    };
    rebuild();
    // The rendered tree keeps moving after it mounts: code blocks highlight,
    // images settle, task lists toggle. Re-reading it on each mutation keeps
    // every offset pointing at the node it was measured from.
    const observer = new MutationObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(rebuild);
    });
    observer.observe(root, { characterData: true, childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
    // `documentKey` re-reads the tree when the open file changes: the surface
    // remounts per file, so the observer would otherwise watch a detached node.
  }, [documentKey, isOpen, renderedRootRef]);

  const searchText = text ?? renderedIndex?.text ?? null;
  const matches = useMemo<ReadonlyArray<FileFindMatch>>(
    () => (isOpen && searchText !== null ? findFileMatches(searchText, query, options) : []),
    [isOpen, options, query, searchText],
  );
  const invalidPattern = query !== "" && compileFileFindPattern(query, options) === null;
  const activeMatchIndex = matches.length === 0 ? null : Math.min(activeIndex, matches.length - 1);
  const replacing = mode === "replace" && allowReplace;

  const painterRef = useRef(createFileFindPainter());
  const containerRef = useRef<HTMLElement | null>(null);
  const instanceRef = useRef<unknown>(null);
  const revealRef = useRef<{ match: FileFindMatch; passes: number } | null>(null);
  const revealFrameRef = useRef<number | null>(null);
  const matchesRef = useRef<ReadonlyArray<FileFindMatch>>(matches);
  matchesRef.current = matches;
  const activeMatchIndexRef = useRef(activeMatchIndex);
  activeMatchIndexRef.current = activeMatchIndex;
  const reservedTopRef = useRef(FIND_BAR_RESERVED_HEIGHT);
  reservedTopRef.current = replacing ? REPLACE_BAR_RESERVED_HEIGHT : FIND_BAR_RESERVED_HEIGHT;

  const scrollContainer = useCallback(
    () => containerRef.current?.closest<HTMLElement>(".file-preview-virtualizer") ?? null,
    [],
  );

  const renderedIndexRef = useRef(renderedIndex);
  renderedIndexRef.current = renderedIndex;

  const paint = useCallback(
    (nextMatches: ReadonlyArray<FileFindMatch>, nextActive: number | null) => {
      if (renderedIndex !== null) {
        painterRef.current.paint(
          (match) => renderedFindRange(renderedIndex, match.start, match.end),
          nextMatches,
          nextActive,
        );
        return;
      }
      const container = containerRef.current;
      if (container === null) return;
      painterRef.current.paint(createLineRangeResolver(container), nextMatches, nextActive);
    },
    [renderedIndex],
  );

  /** The topmost line still on screen, so a fresh query starts where the reader is. */
  const firstVisibleLine = useCallback((): number => {
    const index = renderedIndexRef.current;
    if (index !== null) {
      const root = renderedRootRef?.current ?? null;
      const scroller = root === null ? null : nearestScroller(root);
      if (root === null || scroller === null) return 1;
      const viewportTop = scroller.getBoundingClientRect().top;
      for (const segment of index.segments) {
        const element = segment.node.parentElement;
        if (element === null) continue;
        if (element.getBoundingClientRect().bottom <= viewportTop) continue;
        return renderedFindLineAt(index, segment.start);
      }
      return 1;
    }
    const container = containerRef.current;
    const scroller = scrollContainer();
    if (container === null || scroller === null) return 1;
    const viewportTop = scroller.getBoundingClientRect().top;
    const root = container.shadowRoot ?? container;
    for (const element of root.querySelectorAll<HTMLElement>("[data-line]")) {
      if (element.getBoundingClientRect().bottom <= viewportTop) continue;
      const line = Number(element.dataset.line);
      return Number.isFinite(line) && line > 0 ? line : 1;
    }
    return 1;
  }, [renderedRootRef, scrollContainer]);

  /** One pass at bringing the pending match on screen. True while more are needed. */
  const revealPass = useCallback((): boolean => {
    const index = renderedIndexRef.current;
    if (index !== null) {
      // Nothing here is virtualized, so one pass always arrives.
      const pending = revealRef.current;
      revealRef.current = null;
      const root = renderedRootRef?.current ?? null;
      if (pending === null || root === null) return false;
      const element = renderedFindElement(index, pending.match.start);
      if (element === null) return false;
      const scroller = nearestScroller(root);
      if (scroller === null) {
        element.scrollIntoView({ block: "center" });
        return false;
      }
      const scrollRect = scroller.getBoundingClientRect();
      const range = renderedFindRange(index, pending.match.start, pending.match.end);
      const rect = range?.getBoundingClientRect() ?? element.getBoundingClientRect();
      const target = resolveFileFindScrollTop({
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        viewportHeight: scroller.clientHeight,
        reservedTop: reservedTopRef.current,
        lineTop: scroller.scrollTop + rect.top - scrollRect.top,
        lineHeight: rect.height,
        measured: "rendered",
      });
      if (target !== null) scroller.scrollTop = target;
      return false;
    }

    const pending = revealRef.current;
    const container = containerRef.current;
    const scroller = scrollContainer();
    if (pending === null || container === null) return false;
    if (scroller === null) {
      revealRef.current = null;
      return false;
    }

    const scrollRect = scroller.getBoundingClientRect();
    const root = container.shadowRoot ?? container;
    const lineElement = root.querySelector<HTMLElement>(`[data-line="${pending.match.line}"]`);
    let lineTop: number | null = null;
    let lineHeight = 0;
    let measured: "rendered" | "estimated" = "estimated";
    if (lineElement !== null) {
      const lineRect = lineElement.getBoundingClientRect();
      lineTop = scroller.scrollTop + lineRect.top - scrollRect.top;
      lineHeight = lineRect.height;
      measured = "rendered";
      revealMatchHorizontally(root, lineElement, pending.match);
    } else if (instanceRef.current instanceof VirtualizedFile) {
      const position = instanceRef.current.getLinePosition(pending.match.line);
      if (position !== undefined) {
        const fileTop = scroller.scrollTop + container.getBoundingClientRect().top - scrollRect.top;
        lineTop = fileTop + position.top;
        lineHeight = position.height;
      }
    }

    pending.passes += 1;
    if (lineTop === null) {
      if (pending.passes >= MAX_REVEAL_PASSES) revealRef.current = null;
      return revealRef.current !== null;
    }

    const target = resolveFileFindScrollTop({
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      viewportHeight: scroller.clientHeight,
      reservedTop: reservedTopRef.current,
      lineTop,
      lineHeight,
      measured,
    });
    if (target === null) {
      revealRef.current = null;
      return false;
    }
    // A settled estimate is not an arrival: the renderer mounts rows a frame
    // after the scroll, so only a mounted row ends the reveal.
    const settled = measured === "rendered" && Math.abs(target - scroller.scrollTop) <= 1;
    scroller.scrollTop = target;
    if (settled || pending.passes >= MAX_REVEAL_PASSES) revealRef.current = null;
    return revealRef.current !== null;
  }, [renderedRootRef, scrollContainer]);

  const scheduleReveal = useCallback(() => {
    const pass = () => {
      revealFrameRef.current = null;
      if (revealPass()) revealFrameRef.current = requestAnimationFrame(pass);
      paint(matchesRef.current, activeMatchIndexRef.current);
    };
    if (revealFrameRef.current !== null) return;
    revealFrameRef.current = requestAnimationFrame(pass);
  }, [paint, revealPass]);

  const onPostRender = useCallback<FileFindPostRender>(
    (fileContainer, instance, phase) => {
      if (phase === "unmount") {
        painterRef.current.clear();
        if (containerRef.current === fileContainer) {
          containerRef.current = null;
          instanceRef.current = null;
        }
        return;
      }
      containerRef.current = fileContainer;
      instanceRef.current = instance;
      if (revealPass()) scheduleReveal();
      paint(matchesRef.current, activeMatchIndexRef.current);
    },
    [paint, revealPass, scheduleReveal],
  );

  // Matches and the active match also change without a render pass of their own.
  useEffect(() => {
    paint(matches, activeMatchIndex);
  }, [activeMatchIndex, matches, paint]);

  useEffect(() => {
    if (!isOpen || activeMatchIndex === null) return;
    const match = matches[activeMatchIndex];
    if (match === undefined) return;
    revealRef.current = { match, passes: 0 };
    scheduleReveal();
  }, [activeMatchIndex, isOpen, matches, scheduleReveal]);

  /**
   * Which match to land on once the list is rebuilt. Opening find, retyping the
   * query and switching files start from the reader's viewport; a replacement
   * resumes past the text it wrote, so a replacement that still matches the
   * query cannot be replaced over and over.
   */
  const pendingPickRef = useRef<{ kind: "viewport" } | { kind: "offset"; offset: number } | null>(
    null,
  );
  useEffect(() => {
    const pending = pendingPickRef.current;
    if (pending === null || matches.length === 0) return;
    pendingPickRef.current = null;
    setActiveIndex(
      pending.kind === "offset"
        ? firstFileFindIndexFrom(matches, pending.offset)
        : firstFileFindIndexFromLine(matches, firstVisibleLine()),
    );
  }, [firstVisibleLine, matches]);

  const queryRef = useRef(query);
  useEffect(() => {
    if (queryRef.current === query) return;
    queryRef.current = query;
    pendingPickRef.current = { kind: "viewport" };
  }, [query]);

  useEffect(() => {
    pendingPickRef.current = { kind: "viewport" };
  }, [documentKey]);

  useEffect(() => {
    if (isOpen && enabled) return;
    revealRef.current = null;
    painterRef.current.clear();
  }, [enabled, isOpen]);

  useEffect(() => {
    const painter = painterRef.current;
    return () => {
      if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
      painter.clear();
    };
  }, []);

  const open = useCallback(
    (nextMode: FileFindMode) => {
      if (!enabled) return;
      const replace = nextMode === "replace" && allowReplace;
      setIsOpen((wasOpen) => {
        if (!wasOpen) pendingPickRef.current = { kind: "viewport" };
        return true;
      });
      if (replace) setMode("replace");
      setFocus((current) => ({
        field: replace ? "replace" : "find",
        requestId: current.requestId + 1,
      }));
    },
    [allowReplace, enabled],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setMode("find");
    surfaceRef.current?.focus({ preventScroll: true });
  }, [surfaceRef]);

  const openRef = useRef(open);
  openRef.current = open;
  const closeRef = useRef(close);
  closeRef.current = close;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      const root = surfaceRef.current;
      if (root === null || event.isComposing || event.keyCode === 229) return;
      // `document.activeElement` stops at the renderer's shadow host, which is
      // inside the pane, so a caret in the editor still counts as the pane's.
      const activeElement = document.activeElement;
      if (!(activeElement instanceof Node) || !root.contains(activeElement)) return;

      if (isOpenRef.current && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: { fileSurfaceFocus: true },
      });
      if (command !== "file.find" && command !== "file.replace") return;
      event.preventDefault();
      event.stopPropagation();
      openRef.current(command === "file.replace" ? "replace" : "find");
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled, keybindings, surfaceRef]);

  const step = useCallback(
    (delta: number) => {
      setActiveIndex((current) =>
        stepFileFindIndex(
          Math.min(current, Math.max(0, matches.length - 1)),
          matches.length,
          delta,
        ),
      );
    },
    [matches.length],
  );

  const replaceMatches = useCallback(
    (replaced: ReadonlyArray<FileFindMatch>): ReadonlyArray<FileFindReplaceEdit> => {
      if (applyReplace === undefined || replaced.length === 0) return [];
      const edits = replaced.map((match) => ({
        line: match.line,
        column: match.column,
        length: match.end - match.start,
        newText: fileFindReplacement(match, query, replaceQuery, options),
      }));
      applyReplace(edits);
      return edits;
    },
    [applyReplace, options, query, replaceQuery],
  );

  const onReplace = useCallback(() => {
    if (activeMatchIndex === null) return;
    const match = matches[activeMatchIndex];
    if (match === undefined) return;
    const [edit] = replaceMatches([match]);
    if (edit === undefined) return;
    pendingPickRef.current = { kind: "offset", offset: match.start + edit.newText.length };
  }, [activeMatchIndex, matches, replaceMatches]);

  const onReplaceAll = useCallback(() => {
    replaceMatches(matches);
    pendingPickRef.current = { kind: "viewport" };
  }, [matches, replaceMatches]);

  return {
    isOpen,
    open,
    onPostRender,
    bar: {
      open: isOpen && enabled,
      mode: replacing ? "replace" : "find",
      query,
      replaceQuery,
      options,
      matchCount: matches.length,
      activeIndex: activeMatchIndex ?? 0,
      invalidPattern,
      focusField: focus.field,
      focusRequestId: focus.requestId,
      onQueryChange: setQuery,
      onReplaceQueryChange: setReplaceQuery,
      onOptionsChange: setOptions,
      onNext: () => step(1),
      onPrevious: () => step(-1),
      onClose: close,
      ...(replacing ? { onReplace, onReplaceAll } : {}),
    },
  };
}
