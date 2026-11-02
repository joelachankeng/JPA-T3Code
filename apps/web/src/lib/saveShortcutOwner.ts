/**
 * Whether a key event started inside a region marked `data-owns-save-shortcut`: an editor that
 * saves on Mod+S, where app-wide shortcuts on that chord stand aside.
 */
export function isInSaveShortcutOwner(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-owns-save-shortcut]") !== null;
}
