import { PROJECT_WRITE_FILE_PATH_MAX_LENGTH, type ProjectEntry } from "@t3tools/contracts";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";

/**
 * Where a new file starts out: beside the entry the tree has selected, so
 * creating one while reading `docs/guide.md` offers `docs/`. The project root
 * is the fallback, and is what an empty return means.
 */
export function newProjectFileDirectory(
  selectedPath: string | null,
  kinds: ReadonlyMap<string, ProjectEntry["kind"]>,
): string {
  if (!selectedPath) return "";
  if (kinds.get(selectedPath) === "directory") return selectedPath;
  const separatorIndex = selectedPath.lastIndexOf("/");
  return separatorIndex === -1 ? "" : selectedPath.slice(0, separatorIndex);
}

export type NewProjectFilePath = { readonly relativePath: string } | { readonly error: string };

/**
 * Turns what the New file dialog accepts into a path the write RPC takes.
 * Backslashes are folded so a path copied from a Windows shell still lands in
 * the right folder; absolute paths and traversal are refused because the write
 * resolves inside the project root only.
 */
export function resolveNewProjectFilePath(input: string): NewProjectFilePath {
  const trimmed = input.trim();
  const normalized = trimmed.replaceAll("\\", "/");
  if (normalized === "") return { error: "Enter a file name." };
  if (normalized.endsWith("/")) return { error: "Enter a file name, not a folder." };
  const segments = normalized.split("/").filter((segment) => segment !== "");
  if (
    normalized.startsWith("/") ||
    isWindowsAbsolutePath(trimmed) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return { error: "Enter a path inside the project." };
  }
  const relativePath = segments.join("/");
  if (relativePath.length > PROJECT_WRITE_FILE_PATH_MAX_LENGTH) {
    return { error: "That path is too long." };
  }
  return { relativePath };
}
