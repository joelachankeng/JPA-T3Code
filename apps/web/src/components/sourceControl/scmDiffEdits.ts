// Whether a source control diff holds unsaved edits. The panel owns the editor but
// the chat view owns the close control, so they meet here instead of threading a
// flag through the right panel. The panel clears it on save, clear, or close.
const UNSAVED_SCM_DIFF_MESSAGE = "Discard your unsaved changes to this file?";

let unsaved = false;

export function setScmDiffUnsaved(value: boolean): void {
  unsaved = value;
}

/**
 * The prompt shown before an action that would throw the edits away, or null
 * when there is nothing to lose and the action should just happen.
 */
export function scmDiffDiscardPrompt(): string | null {
  return unsaved ? UNSAVED_SCM_DIFF_MESSAGE : null;
}
