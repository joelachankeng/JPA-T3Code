import { useEffect, useRef } from "react";

/** Whether a pending `file:<path>` tab id is the entry at `relativePath` or inside it. */
export function hasPendingSaveUnder(
  pendingFileSurfaceIds: ReadonlySet<string>,
  relativePath: string,
): boolean {
  const fileId = `file:${relativePath}`;
  for (const id of pendingFileSurfaceIds) {
    if (id === fileId || id.startsWith(`${fileId}/`)) return true;
  }
  return false;
}

const PENDING_SAVE_TIMEOUT_MS = 5_000;

/**
 * An editor writes its unsaved text to the path it opened, even after that path
 * is renamed or deleted, which would bring the old file back. Moving or removing
 * an entry therefore waits for the edits under it to land first.
 */
export function usePendingFileSaves(pendingFileSurfaceIds: ReadonlySet<string>) {
  const pendingRef = useRef(pendingFileSurfaceIds);
  const listenersRef = useRef(new Set<() => void>());
  useEffect(() => {
    pendingRef.current = pendingFileSurfaceIds;
    for (const listener of listenersRef.current) listener();
  }, [pendingFileSurfaceIds]);

  /** Resolves false when the edits are still unsaved after a few seconds. */
  return (relativePath: string) =>
    new Promise<boolean>((resolve) => {
      const finish = (saved: boolean) => {
        clearTimeout(timer);
        listenersRef.current.delete(check);
        resolve(saved);
      };
      const check = () => {
        if (!hasPendingSaveUnder(pendingRef.current, relativePath)) finish(true);
      };
      const timer = setTimeout(() => finish(false), PENDING_SAVE_TIMEOUT_MS);
      listenersRef.current.add(check);
      check();
    });
}
