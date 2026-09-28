/**
 * The diff, with its working tree side open for typing.
 *
 * Only a diff that ends at the working tree can be edited, because that is the
 * only side backed by a file on disk; anything ending at the index or at a
 * commit renders read-only. Keystrokes go through the same debounced write the
 * Files surface uses, so a file open in both places agrees about what landed.
 */
import { Editor } from "@pierre/diffs/editor";
import { EditProvider, FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { FileDiffContentsLoader, FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useFileSaveCoordinator } from "~/components/files/useFileSaveCoordinator";
import { resolveFileDiffPath } from "~/lib/diffRendering";

/** Where an edit lands, and the two sides the editor opens against. */
export type ScmEditTarget = {
  readonly environmentId: EnvironmentId;
  /** The project directory the write is relative to. */
  readonly cwd: string;
  readonly relativePath: string;
  readonly oldContents: string;
  readonly newContents: string;
};

type ScmEditableDiffProps = {
  readonly files: ReadonlyArray<FileDiffMetadata>;
  readonly options: FileDiffOptions<undefined>;
  readonly target: ScmEditTarget;
  /** Reports whether a write is still in flight, for the header's saving mark. */
  readonly onPendingChange: (pending: boolean) => void;
};

export function ScmEditableDiff({ files, options, target, onPendingChange }: ScmEditableDiffProps) {
  // Everything the renderer opens against is taken once, on mount. Saving
  // re-reads the diff, and handing Pierre fresh hunks or text mid-session
  // tears that session down and drops the caret. The caller remounts this with
  // a new key when the file or the whitespace setting changes, which is when a
  // genuinely different document should be opened.
  const [opened] = useState(() => ({
    files,
    oldFile: { name: target.relativePath, contents: target.oldContents },
    newFile: {
      name: target.relativePath,
      contents: target.newContents,
      // An editable file needs a stable cacheKey: it identifies the document
      // Pierre keeps across renders.
      cacheKey: `scm-edit:${target.environmentId}:${target.cwd}:${target.relativePath}`,
    },
  }));

  const reportPending = useCallback(
    (_path: string, pending: boolean) => onPendingChange(pending),
    [onPendingChange],
  );
  const saveCoordinator = useFileSaveCoordinator({
    environmentId: target.environmentId,
    cwd: target.cwd,
    relativePath: target.relativePath,
    onPendingChange: reportPending,
  });

  // The coordinator only changes when the file being edited does, so the
  // editor survives typing and is rebuilt when a different file opens.
  const editor = useMemo(
    () =>
      new Editor({
        persistState: true,
        persistStateStorage: "inMemory",
        onChange: (file) => saveCoordinator.change(file.contents),
      }),
    [saveCoordinator],
  );
  useEffect(() => () => editor.cleanUp(), [editor]);

  // Editing needs both whole files, not just the hunks the patch carries.
  const loadDiffFiles = useMemo<FileDiffContentsLoader>(
    () => async () => ({ oldFile: opened.oldFile, newFile: opened.newFile }),
    [opened],
  );
  const editableOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({ ...options, loadDiffFiles }),
    [options, loadDiffFiles],
  );

  return (
    <EditProvider editor={editor}>
      {opened.files.map((fileDiff) => (
        <PierreFileDiff
          key={resolveFileDiffPath(fileDiff)}
          fileDiff={fileDiff}
          options={editableOptions}
          contentEditable
        />
      ))}
    </EditProvider>
  );
}
