/**
 * Right-click menus for the Source Control rows.
 *
 * The host API gives a native menu inside the desktop app and a DOM fallback in
 * the browser, so a row does not have to care which client it is rendering in.
 * When no host is available the call resolves to null and the row simply has no
 * menu, rather than throwing under the pointer.
 */
import type { ContextMenuItem } from "@t3tools/contracts";
import { useCallback } from "react";

import { readLocalApi } from "~/localApi";

export function useScmContextMenu() {
  return useCallback(
    <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position: { readonly x: number; readonly y: number },
    ): Promise<T | null> => {
      const api = readLocalApi();
      if (!api) return Promise.resolve(null);
      return api.contextMenu.show(items, position);
    },
    [],
  );
}
