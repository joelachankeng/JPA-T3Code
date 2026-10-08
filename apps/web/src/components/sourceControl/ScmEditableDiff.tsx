/**
 * The diff, with its working tree side open for typing.
 *
 * Only a diff that ends at the working tree can be edited, because that is the
 * only side backed by a file on disk; anything ending at the index or at a
 * commit renders read-only. Edits are held until they are saved, so the
 * header's save and clear controls, not the keystrokes, decide what reaches
 * the file.
 */
import { Editor } from "@pierre/diffs/edit";
import type { EditorFactory, EditorOptions } from "@pierre/diffs/edit";
import { EditProvider, FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { FileDiffEditChangeHandler } from "@pierre/diffs/react";
import type { FileDiffContentsLoader, FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveFileDiffPath } from "~/lib/diffRendering";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

/** Distinguishes one edit session's document from the next one's. */
let sessionCount = 0;

/** The provider only supplies the constructor; the diff carries the options. */
const createScmEditor: EditorFactory<undefined, undefined> = (editorType, options, editStateKey) =>
  new Editor(editorType, options, editStateKey);

/** Where an edit lands, and the two sides the editor opens against. */
export type ScmEditTarget = {
  readonly environmentId: EnvironmentId;
  /** The project directory the write is relative to. */
  readonly cwd: string;
  readonly relativePath: string;
  readonly oldContents: string;
  readonly newContents: string;
};

/** Lets the panel header drive the editor it does not own. */
export type ScmEditSession = {
  /** Writes the buffer. Resolves false when the write failed. */
  readonly save: () => Promise<boolean>;
  /** Puts the text back to what was last written to the file. */
  readonly revert: () => void;
};

type ScmEditableDiffProps = {
  readonly files: ReadonlyArray<FileDiffMetadata>;
  readonly options: FileDiffOptions<undefined, undefined>;
  readonly target: ScmEditTarget;
  /** Fires only when the buffer crosses between matching the file and not. */
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onSession: (session: ScmEditSession | null) => void;
  readonly onSavingChange: (saving: boolean) => void;
};

export function ScmEditableDiff({
  files,
  options,
  target,
  onDirtyChange,
  onSession,
  onSavingChange,
}: ScmEditableDiffProps) {
  // Everything the renderer opens against is taken once, on mount. Saving
  // re-reads the diff, and handing Pierre fresh hunks or text mid-session
  // tears that session down and drops the caret. The caller remounts this with
  // a new key when a genuinely different document should be opened, which is
  // also how clearing restores the text below.
  const [opened] = useState(() => ({
    files,
    oldFile: { name: target.relativePath, contents: target.oldContents },
    newFile: {
      name: target.relativePath,
      contents: target.newContents,
      // The cacheKey identifies the document Pierre keeps across renders, and
      // it carries the session count because a key reused after a remount
      // hands the previous document back. Discarding depends on that not
      // happening: it reopens the file and would otherwise restore the very
      // edits it was asked to throw away.
      cacheKey: `scm-edit:${target.environmentId}:${target.cwd}:${target.relativePath}:${(sessionCount += 1)}`,
    },
  }));

  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // The text the editor is holding is kept beside it. Only saving reads that
  // text, so it stays off React state: re-rendering the panel on every
  // keystroke would repaint the whole diff.
  //
  // `saved` is what the file last held, and moves forward on every write, so
  // saving can settle the dirty flag without rebuilding the editor and taking
  // the caret with it. `editor` is filled in when the session attaches, which
  // is the only handle reverting has on the live document.
  const [session] = useState(() => ({
    buffer: { contents: opened.newFile.contents, saved: opened.newFile.contents },
    editor: null as Editor<"file-diff", undefined, undefined> | null,
  }));

  const editorOptions = useMemo<EditorOptions<"file-diff", undefined, undefined>>(
    () => ({
      onAttach: (editor) => {
        session.editor = editor;
      },
    }),
    [session],
  );

  const onEditChange = useCallback<FileDiffEditChangeHandler<undefined, undefined>>(
    (event) => {
      session.buffer.contents = event.file.contents;
      setDirty(event.file.contents !== session.buffer.saved);
    },
    [session],
  );

  const writeFile = useAtomCommand(projectEnvironment.writeFile);
  const { environmentId, cwd, relativePath } = target;
  const save = async () => {
    onSavingChange(true);
    const written = session.buffer.contents;
    try {
      const result = await writeFile({
        environmentId,
        input: { cwd, relativePath, contents: written },
      });
      if (result._tag !== "Success") return false;
      session.buffer.saved = written;
      // Anything typed while the write was in flight still counts as unsaved.
      setDirty(session.buffer.contents !== written);
      return true;
    } finally {
      onSavingChange(false);
    }
  };

  // Reverting goes through the editor rather than by rebuilding it: the
  // renderer hands a recycled instance its previous document back, so a
  // remount would restore the very edits being thrown away. Replacing the
  // whole range also leaves the change on the undo timeline.
  const revert = useCallback(() => {
    const editor = session.editor;
    if (!editor) return;
    const current = editor.getText();
    const target = session.buffer.saved;
    if (current === target) return;
    const lines = current.split("\n");
    editor.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: lines.length - 1, character: (lines[lines.length - 1] ?? "").length },
        },
        newText: target,
      },
    ]);
  }, [session]);

  useEffect(() => {
    onSession({ save, revert });
    return () => onSession(null);
  }, [onSession, revert, save]);

  // Editing needs both whole files, not just the hunks the patch carries.
  const loadDiffFiles = useMemo<FileDiffContentsLoader>(
    () => async () => ({ oldFile: opened.oldFile, newFile: opened.newFile }),
    [opened],
  );
  const editableOptions = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({ ...options, loadDiffFiles }),
    [options, loadDiffFiles],
  );

  return (
    <EditProvider createEditor={createScmEditor}>
      {opened.files.map((fileDiff) => (
        <PierreFileDiff
          key={resolveFileDiffPath(fileDiff)}
          fileDiff={fileDiff}
          options={editableOptions}
          editorOptions={editorOptions}
          // Retains this draft and its undo history. The key carries the
          // session count, so a remount opens a fresh one and discarding does
          // not hand back the edits it was asked to throw away.
          editStateKey={opened.newFile.cacheKey}
          edit
          onEditChange={onEditChange}
        />
      ))}
    </EditProvider>
  );
}
