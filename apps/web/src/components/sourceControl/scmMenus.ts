/**
 * The right-click menu for a changed file, laid out as VS Code lays it out.
 *
 * VS Code builds this menu from two contributors — its own git extension and
 * GitLens — whose items differ by group: Changes, Staged Changes and Merge
 * Changes each get a different set. This mirrors those definitions, then
 * drops the items that could only fail for this file: opening a deleted file,
 * reading HEAD for a file HEAD never had, or linking to a remote that has
 * never seen it. "Open Timeline" is T3 Code's addition, placed beside File
 * History as the Explorer places it.
 */
import type { ContextMenuItem, ScmFileEntry } from "@t3tools/contracts";

import { canOpenFile, headPathOf } from "./sourceControlPanel.logic";

export type ScmFileMenuGroup = "merge" | "staged" | "changes";

export type ScmFileMenuId =
  | "open-changes"
  | "open-changes-with"
  | "compare-revision"
  | "compare-ref"
  | "open-file"
  | "open-head"
  | "open-on-remote"
  | "remote-open"
  | "remote-open-from"
  | "file-history"
  | "history"
  | "history-graph"
  | "history-visual"
  | "history-quick"
  | "open-timeline"
  | "discard"
  | "stage"
  | "unstage"
  | "stash"
  | "gitignore"
  | "accept-ours"
  | "accept-theirs"
  | "reveal-os"
  | "reveal-files"
  | "share"
  | "remote-copy"
  | "remote-copy-from"
  | "copy-patch"
  | "copy-path";

type Item = ContextMenuItem<ScmFileMenuId>;

/** Mark the first item of each block so the blocks read as VS Code's groups. */
function blocks(...groups: ReadonlyArray<ReadonlyArray<Item>>): Item[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      group.map((item, position) =>
        index > 0 && position === 0 ? { ...item, separatorBefore: true } : item,
      ),
    );
}

export function fileMenuItems(input: {
  readonly group: ScmFileMenuGroup;
  readonly entry: Pick<ScmFileEntry, "path" | "previousPath" | "index" | "worktree">;
  /** The repository has a remote whose web address can be worked out. */
  readonly hasRemote: boolean;
  /** Platform wording such as "Reveal in File Explorer", or null when the host cannot reveal. */
  readonly revealInFileManagerLabel: string | null;
}): Item[] {
  const { group, entry } = input;
  const onDisk = canOpenFile(entry);
  const inHead = headPathOf(entry) !== null;
  // A file the host has never had has no page to open or link to.
  const onRemote = input.hasRemote && inHead;

  const openChangesWith: Item = {
    id: "open-changes-with",
    label: "Open Changes with",
    children: [
      { id: "compare-revision", label: "Open Changes with Revision…" },
      { id: "compare-ref", label: "Open Changes with Branch or Tag…" },
    ],
  };
  const openOnRemote: Item = {
    id: "open-on-remote",
    label: "Open on Remote (Web)",
    children: [
      { id: "remote-open", label: "Open File on Remote" },
      { id: "remote-open-from", label: "Open File on Remote From…" },
    ],
  };
  const navigation: Item[] =
    group === "merge"
      ? [
          openChangesWith,
          ...(onDisk ? [{ id: "open-file", label: "Open File" } as const] : []),
          ...(onRemote ? [openOnRemote] : []),
        ]
      : [
          { id: "open-changes", label: "Open Changes" },
          openChangesWith,
          ...(onDisk ? [{ id: "open-file", label: "Open File" } as const] : []),
          ...(inHead ? [{ id: "open-head", label: "Open File (HEAD)" } as const] : []),
          ...(onRemote ? [openOnRemote] : []),
        ];

  const history: Item[] = [
    {
      id: "file-history",
      label: "File History",
      children: [
        { id: "history", label: "Open File History" },
        { id: "history-graph", label: "Open File History in Commit Graph" },
        { id: "history-visual", label: "Open Visual File History" },
        { id: "history-quick", label: "Quick Open File History", separatorBefore: true },
      ],
    },
    { id: "open-timeline", label: "Open Timeline", icon: "clock" },
  ];

  const modification: Item[] =
    group === "staged"
      ? [
          { id: "unstage", label: "Unstage Changes" },
          { id: "stash", label: "Stash Changes…" },
        ]
      : group === "merge"
        ? [
            { id: "accept-ours", label: "Accept Current Change" },
            { id: "accept-theirs", label: "Accept Incoming Change" },
            { id: "stage", label: "Stage Changes" },
          ]
        : [
            { id: "discard", label: "Discard Changes" },
            { id: "stage", label: "Stage Changes" },
            { id: "stash", label: "Stash Changes…" },
            { id: "gitignore", label: "Add to .gitignore" },
          ];

  const view: Item[] = [
    ...(input.revealInFileManagerLabel && onDisk
      ? [{ id: "reveal-os", label: input.revealInFileManagerLabel } as const]
      : []),
    ...(onDisk ? [{ id: "reveal-files", label: "Reveal in Explorer View" } as const] : []),
  ];

  const share: Item[] = onRemote
    ? [
        {
          id: "share",
          label: "Share",
          children: [
            { id: "remote-copy", label: "Copy Remote File URL" },
            { id: "remote-copy-from", label: "Copy Remote File URL From…" },
          ],
        },
      ]
    : [];

  const copy: Item[] =
    group === "merge"
      ? [{ id: "copy-path", label: "Copy Relative Path" }]
      : [
          { id: "copy-patch", label: "Copy Changes (Patch)" },
          { id: "copy-path", label: "Copy Relative Path" },
        ];

  return blocks(navigation, history, modification, view, share, copy);
}

/** Every id a menu offers, submenus included, for checking what a file is offered. */
export function menuIds(items: ReadonlyArray<ContextMenuItem<ScmFileMenuId>>): ScmFileMenuId[] {
  return items.flatMap((item) => [item.id, ...menuIds(item.children ?? [])]);
}
