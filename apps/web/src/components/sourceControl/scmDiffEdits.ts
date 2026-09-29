/**
 * Whether a source control diff is holding edits nobody has written yet.
 *
 * The panel owns the editor, but the control that closes the panel lives in
 * the chat view, so the two meet here rather than threading a flag up through
 * the right panel's surface plumbing. The panel clears this when the edits are
 * saved, cleared, or the diff is closed.
 */
const UNSAVED_SCM_DIFF_MESSAGE = "Discard your unsaved changes to this file?";

let unsaved = false;

export function setScmDiffUnsaved(value: boolean): void {
  unsaved = value;
}

export function hasScmDiffUnsaved(): boolean {
  return unsaved;
}

/**
 * The prompt shown before an action that would throw the edits away, or null
 * when there is nothing to lose and the action should just happen.
 */
export function scmDiffDiscardPrompt(): string | null {
  return unsaved ? UNSAVED_SCM_DIFF_MESSAGE : null;
}
