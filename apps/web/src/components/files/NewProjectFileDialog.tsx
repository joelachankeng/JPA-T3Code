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

interface NewProjectFileDialogProps {
  readonly open: boolean;
  readonly projectName: string;
  /** Folder the path starts out in; an empty string is the project root. */
  readonly directoryPath: string;
  readonly onOpenChange: (open: boolean) => void;
  /** Writes the empty file, resolving with a message when it could not be created. */
  readonly create: (relativePath: string) => Promise<string | null>;
}

/**
 * Names a new workspace file. The whole field is the project-relative path, so
 * the folder it opens with can be edited away or extended, and folders that do
 * not exist yet are created by the write.
 */
export function NewProjectFileDialog({
  open,
  projectName,
  directoryPath,
  onOpenChange,
  create,
}: NewProjectFileDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial = directoryPath ? `${directoryPath}/` : "";
    setValue(initial);
    setDirty(false);
    setSubmitError(null);
    setPending(false);
    // The folder is a prefix, so the caret belongs after it rather than over it.
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(initial.length, initial.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [directoryPath, open]);

  const resolved = resolveNewProjectFilePath(value);
  const submit = async () => {
    setDirty(true);
    if ("error" in resolved) return;
    setSubmitError(null);
    setPending(true);
    const error = await create(resolved.relativePath);
    setPending(false);
    if (error !== null) {
      setSubmitError(error);
      return;
    }
    onOpenChange(false);
  };

  const message = (dirty && "error" in resolved ? resolved.error : null) ?? submitError;
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>New file</DialogTitle>
          <DialogDescription>
            Creates an empty file in {projectName} and opens it. Folders in the path are created as
            needed.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Input
            ref={inputRef}
            aria-label="New file path"
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
              void submit();
            }}
          />
          {message ? <p className="text-destructive text-xs">{message}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || "error" in resolved}
            onClick={() => void submit()}
          >
            {pending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
