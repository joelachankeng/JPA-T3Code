import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

import { resolveNewProjectFilePath } from "./newProjectFile";

export type ProjectFilePathDialogTarget =
  /** `directoryPath` is the folder the path starts out in; an empty string is the project root. */
  | { readonly kind: "create"; readonly directoryPath: string }
  | { readonly kind: "rename"; readonly relativePath: string; readonly isDirectory: boolean };

interface ProjectFilePathDialogProps {
  /** Null while the dialog is closed. */
  readonly target: ProjectFilePathDialogTarget | null;
  readonly projectName: string;
  readonly onClose: () => void;
  /** Creates or renames the file, resolving with a message when it could not. */
  readonly submit: (
    target: ProjectFilePathDialogTarget,
    relativePath: string,
  ) => Promise<string | null>;
}

/** The text the field opens with, and the part of it the caret selects. */
function initialField(target: ProjectFilePathDialogTarget) {
  if (target.kind === "create") {
    const value = target.directoryPath ? `${target.directoryPath}/` : "";
    // The folder is a prefix, so the caret belongs after it rather than over it.
    return { value, selection: [value.length, value.length] as const };
  }
  // Select the name without its extension, as file managers do on rename.
  const value = target.relativePath;
  const nameStart = value.lastIndexOf("/") + 1;
  const extensionStart = target.isDirectory ? -1 : value.lastIndexOf(".");
  const nameEnd = extensionStart > nameStart ? extensionStart : value.length;
  return { value, selection: [nameStart, nameEnd] as const };
}

/**
 * Names a workspace file to create or rename. The whole field is the
 * project-relative path, so the folder it opens with can be edited away or
 * extended, and folders that do not exist yet are created.
 */
export function ProjectFilePathDialog({
  target,
  projectName,
  onClose,
  submit,
}: ProjectFilePathDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Outlives `target` so the closing dialog keeps its title and text.
  const [openedFor, setOpenedFor] = useState<ProjectFilePathDialogTarget | null>(null);
  if (target !== null && target !== openedFor) {
    setOpenedFor(target);
    setValue(initialField(target).value);
    setDirty(false);
    setSubmitError(null);
    setPending(false);
  }

  useEffect(() => {
    if (target === null) return;
    const { selection } = initialField(target);
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(...selection);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  const resolved = resolveNewProjectFilePath(value);
  const handleSubmit = async () => {
    setDirty(true);
    if (target === null || "error" in resolved) return;
    if (target.kind === "rename" && resolved.relativePath === target.relativePath) {
      onClose();
      return;
    }
    if (
      target.kind === "rename" &&
      target.isDirectory &&
      resolved.relativePath.startsWith(`${target.relativePath}/`)
    ) {
      setSubmitError("A folder cannot be moved inside itself.");
      return;
    }
    setSubmitError(null);
    setPending(true);
    const error = await submit(target, resolved.relativePath);
    setPending(false);
    if (error !== null) {
      setSubmitError(error);
      return;
    }
    onClose();
  };

  const renaming = openedFor?.kind === "rename";
  const noun = openedFor?.kind === "rename" && openedFor.isDirectory ? "folder" : "file";
  const message = (dirty && "error" in resolved ? resolved.error : null) ?? submitError;
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{renaming ? `Rename ${noun}` : "New file"}</DialogTitle>
          <DialogDescription>
            {renaming ? `Renames or moves the ${noun} within` : "Creates an empty file in"}{" "}
            {projectName}
            {renaming ? "." : " and opens it."} Folders in the path are created as needed.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Input
            ref={inputRef}
            aria-label={renaming ? `Renamed ${noun} path` : "New file path"}
            placeholder="notes.md"
            font="mono"
            aria-invalid={message !== null}
            spellCheck={false}
            autoComplete="off"
            value={value}
            disabled={pending}
            onChange={(event) => {
              setDirty(true);
              setSubmitError(null);
              setValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void handleSubmit();
            }}
          />
          {message ? <p className="text-destructive text-xs">{message}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || "error" in resolved}
            onClick={() => void handleSubmit()}
          >
            {pending ? (renaming ? "Renaming…" : "Creating…") : renaming ? "Rename" : "Create"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
