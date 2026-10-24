import { useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

export interface DeleteProjectEntryTarget {
  readonly relativePath: string;
  readonly isDirectory: boolean;
}

/** Confirms deleting a workspace file or folder, which bypasses any trash or recycle bin. */
export function DeleteProjectEntryDialog({
  target,
  onClose,
  confirm,
}: {
  /** Null while the dialog is closed. */
  readonly target: DeleteProjectEntryTarget | null;
  readonly onClose: () => void;
  /** Deletes the entry, resolving with a message when it could not. */
  readonly confirm: (target: DeleteProjectEntryTarget) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Outlives `target` so the closing dialog keeps its text.
  const [shown, setShown] = useState<DeleteProjectEntryTarget | null>(null);
  if (target !== null && target !== shown) {
    setShown(target);
    setError(null);
    setPending(false);
  }

  const handleConfirm = async () => {
    if (target === null) return;
    setError(null);
    setPending(true);
    const message = await confirm(target);
    setPending(false);
    if (message !== null) {
      setError(message);
      return;
    }
    onClose();
  };

  const name = shown?.relativePath.split("/").at(-1) ?? "";
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {shown?.isDirectory ? "folder" : "file"} {name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {shown?.isDirectory
              ? `${shown.relativePath} and everything inside it will be permanently deleted.`
              : `${shown?.relativePath ?? ""} will be permanently deleted.`}{" "}
            This skips the trash and cannot be undone here.
          </AlertDialogDescription>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" disabled={pending} />}>
            Cancel
          </AlertDialogClose>
          <Button variant="destructive" disabled={pending} onClick={() => void handleConfirm()}>
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
