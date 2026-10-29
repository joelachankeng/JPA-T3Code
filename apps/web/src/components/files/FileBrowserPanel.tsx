import { RefreshIcon } from "~/components/ui/refresh-icon";
import type {
  ContextMenuItem as TreeContextMenuItem,
  ContextMenuOpenContext as TreeContextMenuOpenContext,
} from "@pierre/trees";
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { FileTree, useFileTree, useFileTreeSearch, useFileTreeSelector } from "@pierre/trees/react";
import { executeAtomQuery, settlePromise } from "@t3tools/client-runtime/state/runtime";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Cause from "effect/Cause";
import { FilePlusIcon } from "lucide-react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import { MorphIcon } from "~/components/MorphIcon";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useComposerHandleContext } from "~/composerHandleContext";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useTheme } from "~/hooks/useTheme";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import {
  resolveFileContextMenuAbsolutePath,
  useFileContextMenu,
  type FileContextMenuAction,
} from "~/fileContextMenu";
import { readLocalApi } from "~/localApi";
import { T3_PIERRE_ICONS } from "~/pierre-icons";
import { PIERRE_TREE_UNSAFE_CSS, pierreTreeStyle } from "~/pierre-tree-theme";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import { joinHostPath } from "./filePath";
import { createFileTreeDragMentionController } from "./fileTreeDragMention";
import { areAllDirectoriesExpanded, setAllDirectoriesExpanded } from "./fileTreeExpansion";
import { buildFileTreePathUpdates } from "./fileTreePathReconciliation";
import { loadFileAncestors } from "./loadFileAncestors";
import { newProjectFileDirectory } from "./newProjectFile";
import {
  DeleteProjectEntryDialog,
  type DeleteProjectEntryTarget,
} from "./DeleteProjectEntryDialog";
import { ProjectFilePathDialog, type ProjectFilePathDialogTarget } from "./ProjectFilePathDialog";
import { usePendingFileSaves } from "./usePendingFileSaves";
import { useDirectoryEntries } from "./useDirectoryEntries";
import { useProjectPathSearch } from "~/state/queries";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  selectedPath: string | null;
  selectedPathRevealId: number;
  onOpenFile: (relativePath: string) => void;
  /** Opens the file's commit history as its own surface, as VS Code's Open Timeline does. */
  onOpenTimeline: (relativePath: string) => void;
  onPathRenamed: (fromPath: string, toPath: string) => void;
  onPathDeleted: (relativePath: string) => void;
  /** Tabs whose edits have not been saved yet, as `file:<path>` ids. */
  pendingFileSurfaceIds: ReadonlySet<string>;
  /** Host-folder entries use absolute paths. Avoid full traversal: disable expand-all and search only
   * loaded folders. */
  hostFolder?: boolean;
  onRefreshSelectedFile?: () => void;
  workspaceMutationId: string | null;
}

function treePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

/** Copies one context-menu value; a toast is the menu's only feedback. */
async function copyMenuValue(input: { value: string; label: string; description: string }) {
  try {
    await writeTextToClipboard(input.value);
    toastManager.add({
      type: "success",
      title: `${input.label} copied`,
      description: input.description,
    });
  } catch (error) {
    toastManager.add({
      type: "error",
      title: `Failed to copy ${input.label.toLowerCase()}`,
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
}

function NewFileButton(props: { onPress: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="New file"
            onClick={props.onPress}
          />
        }
      >
        <FilePlusIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup>New file</TooltipPopup>
    </Tooltip>
  );
}

function RefreshFilesButton(props: { isPending: boolean; onRefresh: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh workspace files"
            onClick={props.onRefresh}
          />
        }
      >
        <RefreshIcon refreshing={props.isPending} />
      </TooltipTrigger>
      <TooltipPopup>{props.isPending ? "Refreshing…" : "Refresh files"}</TooltipPopup>
    </Tooltip>
  );
}

function FileSearchField(props: {
  ariaLabel: string;
  name: string;
  onClose: () => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <InputGroup variant="ghost" className="h-7 min-w-0 flex-1">
      <InputGroupInput
        type="search"
        name={props.name}
        size="sm"
        value={props.value}
        aria-label={props.ariaLabel}
        placeholder="Search files"
        data-workspace-focus-default
        spellCheck={false}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          props.onClose();
          event.currentTarget.blur();
        }}
      />
    </InputGroup>
  );
}

function buildTreeEntries(
  directoryEntries: readonly ProjectEntry[],
  searchEntries: readonly ProjectEntry[],
  searchPending: boolean,
  query: string,
) {
  const result = new Map(directoryEntries.map((entry) => [entry.path, entry]));
  if (query.trim() && !searchPending) {
    for (const entry of searchEntries) {
      if (!result.has(entry.path)) result.set(entry.path, entry);
      const segments = entry.path.split("/");
      for (let index = 1; index < segments.length; index++) {
        const path = segments.slice(0, index).join("/");
        if (!result.has(path)) result.set(path, { path, kind: "directory" });
      }
    }
  }
  const entries = [...result.values()];
  const entryKinds: ReadonlyMap<string, ProjectEntry["kind"]> = new Map(
    entries.map((entry) => [entry.path, entry.kind] as const),
  );
  const treePaths = entries.map(treePath);
  const directories = entries.filter((entry) => entry.kind === "directory");
  const directoryPaths = directories.map(treePath);
  // Expanding a folder lists it, and an ignored one such as `node_modules` can hold tens of
  // thousands, so expand all skips ignored folders. They still open by hand.
  const expandableDirectoryPaths = directories.filter((entry) => !entry.ignored).map(treePath);
  return { entries, entryKinds, treePaths, directoryPaths, expandableDirectoryPaths };
}

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  selectedPath,
  selectedPathRevealId,
  onOpenFile,
  onOpenTimeline,
  onPathRenamed,
  onPathDeleted,
  pendingFileSurfaceIds,
  onRefreshSelectedFile,
  workspaceMutationId,
  hostFolder = false,
}: FileBrowserPanelProps) {
  const panelPath = (relativePath: string) =>
    hostFolder ? joinHostPath(cwd, relativePath) : relativePath;
  const { resolvedTheme } = useTheme();
  const composerRef = useComposerHandleContext();
  const fileContextMenu = useFileContextMenu(environmentId);
  const {
    entries: directoryEntries,
    load,
    refresh,
    ready,
    error,
    isPending,
    loadingDirectories,
  } = useDirectoryEntries(environmentId, cwd);
  const [query, setQuery] = useState("");
  const [expandAll, setExpandAll] = useState(false);
  const pathSearch = useProjectPathSearch(
    { environmentId, cwd: hostFolder ? null : cwd, query: query.slice(0, 256) },
    200,
  );
  const { entries, entryKinds, treePaths, directoryPaths, expandableDirectoryPaths } =
    buildTreeEntries(directoryEntries, pathSearch.entries, pathSearch.isPending, query);
  const entryKindsRef = useRef(entryKinds);
  const previousTreePathsRef = useRef<readonly string[] | null>(null);
  const syncingSelectionRef = useRef(false);
  const treeSelectionPathRef = useRef<string | null>(null);
  const handledRevealRef = useRef<{ path: string; revealId: number } | null>(null);

  // Shadow-DOM row rects are unreliable; capture the composed contextmenu event's viewport position.
  const contextMenuPointerRef = useRef<{ x: number; y: number; at: number } | null>(null);

  // Null while the dialog is closed. The target is captured on open so a
  // selection change behind the dialog cannot move where the file lands.
  const [pathDialog, setPathDialog] = useState<ProjectFilePathDialogTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteProjectEntryTarget | null>(null);

  /** Combines the file actions (open/reveal/open with) with the panel's own mention actions. */
  const showEntryContextMenu = useStableCallback(
    (item: TreeContextMenuItem, context: TreeContextMenuOpenContext) => {
      const api = readLocalApi();
      if (!api) {
        context.close();
        return;
      }
      const relativePath = item.path.replace(/\/$/, "");
      const isDirectory = item.path.endsWith("/");
      const mention = serializeComposerFileLink(panelPath(relativePath));
      const pointer = contextMenuPointerRef.current;
      const pointerIsFresh = pointer !== null && performance.now() - pointer.at < 1000;
      const anchorRect = context.anchorElement.getBoundingClientRect();
      const position = pointerIsFresh
        ? { x: pointer.x, y: pointer.y }
        : { x: anchorRect.left, y: anchorRect.bottom };
      const fileTarget = { environmentId, filePath: relativePath, workspaceRoot: cwd };
      const fileMenuItems = fileContextMenu.buildItems(fileTarget);
      // The absolute path is the environment host's, separators included; it is
      // unavailable when the entry cannot be resolved against the workspace root.
      const absolutePath = resolveFileContextMenuAbsolutePath(fileTarget);
      void settlePromise(async () => {
        const clicked = await api.contextMenu.show(
          [
            ...fileMenuItems,
            // Writes land inside the workspace only, so a host folder offers neither.
            ...(hostFolder
              ? []
              : [
                  ...(isDirectory
                    ? [
                        {
                          id: "new-file" as const,
                          label: "New file…",
                          separatorBefore: fileMenuItems.length > 0,
                        },
                      ]
                    : []),
                  {
                    id: "rename" as const,
                    label: "Rename…",
                    separatorBefore: !isDirectory && fileMenuItems.length > 0,
                  },
                  {
                    id: "delete" as const,
                    label: "Delete…",
                    icon: "trash" as const,
                    destructive: true,
                  },
                ]),
            {
              id: "copy-mention",
              label: "Copy mention",
              separatorBefore: !hostFolder,
            },
            { id: "add-to-chat", label: "Add to chat" },
            ...(absolutePath === null
              ? []
              : [
                  {
                    id: "copy-path" as const,
                    label: "Copy path",
                    icon: "copy" as const,
                    separatorBefore: true,
                  },
                ]),
            {
              id: "copy-relative-path" as const,
              label: "Copy relative path",
              icon: "copy" as const,
              separatorBefore: absolutePath === null,
            },
            // A directory has no single history to show, and a host folder is
            // outside the repository the timeline reads.
            ...(isDirectory || hostFolder
              ? []
              : [
                  {
                    id: "open-timeline" as const,
                    label: "Open Timeline",
                    icon: "clock" as const,
                    separatorBefore: true,
                  },
                ]),
          ],
          position,
        );
        if (clicked === null) return;
        // Open-with submenu ids are absent from the top-level item list.
        const isFileMenuAction =
          fileMenuItems.some((entry) => entry.id === clicked) || clicked.startsWith("editor:");
        if (isFileMenuAction) {
          await fileContextMenu.activate(clicked as FileContextMenuAction, fileTarget);
          return;
        }
        if (clicked === "new-file") {
          setPathDialog({ kind: "create", directoryPath: relativePath });
          return;
        }
        if (clicked === "rename") {
          setPathDialog({ kind: "rename", relativePath, isDirectory });
          return;
        }
        if (clicked === "delete") {
          setDeleteTarget({ relativePath, isDirectory });
          return;
        }
        if (clicked === "copy-mention") {
          await copyMenuValue({ value: mention, label: "Mention", description: relativePath });
          return;
        }
        if (clicked === "copy-path" && absolutePath !== null) {
          await copyMenuValue({ value: absolutePath, label: "Path", description: absolutePath });
          return;
        }
        if (clicked === "copy-relative-path") {
          await copyMenuValue({
            value: relativePath,
            label: "Relative path",
            description: relativePath,
          });
          return;
        }
        if (clicked === "open-timeline") {
          onOpenTimeline(relativePath);
          return;
        }
        if (clicked === "add-to-chat") {
          const composer = composerRef?.current;
          if (!composer) {
            toastManager.add({
              type: "error",
              title: "Unable to add to chat",
              description: "Open a chat for this project and try again.",
            });
            return;
          }
          const inserted = composer.insertTextAtEnd(`${mention} `, { ensureLeadingBoundary: true });
          if (!inserted) {
            toastManager.add({
              type: "error",
              title: "Unable to add to chat",
              description: "The chat isn't ready to accept input right now.",
            });
          }
        }
      }).then((result) => {
        context.close();
        if (!AsyncResult.isSuccess(result)) throw Cause.squash(result.cause);
      });
    },
  );

  const loadingDirectoriesRef = useRef(loadingDirectories);
  const dragMention = createFileTreeDragMentionController(
    hostFolder ? { mentionPath: (path: string) => joinHostPath(cwd, path) } : {},
  );
  // Touch browsers such as iOS Safari never fire contextmenu, so each row gets
  // a menu button there instead.
  const coarsePointer = useMediaQuery({ pointer: "coarse" });
  const contextMenuComposition = (touch: boolean) => ({
    contextMenu: {
      triggerMode: touch ? ("both" as const) : ("right-click" as const),
      buttonVisibility: "always" as const,
      onOpen: (item: TreeContextMenuItem, context: TreeContextMenuOpenContext) => {
        showEntryContextMenu(item, context);
      },
    },
  });
  const { model } = useFileTree({
    composition: contextMenuComposition(coarsePointer),
    dragAndDrop: { canDrop: () => false },
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      // Update drag selection even for reveals so subsequent drags cannot use stale paths.
      dragMention.handleSelectionChange(selectedPaths);
      if (syncingSelectionRef.current) return;
      if (dragMention.isDragInProgress()) {
        return;
      }
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (selectedPath && entryKindsRef.current.get(selectedPath) === "file") {
        treeSelectionPathRef.current = selectedPath;
        onOpenFile(panelPath(selectedPath));
      }
    },
    paths: [],
    renderRowDecoration: ({ item, row }) =>
      row.kind === "directory" &&
      row.isExpanded &&
      loadingDirectoriesRef.current.has(item.path.replace(/\/$/, ""))
        ? { icon: "t3-tree-icon-loading", title: "Loading…" }
        : null,
    search: false,
    onSearchChange: (value) => setQuery(value ?? ""),
    unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
  });
  const coarsePointerRef = useRef(coarsePointer);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the pointer-dependent context menu composition into the imperative Pierre tree model
  useEffect(() => {
    if (coarsePointerRef.current === coarsePointer) return;
    coarsePointerRef.current = coarsePointer;
    model.setComposition({ ...model.getComposition(), ...contextMenuComposition(coarsePointer) });
  }, [coarsePointer, contextMenuComposition, model]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- makes the Pierre tree model re-render row decorations when loading directories change
  useEffect(() => {
    if (loadingDirectoriesRef.current === loadingDirectories) return;
    loadingDirectoriesRef.current = loadingDirectories;
    model.setComposition(model.getComposition());
  }, [loadingDirectories, model]);
  const search = useFileTreeSearch(model);
  // Pierre restores the unfiltered tree when a search has no matches.
  const hasNoSearchMatches = search.value.trim().length > 0 && search.matchingPaths.length === 0;
  const allDirectoriesExpanded = useFileTreeSelector(model, (currentModel) =>
    areAllDirectoriesExpanded(currentModel, expandableDirectoryPaths),
  );
  const toggleAllDirectories = () => {
    const expanded = !(expandAll || allDirectoriesExpanded);
    setExpandAll(expanded);
    setAllDirectoriesExpanded(
      model,
      expanded ? expandableDirectoryPaths : directoryPaths,
      expanded,
    );
  };
  const closeSearch = () => {
    setQuery("");
    search.close();
  };
  const expandedPathsRef = useRef(new Set<string>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the Pierre tree model to load directories as they are expanded
  useEffect(() => {
    const currentPaths = new Set(directoryPaths);
    for (const path of expandedPathsRef.current) {
      if (!currentPaths.has(path)) expandedPathsRef.current.delete(path);
    }
    const loadExpanded = () => {
      if (model.isSearchOpen()) return;
      for (const path of directoryPaths) {
        const item = model.getItem(path);
        if (item?.isDirectory() && "isExpanded" in item && item.isExpanded()) {
          if (!expandedPathsRef.current.has(path)) {
            expandedPathsRef.current.add(path);
            void load(path.replace(/\/$/, ""));
          }
        } else {
          if (item?.isDirectory() && expandedPathsRef.current.has(path)) setExpandAll(false);
          expandedPathsRef.current.delete(path);
        }
      }
    };
    loadExpanded();
    return model.subscribe(loadExpanded);
  }, [directoryPaths, load, model]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes ignored-file status into the imperative Pierre tree model
  useEffect(() => {
    model.setGitStatus(
      entries
        .filter((entry) => entry.ignored)
        .map((entry) => ({
          path: treePath(entry),
          status: "ignored",
        })),
    );
  }, [entries, model]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the selected file's ancestor directories and aborts on cleanup
  useEffect(() => {
    if (!selectedPath) return;
    const controller = new AbortController();
    void loadFileAncestors(selectedPath, load, { signal: controller.signal });
    return () => {
      controller.abort();
    };
  }, [load, selectedPath]);
  const handleSearchValueChange = (value: string) => {
    setQuery(value);
    if (value.trim().length === 0) {
      search.close();
      return;
    }
    search.setValue(value);
  };
  const handleRefresh = () => {
    refresh();
    if (query.trim()) pathSearch.refresh();
    onRefreshSelectedFile?.();
  };

  const writeFile = useAtomCommand(projectEnvironment.writeFile);
  const renameEntry = useAtomCommand(projectEnvironment.renameEntry, { reportFailure: false });
  const deleteEntry = useAtomCommand(projectEnvironment.deleteEntry, { reportFailure: false });
  const waitForPendingSaves = usePendingFileSaves(pendingFileSurfaceIds);
  const parentDirectory = (relativePath: string) => {
    const separatorIndex = relativePath.lastIndexOf("/");
    return separatorIndex === -1 ? "" : relativePath.slice(0, separatorIndex);
  };
  // Every folder's listing is cached, so the whole chain is refreshed: a new
  // folder stays invisible until its parent is listed again.
  const reloadFolderChain = async (relativePath: string) => {
    const segments = relativePath.split("/");
    for (let index = 0; index < segments.length; index++) {
      await load(segments.slice(0, index).join("/"), true);
    }
  };
  const renamePath = async (relativePath: string, nextRelativePath: string) => {
    if (!(await waitForPendingSaves(relativePath))) {
      return `Unsaved edits in ${relativePath} could not be saved yet. Try again in a moment.`;
    }
    const renamed = await renameEntry({
      environmentId,
      input: { cwd, relativePath, nextRelativePath },
    });
    if (renamed._tag === "Failure") {
      const cause = Cause.squash(renamed.cause);
      if (typeof cause === "object" && cause !== null && "failure" in cause) {
        if (cause.failure === "path_exists") return `${nextRelativePath} already exists.`;
      }
      return cause instanceof Error ? cause.message : "Unable to rename.";
    }
    await load(parentDirectory(relativePath), true);
    await reloadFolderChain(renamed.value.relativePath);
    // A folder's own listing may be cached from an earlier visit to the same name.
    if (entryKindsRef.current.get(relativePath) === "directory")
      await load(renamed.value.relativePath, true);
    onPathRenamed(relativePath, renamed.value.relativePath);
    return null;
  };
  const deletePath = async ({ relativePath }: DeleteProjectEntryTarget) => {
    if (!(await waitForPendingSaves(relativePath))) {
      return `Unsaved edits in ${relativePath} could not be saved yet. Try again in a moment.`;
    }
    const deleted = await deleteEntry({ environmentId, input: { cwd, relativePath } });
    if (deleted._tag === "Failure") {
      const cause = Cause.squash(deleted.cause);
      return cause instanceof Error ? cause.message : "Unable to delete.";
    }
    await load(parentDirectory(relativePath), true);
    onPathDeleted(relativePath);
    return null;
  };
  const submitPathDialog = (target: ProjectFilePathDialogTarget, relativePath: string) =>
    target.kind === "rename"
      ? renamePath(target.relativePath, relativePath)
      : createFile(relativePath);
  const createFile = async (relativePath: string): Promise<string | null> => {
    const separatorIndex = relativePath.lastIndexOf("/");
    const directoryPath = separatorIndex === -1 ? "" : relativePath.slice(0, separatorIndex);
    // The write truncates whatever it lands on, so a name already taken has to
    // be refused before it runs. A folder that does not exist yet cannot
    // collide, which is what a failed listing means here.
    const listing = await executeAtomQuery(
      appAtomRegistry,
      projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath } }),
      { refresh: true, reportFailure: false, reportDefect: false },
    );
    if (
      listing._tag === "Success" &&
      listing.value.entries.some((entry) => entry.path === relativePath)
    ) {
      return `${relativePath} already exists.`;
    }
    const written = await writeFile({ environmentId, input: { cwd, relativePath, contents: "" } });
    if (written._tag === "Failure") {
      const cause = Cause.squash(written.cause);
      return cause instanceof Error ? cause.message : "Unable to create the file.";
    }
    await reloadFolderChain(relativePath);
    onOpenFile(relativePath);
    return null;
  };
  useWorkspaceMutationRefresh({
    mutationId: workspaceMutationId,
    refresh: () => {
      refresh();
      if (query.trim()) pathSearch.refresh();
    },
    resourceKey: `files:${environmentId}:${cwd}`,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies tree path changes to the imperative Pierre tree model as a reset or batch update
  useEffect(() => {
    if (!ready) return;
    if (previousTreePathsRef.current === treePaths) return;
    entryKindsRef.current = entryKinds;
    const previousTreePaths = previousTreePathsRef.current;
    previousTreePathsRef.current = treePaths;
    if (previousTreePaths === null) {
      model.resetPaths(treePaths);
      return;
    }
    const updates = buildFileTreePathUpdates(previousTreePaths, treePaths);
    if (updates.length > 0) model.batch(updates);
  }, [ready, entryKinds, model, treePaths]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- expands every directory in the Pierre tree model while expand-all is on and no search is active
  useEffect(() => {
    if (expandAll && !query.trim())
      setAllDirectoriesExpanded(model, expandableDirectoryPaths, true);
  }, [expandableDirectoryPaths, expandAll, model, query]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reveals an externally selected path in the Pierre tree model by expanding, selecting and scrolling
  useEffect(() => {
    if (!selectedPath) {
      handledRevealRef.current = null;
      return;
    }
    const selectedKind = entryKinds.get(selectedPath);
    if (selectedKind === undefined) {
      handledRevealRef.current = null;
      return;
    }
    const revealRequest = { path: selectedPath, revealId: selectedPathRevealId };
    const handledReveal = handledRevealRef.current;
    // Refresh rebuilds treePaths; replaying handled reveals would close search and steal focus.
    if (
      handledReveal?.path === revealRequest.path &&
      handledReveal.revealId === revealRequest.revealId
    ) {
      return;
    }
    const selectedTreePath = selectedKind === "directory" ? `${selectedPath}/` : selectedPath;
    const selectedItem = model.getItem(selectedTreePath);
    if (!selectedItem) return;

    // Reveal only external selections; tree selections are visible and re-revealing would close search.
    const selectedInTree = model
      .getSelectedPaths()
      .some((path) => path.replace(/\/$/, "") === selectedPath);
    if (selectedInTree && treeSelectionPathRef.current === selectedPath) {
      treeSelectionPathRef.current = null;
      handledRevealRef.current = revealRequest;
      return;
    }
    treeSelectionPathRef.current = null;
    handledRevealRef.current = revealRequest;

    syncingSelectionRef.current = true;
    setQuery("");
    model.closeSearch();
    for (const path of model.getSelectedPaths()) {
      model.getItem(path)?.deselect();
    }

    // Directory paths include trailing slashes; ancestor lookups must match.
    const segments = selectedPath.split("/");
    let ancestorPath = "";
    for (const segment of segments.slice(0, -1)) {
      ancestorPath = ancestorPath ? `${ancestorPath}/${segment}` : segment;
      const item = model.getItem(`${ancestorPath}/`) ?? model.getItem(ancestorPath);
      if (item && "expand" in item) item.expand();
    }

    if ("expand" in selectedItem) selectedItem.expand();
    selectedItem.select();
    model.scrollToPath(selectedTreePath, {
      focus: true,
      offset: "center",
    });
    queueMicrotask(() => {
      syncingSelectionRef.current = false;
    });
  }, [entryKinds, model, selectedPath, selectedPathRevealId]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-file-browser-panel={`${environmentId}:${cwd}`}
      // Capture runs before the tree's shadow-internal row handler opens the menu.
      onContextMenuCapture={(event) => {
        contextMenuPointerRef.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
      }}
      // Capture dragstart before the tree selects the row so selection sees the drag flag.
      onDragStartCapture={(event) => dragMention.handleDragStart(event.nativeEvent)}
      onDragEnd={() => dragMention.handleDragEnd((path) => model.getItem(path)?.deselect())}
    >
      <div
        className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 in-data-[preview-panel-mode=inline]:mb-1 in-data-[preview-panel-mode=inline]:h-9 in-data-[preview-panel-mode=inline]:min-h-9 in-data-[preview-panel-mode=inline]:border-b-transparent"
        data-surface-subheader
      >
        <RefreshFilesButton isPending={isPending} onRefresh={handleRefresh} />
        {hostFolder ? null : (
          <NewFileButton
            onPress={() =>
              setPathDialog({
                kind: "create",
                // A folder clicked in the tree outranks the open file, which a
                // folder click leaves in place.
                directoryPath: newProjectFileDirectory(
                  model.getSelectedPaths().at(-1)?.replace(/\/$/, "") ?? selectedPath,
                  entryKinds,
                ),
              })
            }
          />
        )}
        <FileSearchField
          name="project-files-search"
          ariaLabel={`Search ${projectName} files`}
          value={search.value}
          onValueChange={handleSearchValueChange}
          onClose={closeSearch}
        />
        {directoryPaths.length > 0 && !hostFolder ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={
                    expandAll || allDirectoriesExpanded
                      ? "Collapse all folders"
                      : "Expand all folders"
                  }
                  onClick={toggleAllDirectories}
                />
              }
            >
              <MorphIcon
                className="size-3.5"
                icon={allDirectoriesExpanded ? ChevronsDownUp : ChevronsUpDown}
              />
            </TooltipTrigger>
            <TooltipPopup>
              {expandAll || allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {error || pathSearch.error ? (
        <button
          type="button"
          onClick={handleRefresh}
          className="p-4 text-left text-xs leading-relaxed text-destructive"
        >
          {error ?? pathSearch.error} Click to retry.
        </button>
      ) : null}
      {query.trim() && pathSearch.truncated && !pathSearch.isPending ? (
        <div className="px-3 py-1 text-xs text-muted-foreground">
          More matches available. Refine your search.
        </div>
      ) : null}
      {(!ready || pathSearch.isPending) && (
        <div
          role="status"
          className={
            entries.length > 0 && !hasNoSearchMatches
              ? "sr-only"
              : "px-3 py-1 text-xs text-muted-foreground"
          }
        >
          Loading files…
        </div>
      )}
      {hasNoSearchMatches ? (
        ready && !isPending && !pathSearch.isPending && !error && !pathSearch.error ? (
          <div role="status" className="px-3 py-4 text-xs text-muted-foreground">
            No matching files.
          </div>
        ) : null
      ) : (
        <FileTree
          model={model}
          aria-label={`${projectName} files`}
          className="min-h-0 flex-1 overflow-hidden"
          style={pierreTreeStyle(resolvedTheme)}
        />
      )}
      <ProjectFilePathDialog
        target={pathDialog}
        projectName={projectName}
        onClose={() => setPathDialog(null)}
        submit={submitPathDialog}
      />
      <DeleteProjectEntryDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        confirm={deletePath}
      />
    </div>
  );
}
