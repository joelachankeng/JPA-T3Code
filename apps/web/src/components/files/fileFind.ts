/**
 * Matching for find and replace on a file surface. Matching is per line, so a
 * match never spans a newline: the renderer paints one row per line, `^` and
 * `$` anchor where a reader expects them, and `.` cannot run away over the
 * whole document.
 */

export interface FileFindOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

export const DEFAULT_FILE_FIND_OPTIONS: FileFindOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export interface FileFindMatch {
  /** Document offset of the first matched character. */
  readonly start: number;
  /** Document offset one past the last matched character. */
  readonly end: number;
  /** One-based line, as the renderer numbers rows. */
  readonly line: number;
  /** Offset of the match within its line. */
  readonly column: number;
  readonly text: string;
}

/**
 * Enough to navigate a pathological query without freezing the surface. A
 * reader who needs more than this is refining the query, not reading matches.
 */
export const MAX_FILE_FIND_MATCHES = 10_000;

const WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

function isSeparator(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return true;
  const code = text.charCodeAt(index);
  return code <= 32 || code === 127 || WORD_SEPARATORS.includes(text[index] ?? "");
}

/** Whether a match sits on word boundaries, for the whole-word toggle. */
export function isWholeWord(text: string, start: number, length: number): boolean {
  return isSeparator(text, start - 1) && isSeparator(text, start + length);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The compiled query, or null when it cannot match anything: an empty query, or
 * a regular expression the reader is still halfway through typing.
 */
export function compileFileFindPattern(query: string, options: FileFindOptions): RegExp | null {
  if (query === "") return null;
  const flags = options.caseSensitive ? "g" : "gi";
  try {
    return new RegExp(options.regex ? query : escapeRegExp(query), flags);
  } catch {
    return null;
  }
}

function lineLengthWithoutBreak(text: string, start: number, end: number): number {
  let lineEnd = end;
  if (lineEnd > start && text[lineEnd - 1] === "\n") lineEnd -= 1;
  if (lineEnd > start && text[lineEnd - 1] === "\r") lineEnd -= 1;
  return lineEnd - start;
}

export function findFileMatches(
  text: string,
  query: string,
  options: FileFindOptions,
): ReadonlyArray<FileFindMatch> {
  const pattern = compileFileFindPattern(query, options);
  if (pattern === null) return [];

  const matches: FileFindMatch[] = [];
  let lineStart = 0;
  let line = 1;
  while (lineStart <= text.length) {
    const lineBreak = text.indexOf("\n", lineStart);
    const lineEnd = lineBreak === -1 ? text.length : lineBreak + 1;
    const lineText = text.slice(
      lineStart,
      lineStart + lineLengthWithoutBreak(text, lineStart, lineEnd),
    );

    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(lineText)) !== null) {
      const length = match[0].length;
      // A zero-length match (`a*`, `^`) has nothing to show or replace.
      if (length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      if (!options.wholeWord || isWholeWord(lineText, match.index, length)) {
        matches.push({
          start: lineStart + match.index,
          end: lineStart + match.index + length,
          line,
          column: match.index,
          text: match[0],
        });
        if (matches.length >= MAX_FILE_FIND_MATCHES) return matches;
      }
    }

    if (lineBreak === -1) break;
    lineStart = lineEnd;
    line += 1;
  }
  return matches;
}

/**
 * What replacing one match writes. A literal query inserts the replacement
 * verbatim; a regular expression runs it through `String.replace`, so `$1` and
 * `$&` mean what they mean everywhere else.
 */
export function fileFindReplacement(
  match: FileFindMatch,
  query: string,
  replaceWith: string,
  options: FileFindOptions,
): string {
  if (!options.regex) return replaceWith;
  const pattern = compileFileFindPattern(query, options);
  if (pattern === null) return replaceWith;
  return match.text.replace(
    new RegExp(pattern.source, pattern.flags.replace("g", "")),
    replaceWith,
  );
}

function clampFileFindIndex(index: number, total: number): number {
  if (total <= 0 || !Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.trunc(index), total - 1);
}

export function stepFileFindIndex(index: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  const clamped = clampFileFindIndex(index, total);
  return (((clamped + delta) % total) + total) % total;
}

export function formatFileFindCount(index: number, total: number): string {
  if (total <= 0) return "0/0";
  const suffix = total >= MAX_FILE_FIND_MATCHES ? "+" : "";
  return `${clampFileFindIndex(index, total) + 1}/${total}${suffix}`;
}

/** The first match at or after a document offset, wrapping to the top. */
export function firstFileFindIndexFrom(
  matches: ReadonlyArray<FileFindMatch>,
  offset: number,
): number {
  const index = matches.findIndex((match) => match.start >= offset);
  return index === -1 ? 0 : index;
}

/**
 * The match a fresh query lands on: the first one at or after the top of the
 * viewport, so searching does not throw the reader back to the top of the file.
 */
export function firstFileFindIndexFromLine(
  matches: ReadonlyArray<FileFindMatch>,
  line: number,
): number {
  const index = matches.findIndex((match) => match.line >= line);
  return index === -1 ? 0 : index;
}
