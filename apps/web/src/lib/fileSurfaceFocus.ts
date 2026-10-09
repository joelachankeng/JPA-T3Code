export const FILE_SURFACE_FOCUS_ATTRIBUTE = "data-file-surface";

/**
 * Whether the keyboard belongs to a file surface's preview pane, so the global
 * handler leaves `mod+f` and `mod+h` to find and replace in the file instead of
 * claiming them for thread find.
 *
 * The explorer aside is deliberately outside the marked pane: it has its own
 * always-visible name filter, so find from the tree stays thread find. Focus
 * inside the renderer's shadow root counts, because `document.activeElement`
 * stops at the shadow host and the host sits inside the pane.
 */
export function isFileSurfaceFocused(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  if (!activeElement.isConnected) return false;
  return activeElement.closest(`[${FILE_SURFACE_FOCUS_ATTRIBUTE}]`) !== null;
}
