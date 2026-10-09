interface FileFindScrollInput {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly viewportHeight: number;
  /** Space the floating find bar covers at the top of the viewport. */
  readonly reservedTop: number;
  /** Top of the match's line, in the scroll container's content coordinates. */
  readonly lineTop: number;
  readonly lineHeight: number;
  /**
   * Where `lineTop` came from. The virtualizer's estimate for an unmounted row
   * can be thousands of pixels out on a wrapped file, so an estimate may never
   * conclude the match is already on screen — that call needs a mounted row.
   */
  readonly measured: "rendered" | "estimated";
}

/**
 * Where to scroll so a match is readable, or null when a measured row says it
 * already is. Leaving a visible match where it is matters more here than
 * centering: stepping through matches on one screen should not make the file
 * jump under the reader.
 */
export function resolveFileFindScrollTop(input: FileFindScrollInput): number | null {
  const maxScrollTop = Math.max(0, input.scrollHeight - input.viewportHeight);
  const visibleTop = input.scrollTop + input.reservedTop;
  const visibleBottom = input.scrollTop + input.viewportHeight;
  if (
    input.measured === "rendered" &&
    input.lineTop >= visibleTop &&
    input.lineTop + input.lineHeight <= visibleBottom
  ) {
    return null;
  }
  const readableHeight = Math.max(0, input.viewportHeight - input.reservedTop - input.lineHeight);
  const target = input.lineTop - input.reservedTop - readableHeight / 2;
  return Math.min(Math.max(0, target), maxScrollTop);
}
