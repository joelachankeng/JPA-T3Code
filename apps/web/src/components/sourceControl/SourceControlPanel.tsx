/**
 * The Source Control surface.
 *
 * Three accordions: the working tree with its commit box, the commit graph,
 * and the GitLens grouped views last. Clicking a change opens its diff in
 * place, with a back control, because T3 Code's right panel is one surface
 * rather than an editor area VS Code can open a second tab in.
 *
 * Presentation state lives in a store rather than in this component, because
 * the panel unmounts whenever another surface is brought forward.
 */
import { useAtomValue } from "@effect/atom-react";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type {
  EnvironmentId,
  ScmCommit,
  ScmDiffInput,
  ScmFileEntry,
  ScmRemoteAction,
} from "@t3tools/contracts";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { requestConfirmDialog } from "~/confirmDialog";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useTheme } from "~/hooks/useTheme";
import { getRenderablePatch, resolveDiffThemeName, resolveFileDiffPath } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { serverEnvironment } from "~/state/server";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "../preview/fileExplorerLabel";
import { GitLensAccordion } from "./GitLensAccordion";
import { ScmFileAtRef } from "./ScmFileAtRef";
import type { ScmFileMenuId } from "./scmMenus";
import {
  SourceControlChanges,
  type ScmFileActions,
  type ScmFolderActions,
  type ScmGroupId,
} from "./SourceControlChanges";
import { ScmRefPickerDialog, type ScmRefPickerKind } from "./ScmRefPickerDialog";
import { SourceControlGraph } from "./SourceControlGraph";
import {
  fileName,
  headPathOf,
  refOnRemote,
  remoteFileUrl,
  remoteTarget,
  syncLabel,
  workspacePathFor,
} from "./sourceControlPanel.logic";
import {
  scmUiKey,
  selectScmUiState,
  useSourceControlUiStore,
  type ScmSectionId,
} from "./sourceControlUiStore";
import { useDelayedFlag, useMinimumVisible, useScmAutoRefresh } from "./useScmAutoRefresh";
import {
  commandErrorMessage,
  useScmCommands,
  useScmDiff,
  useScmLog,
  useScmStatus,
  useScmTimeline,
  useScmView,
  type ScmTarget,
} from "./useSourceControl";

const GRAPH_PAGE_SIZE = 100;

/**
 * Sweep for the refresh bar. Scoped to this component's own animation name so
 * it cannot collide with anything else, and only mounted while a refresh is
 * actually in flight.
 */
const SCM_REFRESH_KEYFRAMES = `@keyframes scm-refresh {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}`;

/** What the in-panel diff view is currently showing. */
type DiffSelection =
  | { kind: "working"; entry: ScmFileEntry; staged: boolean }
  /** `path` null shows every file the commit touched, as the graph row does. */
  | { kind: "commit"; path: string | null; sha: string; subject: string }
  /** A path in the working tree against a revision, from "Open Changes with". */
  | { kind: "compare"; path: string; ref: string; label: string }
  /** A file as HEAD has it, from "Open File (HEAD)". */
  | { kind: "head"; path: string };

/**
 * What a revision picker is open for. Comparing and quick history pick a
 * commit or ref for a path; the remote actions pick where on the host to link.
 */
type PickerRequest = {
  readonly kind: ScmRefPickerKind;
  readonly path: string;
  readonly purpose: "compare" | "history" | "remote-open" | "remote-copy";
};

function Section(props: {
  readonly title: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
  /** Names the section so the panel can scroll to it after opening it. */
  readonly id: ScmSectionId;
}) {
  return (
    <section
      data-scm-section={props.id}
      className="min-w-0 border-border/60 border-b last:border-b-0"
    >
      <button
        type="button"
        className="flex h-7 w-full cursor-pointer items-center gap-1 px-1.5 text-left hover:bg-accent/40"
        onClick={props.onToggle}
        aria-expanded={props.open}
      >
        {props.open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium text-foreground text-xs">{props.title}</span>
      </button>
      {props.open ? <div className="min-w-0 pb-1">{props.children}</div> : null}
    </section>
  );
}

export interface SourceControlPanelProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  /** Opens a workspace file in its own surface. */
  readonly onOpenFile: (relativePath: string) => void;
  /** Opens the file's timeline in its own surface. */
  readonly onOpenTimeline: (relativePath: string, view?: "list" | "visual") => void;
  /** Selects a workspace file in the Files surface, as "Reveal in Explorer View" does. */
  readonly onRevealInFiles: (relativePath: string) => void;
  /** The file the user is looking at elsewhere, so File History has a subject. */
  readonly activeFilePath: string | null;
}

export function SourceControlPanel(props: SourceControlPanelProps) {
  const target: ScmTarget = { environmentId: props.environmentId, cwd: props.cwd };
  const { resolvedTheme } = useTheme();

  // Presentation the user chose, remembered across the panel unmounting.
  const uiKey = scmUiKey({ environmentId: props.environmentId, cwd: props.cwd });
  // Select the stored entry itself, which keeps its identity between reads,
  // and fill in defaults outside the selector. A selector that built a new
  // object on every read would never compare equal and re-render forever.
  const storedUi = useSourceControlUiStore((state) => state.byRepository[uiKey]);
  const ui = useMemo(
    () => selectScmUiState(storedUi ? { [uiKey]: storedUi } : {}, uiKey),
    [storedUi, uiKey],
  );
  const updateUi = useSourceControlUiStore((state) => state.update);
  const toggleSection = useSourceControlUiStore((state) => state.toggleSection);
  const isOpen = (section: ScmSectionId) => !ui.collapsedSections.includes(section);

  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [graphLimit, setGraphLimit] = useState(GRAPH_PAGE_SIZE);
  const [selection, setSelection] = useState<DiffSelection | null>(null);

  const status = useScmStatus(target);
  const log = useScmLog(target, {
    limit: graphLimit,
    ...(ui.allBranches ? { all: true } : {}),
    ...(ui.graphPath ? { path: ui.graphPath } : {}),
  });
  const gitLensViewData = useScmView(target, {
    view:
      ui.gitLensView === "branches"
        ? "branches"
        : ui.gitLensView === "remotes"
          ? "remotes"
          : ui.gitLensView === "stashes"
            ? "stashes"
            : ui.gitLensView === "tags"
              ? "tags"
              : ui.gitLensView === "worktrees"
                ? "worktrees"
                : "contributors",
    includeRemote: true,
  });
  // A pinned folder or file wins over whichever file happens to be open.
  const historyPath = ui.historyPath ?? props.activeFilePath;
  const fileHistory = useScmTimeline(target, historyPath ?? "", 50);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const rootRef = useRef<HTMLDivElement | null>(null);

  const pendingReveal = useRef<ScmSectionId | null>(null);
  // Bumped per request, so a reveal still runs when the data was already cached.
  const [revealRequest, setRevealRequest] = useState(0);

  /** Open a section and bring it into view, as VS Code focuses the view it opens. */
  const revealSection = (section: ScmSectionId, patch: Partial<typeof ui>) => {
    updateUi(uiKey, {
      ...patch,
      collapsedSections: ui.collapsedSections.filter((entry) => entry !== section),
    });
    pendingReveal.current = section;
    setRevealRequest((count) => count + 1);
  };

  // The scroll waits for the section's own data. Scrolling while it still
  // reads "Loading" leaves too little below it to bring it to the top, and the
  // rows then arrive out of view.
  const historyReady = fileHistory.data !== null && !fileHistory.isPending;
  const graphReady = log.data !== null && !log.isPending;
  useEffect(() => {
    const section = pendingReveal.current;
    // Zero means nothing has asked for a reveal since the panel mounted.
    if (revealRequest === 0 || !section) return;
    if (section === "gitlens" && !historyReady) return;
    if (section === "graph" && !graphReady) return;
    pendingReveal.current = null;
    requestAnimationFrame(() =>
      rootRef.current
        ?.querySelector(`[data-scm-section="${section}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
  }, [historyReady, graphReady, revealRequest]);
  const commands = useScmCommands();

  // Each `refresh` is stable; the query-state objects around them are not, so
  // depending on the objects would rebuild every callback below on each render.
  const refreshStatus = status.refresh;
  const refreshLog = log.refresh;
  const refreshView = gitLensViewData.refresh;
  const refreshAll = () => {
    refreshStatus();
    refreshLog();
    refreshView();
  };

  // A diff view is a snapshot of one revision; polling behind it would refetch
  // the list nobody is looking at.
  useScmAutoRefresh({ enabled: selection === null, refresh: refreshAll });

  const isRefreshing = status.isPending || log.isPending || gitLensViewData.isPending;
  // A background poll only reports itself when it is slow enough to be worth
  // noticing; a refresh the user asked for always shows, even when it is quick.
  const [refreshTick, setRefreshTick] = useState(0);
  const requestRefresh = () => {
    setRefreshTick((tick) => tick + 1);
    refreshAll();
  };
  // Both hooks run every render: `||` between two hook calls would skip the
  // second whenever the first is true, and hook order has to stay stable.
  const refreshIsSlow = useDelayedFlag(isRefreshing || busy);
  const refreshWasRequested = useMinimumVisible(refreshTick);
  const showRefreshing = refreshIsSlow || refreshWasRequested;

  /** Run a mutation, surface git's own words on failure, then refresh. */
  const run = async (
    label: string,
    action: () => Promise<{ readonly _tag: string; cause?: unknown }>,
  ) => {
    setBusy(true);
    try {
      const result = await action();
      if (result._tag !== "Success") {
        toastManager.add({
          type: "error",
          title: label,
          description: commandErrorMessage(result.cause),
        });
        return false;
      }
      return true;
    } finally {
      setBusy(false);
      refreshAll();
    }
  };

  const stage = (_group: ScmGroupId, paths: readonly string[]) =>
    void run("Unable to stage changes", () =>
      commands.stage({
        environmentId: props.environmentId,
        input: { cwd: props.cwd, action: "stage", paths },
      }),
    );

  const unstage = (paths: readonly string[]) =>
    void run("Unable to unstage changes", () =>
      commands.stage({
        environmentId: props.environmentId,
        input: { cwd: props.cwd, action: "unstage", paths },
      }),
    );

  const discard = async (entries: readonly ScmFileEntry[]) => {
    if (entries.length === 0) return;
    // Discarding is unrecoverable, so it asks first, exactly as VS Code does.
    const label =
      entries.length === 1
        ? `Are you sure you want to discard changes in ${fileName(entries[0]?.path ?? "")}?`
        : `Are you sure you want to discard all changes in ${entries.length} files?`;
    const confirmed = await requestConfirmDialog(label, { variant: "destructive" });
    if (!confirmed) return;
    // Untracked files are removed rather than reverted; git checkout cannot
    // restore a file that has never been committed.
    const tracked = entries
      .filter((entry) => entry.worktree !== "untracked")
      .map((entry) => entry.path);
    const untracked = entries
      .filter((entry) => entry.worktree === "untracked")
      .map((entry) => entry.path);
    if (tracked.length > 0) {
      const ok = await run("Unable to discard changes", () =>
        commands.stage({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, action: "discard", paths: tracked },
        }),
      );
      if (!ok) return;
    }
    if (untracked.length > 0) {
      await run("Unable to delete untracked files", () =>
        commands.stage({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, action: "clean", paths: untracked },
        }),
      );
    }
  };

  const acceptSide = (side: "ours" | "theirs", paths: readonly string[]) =>
    void run("Unable to resolve the conflict", () =>
      commands.stage({
        environmentId: props.environmentId,
        input: {
          cwd: props.cwd,
          action: side === "ours" ? "accept-ours" : "accept-theirs",
          paths,
        },
      }),
    );

  const stash = (paths: readonly string[]) =>
    void run("Unable to stash changes", () =>
      commands.stash({
        environmentId: props.environmentId,
        input: {
          cwd: props.cwd,
          action: "push",
          includeUntracked: true,
          ...(paths.length > 0 ? { paths } : {}),
        },
      }),
    );

  const remoteAction = (action: ScmRemoteAction) =>
    void run(`Unable to ${action.replace("-", " ")}`, () =>
      commands.remoteAction({
        environmentId: props.environmentId,
        input: { cwd: props.cwd, action },
      }),
    );

  const commit = async (options: { readonly push: boolean; readonly sync: boolean }) => {
    const trimmed = ui.message.trim();
    const repository = status.data?.repository;
    const stagedCount = status.data?.staged.length ?? 0;
    const ok = await run("Unable to commit", () =>
      commands.commit({
        environmentId: props.environmentId,
        input: {
          cwd: props.cwd,
          // An amend with an empty box keeps the previous message, which is
          // what "Amend Last Commit" means.
          message: trimmed.length > 0 ? trimmed : "(amend)",
          ...(amend ? { amend: true } : {}),
          // With nothing staged, VS Code commits every tracked change.
          ...(stagedCount === 0 ? { all: true } : {}),
        },
      }),
    );
    if (!ok) return;
    updateUi(uiKey, { message: "" });
    setAmend(false);
    if (options.sync) remoteAction("sync");
    else if (options.push) remoteAction(repository?.upstream ? "push" : "publish");
  };

  const folderActions: ScmFolderActions = {
    addToGitignore: (paths) =>
      void run("Unable to add to .gitignore", () =>
        commands.ignore({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, paths },
        }),
      ),
    copyPatch: (paths, staged) =>
      void (async () => {
        const result = await commands.patch({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, paths, staged },
        });
        if (result._tag !== "Success") {
          toastManager.add({
            type: "error",
            title: "Unable to copy changes",
            description: commandErrorMessage(result.cause),
          });
          return;
        }
        try {
          await writeTextToClipboard(result.value.patch);
          toastManager.add({ type: "success", title: "Changes copied as a patch" });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Unable to copy changes",
            description: error instanceof Error ? error.message : "The clipboard refused it.",
          });
        }
      })(),
    openChangesWithRevision: (folder) =>
      setPicker({ kind: "revision", path: folder, purpose: "compare" }),
    openChangesWithRef: (folder) => setPicker({ kind: "ref", path: folder, purpose: "compare" }),
    openHistory: (folder) =>
      revealSection("gitlens", {
        gitLensView: "file-history",
        historyPath: folder,
        historyIsFolder: true,
      }),
    openHistoryInGraph: (folder) => revealSection("graph", { graphPath: folder }),
    openVisualHistory: (folder) => props.onOpenTimeline(folder, "visual"),
  };

  const repositoryState = status.data?.repository ?? null;
  const remote = repositoryState ? remoteTarget(repositoryState) : null;

  /** A repository path in the project's terms, for the Files surface and copying. */
  const workspacePath = (repoPath: string) =>
    workspacePathFor(repoPath, repositoryState?.root ?? null, props.cwd);

  const openFile = (repoPath: string) => {
    const { relative } = workspacePath(repoPath);
    if (relative !== null) props.onOpenFile(relative);
    else toastManager.add({ type: "info", title: "This file is outside the project" });
  };

  const copyText = async (text: string, title: string) => {
    try {
      await writeTextToClipboard(text);
      toastManager.add({ type: "success", title });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to copy",
        description: error instanceof Error ? error.message : "The clipboard refused it.",
      });
    }
  };

  /** Open or copy a file's page on its host, at `ref` or where the branch is published. */
  const shareRemote = (path: string, action: "open" | "copy", ref?: string) => {
    if (!remote) return;
    const url = remoteFileUrl({
      remoteUrl: remote.remoteUrl,
      ref: ref === undefined ? remote.ref : refOnRemote(ref, remote.remoteName),
      path,
    });
    if (!url) {
      toastManager.add({ type: "error", title: "This remote has no web address to link to" });
      return;
    }
    if (action === "copy") void copyText(url, "Remote file URL copied");
    else void readLocalApi()?.shell.openExternal(url);
  };

  const revealInFileManagerLabel =
    serverConfig?.shellRevealInFileManager === true &&
    serverConfig.availableEditors.includes("file-manager")
      ? serverConfig.shellRevealInFileManagerKind === undefined
        ? revealInFileExplorerLabelForOs(serverConfig.environment.platform.os)
        : revealInFileExplorerLabelForKind(serverConfig.shellRevealInFileManagerKind)
      : null;

  const revealInFileManager = async (repoPath: string) => {
    const result = await openInEditor({
      environmentId: props.environmentId,
      input: { cwd: workspacePath(repoPath).absolute, editor: "file-manager", reveal: true },
    });
    if (result._tag === "Success") return;
    toastManager.add({
      type: "error",
      title: "Unable to reveal the file",
      description: commandErrorMessage(result.cause),
    });
  };

  const runFileAction = (id: ScmFileMenuId, entry: ScmFileEntry, staged: boolean) => {
    // HEAD and the host know a renamed file by its old name.
    const headPath = headPathOf(entry) ?? entry.path;
    const inProject = workspacePath(entry.path).relative;
    switch (id) {
      case "compare-revision":
        return setPicker({ kind: "revision", path: entry.path, purpose: "compare" });
      case "compare-ref":
        return setPicker({ kind: "ref", path: entry.path, purpose: "compare" });
      case "open-head":
        return setSelection({ kind: "head", path: headPath });
      case "remote-open":
        return shareRemote(headPath, "open");
      case "remote-copy":
        return shareRemote(headPath, "copy");
      case "remote-open-from":
        return setPicker({ kind: "ref", path: headPath, purpose: "remote-open" });
      case "remote-copy-from":
        return setPicker({ kind: "ref", path: headPath, purpose: "remote-copy" });
      case "history":
        return revealSection("gitlens", {
          gitLensView: "file-history",
          historyPath: entry.path,
          historyIsFolder: false,
        });
      case "history-graph":
        return revealSection("graph", { graphPath: entry.path });
      case "history-visual":
        return props.onOpenTimeline(entry.path, "visual");
      case "history-quick":
        return setPicker({ kind: "revision", path: entry.path, purpose: "history" });
      case "gitignore":
        return folderActions.addToGitignore([entry.path]);
      case "copy-patch":
        return folderActions.copyPatch(
          entry.previousPath ? [entry.path, entry.previousPath] : [entry.path],
          staged,
        );
      case "copy-path":
        return void copyText(inProject ?? workspacePath(entry.path).absolute, "Path copied");
      case "reveal-files":
        if (inProject !== null) props.onRevealInFiles(inProject);
        else toastManager.add({ type: "info", title: "This file is outside the project" });
        return;
      case "reveal-os":
        return void revealInFileManager(entry.path);
      default:
        return;
    }
  };

  const fileActions: ScmFileActions = {
    hasRemote: remote !== null,
    revealInFileManagerLabel,
    run: runFileAction,
  };

  const diffInput: Omit<ScmDiffInput, "cwd"> | null = useMemo(() => {
    if (!selection || selection.kind === "head") return null;
    // The panel renders patches only, so neither side's full text is fetched.
    if (selection.kind === "commit") {
      return {
        ...(selection.path ? { path: selection.path } : {}),
        from: { _tag: "commitParent", sha: selection.sha },
        to: { _tag: "commit", sha: selection.sha },
        includeContents: false,
      };
    }
    if (selection.kind === "compare") {
      return {
        path: selection.path,
        from: { _tag: "commit", sha: selection.ref },
        to: { _tag: "working" },
        includeContents: false,
      };
    }
    return {
      path: selection.entry.path,
      ...(selection.entry.previousPath ? { previousPath: selection.entry.previousPath } : {}),
      from: selection.staged ? { _tag: "head" } : { _tag: "index" },
      to: selection.staged ? { _tag: "index" } : { _tag: "working" },
      includeContents: false,
    };
  }, [selection]);
  const diff = useScmDiff(target, diffInput);
  const renderablePatch = useMemo(
    () => getRenderablePatch(diff.data?.patch, `scm-diff:${resolvedTheme}`),
    [diff.data?.patch, resolvedTheme],
  );

  if (status.data && !status.data.repository.isRepo) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
        <p className="text-muted-foreground text-xs">
          {props.projectName} is not a git repository, so there is no source control to show.
        </p>
      </div>
    );
  }

  if (selection?.kind === "head") {
    const title = `${fileName(selection.path)} (HEAD)`;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-8 shrink-0 items-center gap-1.5 border-border/60 border-b px-2">
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Back to source control"
            onClick={() => setSelection(null)}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={<span className="min-w-0 flex-1 truncate text-foreground text-xs" />}
            >
              {title}
            </TooltipTrigger>
            <TooltipPopup>{selection.path}</TooltipPopup>
          </Tooltip>
        </header>
        <ScmFileAtRef target={target} path={selection.path} gitRef="HEAD" />
      </div>
    );
  }

  if (selection) {
    const title =
      selection.kind === "commit"
        ? [selection.path ? fileName(selection.path) : null, selection.subject || selection.sha]
            .filter((part) => part !== null && part.length > 0)
            .join(" — ")
        : selection.kind === "compare"
          ? `${fileName(selection.path)} (${selection.label}) ↔ ${fileName(selection.path)} (Working Tree)`
          : `${fileName(selection.entry.path)} (${selection.staged ? "Staged" : "Working Tree"})`;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-8 shrink-0 items-center gap-1.5 border-border/60 border-b px-2">
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Back to source control"
            onClick={() => setSelection(null)}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={<span className="min-w-0 flex-1 truncate text-foreground text-xs" />}
            >
              {title}
            </TooltipTrigger>
            <TooltipPopup>{title}</TooltipPopup>
          </Tooltip>
          {diff.data ? (
            <span className="shrink-0 font-mono text-[11px] tabular-nums">
              <span className="text-success">+{diff.data.insertions}</span>{" "}
              <span className="text-destructive-foreground">−{diff.data.deletions}</span>
            </span>
          ) : null}
        </header>
        <ScrollArea className="min-h-0 flex-1">
          {diff.error ? (
            <p className="px-3 py-3 text-destructive-foreground text-xs">{diff.error}</p>
          ) : diff.data?.binary ? (
            <p className="px-3 py-3 text-muted-foreground text-xs">
              This file is binary, so there is no text diff to show.
            </p>
          ) : renderablePatch?.kind === "files" ? (
            <DiffWorkerPoolProvider>
              {renderablePatch.files.map((fileDiff) => (
                <PierreFileDiff
                  key={resolveFileDiffPath(fileDiff)}
                  fileDiff={fileDiff}
                  options={{
                    collapsed: false,
                    diffStyle: "unified",
                    theme: resolveDiffThemeName(resolvedTheme),
                    preferredHighlighter: PREFERRED_HIGHLIGHTER,
                  }}
                />
              ))}
            </DiffWorkerPoolProvider>
          ) : renderablePatch?.kind === "raw" ? (
            <pre className="overflow-x-auto p-2 text-xs">{renderablePatch.text}</pre>
          ) : (
            <p className="px-3 py-3 text-muted-foreground text-xs">
              {diff.isPending ? "Loading diff…" : "No changes to show for this file."}
            </p>
          )}
        </ScrollArea>
      </div>
    );
  }

  const repository = status.data?.repository ?? null;

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-8 shrink-0 items-center gap-1.5 border-border/60 border-b px-2">
        <span className="shrink-0 font-medium text-foreground text-xs">Source Control</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {repository?.branch ?? repository?.headSha ?? props.projectName}
          {repository?.operation && repository.operation !== "none"
            ? ` · ${repository.operation} in progress`
            : ""}
        </span>
        {repository ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="icon-xs"
                  aria-label={syncLabel({
                    ahead: repository.ahead,
                    behind: repository.behind,
                    upstream: repository.upstream,
                    branch: repository.branch,
                  })}
                  disabled={busy}
                  onClick={() => remoteAction(repository.upstream ? "sync" : "publish")}
                />
              }
            >
              {repository.upstream ? (
                <span className="flex items-center gap-0.5">
                  <RotateCw className={cn("size-3.5", busy && "animate-spin")} />
                  {repository.ahead + repository.behind > 0 ? (
                    <span className="text-[10px] tabular-nums">
                      {repository.behind > 0 ? `↓${repository.behind}` : ""}
                      {repository.ahead > 0 ? `↑${repository.ahead}` : ""}
                    </span>
                  ) : null}
                </span>
              ) : (
                <CloudUpload className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup>
              {syncLabel({
                ahead: repository.ahead,
                behind: repository.behind,
                upstream: repository.upstream,
                branch: repository.branch,
              })}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Refresh source control"
                onClick={requestRefresh}
              />
            }
          >
            <RefreshCw className={cn("size-3.5", showRefreshing && "animate-spin")} />
          </TooltipTrigger>
          <TooltipPopup>{showRefreshing ? "Refreshing…" : "Refresh"}</TooltipPopup>
        </Tooltip>
      </header>
      {/*
        A one-pixel bar under the header, shown only once a refresh has been
        running long enough to be worth reporting. It animates while it is up
        and then leaves, rather than painting continuously.
      */}
      <div
        aria-hidden="true"
        className={cn(
          "h-px shrink-0 overflow-hidden transition-opacity duration-150",
          showRefreshing ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="h-full w-1/3 animate-[scm-refresh_1.1s_ease-in-out_infinite] bg-info" />
      </div>
      <style>{SCM_REFRESH_KEYFRAMES}</style>

      <ScmRefPickerDialog
        open={picker !== null}
        kind={picker?.kind ?? "revision"}
        environmentId={props.environmentId}
        cwd={props.cwd}
        path={picker?.path ?? ""}
        {...(picker?.purpose === "history"
          ? { prompt: `Choose a commit of ${picker.path} to open`, actionLabel: "Open" }
          : picker?.purpose === "remote-open"
            ? { prompt: `Open ${picker.path} on the remote from…`, actionLabel: "Open" }
            : picker?.purpose === "remote-copy"
              ? { prompt: `Copy the remote URL of ${picker.path} from…`, actionLabel: "Copy" }
              : {})}
        onOpenChange={(open) => {
          if (!open) setPicker(null);
        }}
        onChoose={(choice) => {
          if (!picker) return;
          if (picker.purpose === "history") {
            setSelection({
              kind: "commit",
              path: picker.path,
              sha: choice.ref,
              subject: choice.label,
            });
          } else if (picker.purpose === "compare") {
            setSelection({
              kind: "compare",
              path: picker.path,
              ref: choice.ref,
              label: choice.label,
            });
          } else {
            shareRemote(
              picker.path,
              picker.purpose === "remote-open" ? "open" : "copy",
              choice.ref,
            );
          }
        }}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-w-0">
          {status.error ? (
            <p className="px-3 py-3 text-destructive-foreground text-xs">{status.error}</p>
          ) : null}

          <Section
            title="Changes"
            open={isOpen("changes")}
            onToggle={() => toggleSection(uiKey, "changes")}
            id="changes"
          >
            {status.data ? (
              <SourceControlChanges
                status={status.data}
                viewAsTree={ui.viewAsTree}
                onViewAsTreeChange={(value) => updateUi(uiKey, { viewAsTree: value })}
                message={ui.message}
                onMessageChange={(value) => updateUi(uiKey, { message: value })}
                amend={amend}
                onAmendChange={setAmend}
                busy={busy}
                onCommit={(options) => void commit(options)}
                onStage={stage}
                onUnstage={unstage}
                onDiscard={(entries) => void discard(entries)}
                onStash={stash}
                onOpenDiff={(entry, staged) => setSelection({ kind: "working", entry, staged })}
                onOpenFile={openFile}
                onOpenTimeline={props.onOpenTimeline}
                onAcceptSide={acceptSide}
                folderActions={folderActions}
                fileActions={fileActions}
              />
            ) : (
              <p className="px-3 py-3 text-muted-foreground text-xs">Loading…</p>
            )}
          </Section>

          <Section
            title="Graph"
            open={isOpen("graph")}
            onToggle={() => toggleSection(uiKey, "graph")}
            id="graph"
          >
            <SourceControlGraph
              log={log.data}
              isPending={log.isPending}
              error={log.error}
              allBranches={ui.allBranches}
              onAllBranchesChange={(value) => updateUi(uiKey, { allBranches: value })}
              pathFilter={ui.graphPath}
              onClearPathFilter={() => updateUi(uiKey, { graphPath: null })}
              onRefresh={log.refresh}
              selectedSha={null}
              onSelectCommit={(commit) =>
                setSelection({
                  kind: "commit",
                  path: null,
                  sha: commit.sha,
                  subject: commit.subject,
                })
              }
              onLoadMore={
                log.data?.nextSkip !== null && log.data !== null
                  ? () => setGraphLimit((value) => value + GRAPH_PAGE_SIZE)
                  : null
              }
            />
          </Section>

          <Section
            title="GitLens"
            open={isOpen("gitlens")}
            onToggle={() => toggleSection(uiKey, "gitlens")}
            id="gitlens"
          >
            {status.data ? (
              <GitLensAccordion
                view={ui.gitLensView}
                onViewChange={(view) => updateUi(uiKey, { gitLensView: view })}
                status={status.data}
                log={log.data}
                logPending={log.isPending}
                viewData={gitLensViewData.data}
                viewPending={gitLensViewData.isPending}
                viewError={gitLensViewData.error}
                fileHistory={historyPath ? fileHistory.data : null}
                fileHistoryPath={historyPath}
                fileHistoryIsFolder={ui.historyPath !== null && ui.historyIsFolder}
                fileHistoryPinned={ui.historyPath !== null}
                onUnpinHistory={() =>
                  updateUi(uiKey, { historyPath: null, historyIsFolder: false })
                }
                onOpenUncommitted={(path) =>
                  setSelection({ kind: "compare", path, ref: "HEAD", label: "HEAD" })
                }
                onRefresh={requestRefresh}
                onSelectCommit={(commit: ScmCommit) =>
                  setSelection({
                    kind: "commit",
                    path: null,
                    sha: commit.sha,
                    subject: commit.subject,
                  })
                }
                onCheckoutBranch={(name) =>
                  void run("Unable to switch branch", () =>
                    commands.branch({
                      environmentId: props.environmentId,
                      input: { cwd: props.cwd, action: "checkout", name },
                    }),
                  )
                }
                onApplyStash={(ref) =>
                  void run("Unable to apply the stash", () =>
                    commands.stash({
                      environmentId: props.environmentId,
                      input: { cwd: props.cwd, action: "apply", ref },
                    }),
                  )
                }
                onDropStash={(ref) =>
                  void run("Unable to drop the stash", () =>
                    commands.stash({
                      environmentId: props.environmentId,
                      input: { cwd: props.cwd, action: "drop", ref },
                    }),
                  )
                }
                onRemoteAction={remoteAction}
                onOpenTimelineEntry={(path, sha, subject) =>
                  setSelection({ kind: "commit", path, sha, subject })
                }
              />
            ) : (
              <p className="px-3 py-3 text-muted-foreground text-xs">Loading…</p>
            )}
          </Section>
        </div>
      </ScrollArea>
    </div>
  );
}
