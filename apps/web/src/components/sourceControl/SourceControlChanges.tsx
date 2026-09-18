/**
 * The repository accordion: commit box, commit button, and the working tree's
 * change groups. This is the part of VS Code's Source Control view people
 * actually drive day to day, so the affordances match it closely — row
 * checkboxes stage, the hover actions open/discard/stage, and group headers
 * carry the same bulk actions.
 */
import type { ScmFileEntry, ScmStatusResult } from "@t3tools/contracts";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Undo2,
  Plus,
  Minus,
  MoreHorizontal,
  ListTree,
  List as ListIcon,
  FileDiff,
} from "lucide-react";
import { memo, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { useScmContextMenu } from "./useScmContextMenu";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { PierreEntryIcon } from "~/components/chat/PierreEntryIcon";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/useTheme";

import {
  buildListRows,
  buildTreeRows,
  canOpenFile,
  commitButtonLabel,
  commitDisabledReason,
  directoryName,
  folderToneClassName,
  statusLetter,
  statusTitle,
  statusToneClassName,
  type ScmTreeRow,
} from "./sourceControlPanel.logic";

export type ScmGroupId = "merge" | "staged" | "changes";

export interface SourceControlChangesProps {
  readonly status: ScmStatusResult;
  readonly viewAsTree: boolean;
  readonly onViewAsTreeChange: (value: boolean) => void;
  readonly message: string;
  readonly onMessageChange: (value: string) => void;
  readonly amend: boolean;
  readonly onAmendChange: (value: boolean) => void;
  readonly busy: boolean;
  readonly onCommit: (options: { readonly push: boolean; readonly sync: boolean }) => void;
  readonly onStage: (group: ScmGroupId, paths: readonly string[]) => void;
  readonly onUnstage: (paths: readonly string[]) => void;
  readonly onDiscard: (entries: readonly ScmFileEntry[]) => void;
  readonly onStash: (paths: readonly string[]) => void;
  readonly onOpenDiff: (entry: ScmFileEntry, staged: boolean) => void;
  readonly onOpenFile: (path: string) => void;
  readonly onOpenTimeline: (path: string) => void;
  readonly onAcceptSide: (side: "ours" | "theirs", paths: readonly string[]) => void;
}

const GROUP_TITLES: Record<ScmGroupId, string> = {
  merge: "Merge Changes",
  staged: "Staged Changes",
  changes: "Changes",
};

function ToolbarButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-xs"
            aria-label={props.label}
            disabled={props.disabled ?? false}
            onClick={(event) => {
              // A row action is not also a request to open the row. Without
              // this, staging or discarding a file would leave the panel
              // showing that file's diff instead of the change list.
              event.stopPropagation();
              props.onClick();
            }}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

const FileRow = memo(function FileRow(props: {
  readonly entry: ScmFileEntry;
  readonly label: string;
  readonly depth: number;
  readonly group: ScmGroupId;
  readonly showDirectory: boolean;
  readonly onOpenDiff: () => void;
  readonly onOpenFile: () => void;
  readonly onOpenTimeline: () => void;
  readonly onPrimaryAction: () => void;
  readonly onDiscard: () => void;
  readonly onStash: () => void;
  readonly onAcceptOurs: () => void;
  readonly onAcceptTheirs: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const showContextMenu = useScmContextMenu();
  const directory = props.showDirectory ? directoryName(props.entry.path) : "";
  const staged = props.group === "staged";
  // A deleted file has nothing on disk to open, so it is not offered.
  const openable = canOpenFile(props.entry);

  // The same entries VS Code puts on a changed file, through the shared host
  // menu so the desktop app gets a native one and the browser its fallback.
  const openMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    void showContextMenu(
      [
        { id: "open-changes", label: "Open Changes" },
        ...(openable ? ([{ id: "open-file", label: "Open File" }] as const) : []),
        { id: "open-timeline", label: "Open Timeline", icon: "clock", separatorBefore: true },
        ...(props.group === "merge"
          ? ([
              {
                id: "accept-ours",
                label: "Accept Current Change",
                separatorBefore: true,
              },
              { id: "accept-theirs", label: "Accept Incoming Change" },
            ] as const)
          : []),
        ...(staged
          ? ([{ id: "unstage", label: "Unstage Changes", separatorBefore: true }] as const)
          : ([
              { id: "discard", label: "Discard Changes", separatorBefore: true },
              { id: "stage", label: "Stage Changes" },
              { id: "stash", label: "Stash Changes\u2026" },
            ] as const)),
      ],
      { x: event.clientX, y: event.clientY },
    ).then((clicked) => {
      if (clicked === "open-changes") props.onOpenDiff();
      else if (clicked === "open-file") props.onOpenFile();
      else if (clicked === "open-timeline") props.onOpenTimeline();
      else if (clicked === "accept-ours") props.onAcceptOurs();
      else if (clicked === "accept-theirs") props.onAcceptTheirs();
      else if (clicked === "stage" || clicked === "unstage") props.onPrimaryAction();
      else if (clicked === "discard") props.onDiscard();
      else if (clicked === "stash") props.onStash();
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className="group/row flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-sm pr-1 text-left hover:bg-accent/60"
      style={{ paddingLeft: `${4 + props.depth * 12}px` }}
      onClick={props.onOpenDiff}
      onContextMenu={openMenu}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onOpenDiff();
      }}
    >
      <input
        type="checkbox"
        aria-label={staged ? `Unstage ${props.entry.path}` : `Stage ${props.entry.path}`}
        checked={staged}
        className="size-3 shrink-0 cursor-pointer accent-primary"
        onChange={props.onPrimaryAction}
        onClick={(event) => event.stopPropagation()}
      />
      <PierreEntryIcon
        pathValue={props.entry.path}
        kind="file"
        theme={resolvedTheme}
        className="size-3.5 shrink-0"
      />
      <span
        className={cn(
          "truncate text-xs",
          props.entry.worktree === "deleted" || props.entry.index === "deleted"
            ? "text-foreground/70 line-through"
            : "text-foreground/90",
        )}
      >
        {props.label}
      </span>
      {directory ? (
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {directory}
        </span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      {/* Hover actions appear beside the status letter, which stays, as in VS Code. */}
      <span className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex">
        {openable ? (
          <ToolbarButton label="Open File" onClick={props.onOpenFile}>
            <FileDiff className="size-3.5" />
          </ToolbarButton>
        ) : null}
        {props.group !== "staged" ? (
          <ToolbarButton label="Discard Changes" onClick={props.onDiscard}>
            <Undo2 className="size-3.5" />
          </ToolbarButton>
        ) : null}
        <ToolbarButton
          label={staged ? "Unstage Changes" : "Stage Changes"}
          onClick={props.onPrimaryAction}
        >
          {staged ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
        </ToolbarButton>
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                "w-3 shrink-0 text-center font-medium text-[11px]",
                statusToneClassName(props.entry),
              )}
            />
          }
        >
          {statusLetter(props.entry)}
        </TooltipTrigger>
        <TooltipPopup>{statusTitle(props.entry)}</TooltipPopup>
      </Tooltip>
    </div>
  );
});

/**
 * A folder in the tree presentation. It acts on every change beneath it, with
 * the actions VS Code gives a folder in that group: discard and stage in
 * Changes, unstage in Staged Changes, stage in Merge Changes. In place of a
 * status letter it carries a dot coloured by the most notable change inside.
 */
function DirectoryRow(props: {
  readonly label: string;
  readonly depth: number;
  readonly group: ScmGroupId;
  readonly entries: readonly ScmFileEntry[];
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onStage: () => void;
  readonly onUnstage: () => void;
  readonly onDiscard: () => void;
}) {
  const showContextMenu = useScmContextMenu();
  const tone = folderToneClassName(props.entries);
  const staged = props.group === "staged";

  const openMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    void showContextMenu(
      staged
        ? [{ id: "unstage", label: "Unstage Changes" }]
        : props.group === "merge"
          ? [{ id: "stage", label: "Stage Changes" }]
          : [
              { id: "discard", label: "Discard Changes" },
              { id: "stage", label: "Stage Changes" },
            ],
      { x: event.clientX, y: event.clientY },
    ).then((clicked) => {
      if (clicked === "stage") props.onStage();
      else if (clicked === "unstage") props.onUnstage();
      else if (clicked === "discard") props.onDiscard();
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={!props.collapsed}
      className="group/row flex h-6 w-full cursor-pointer items-center gap-1 rounded-sm pr-1 text-left hover:bg-accent/60"
      style={{ paddingLeft: `${4 + props.depth * 12}px` }}
      onClick={props.onToggle}
      onContextMenu={openMenu}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onToggle();
      }}
    >
      {props.collapsed ? (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate text-foreground/80 text-xs">{props.label}</span>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex">
        {props.group === "changes" ? (
          <ToolbarButton label="Discard Changes" onClick={props.onDiscard}>
            <Undo2 className="size-3.5" />
          </ToolbarButton>
        ) : null}
        {staged ? (
          <ToolbarButton label="Unstage Changes" onClick={props.onUnstage}>
            <Minus className="size-3.5" />
          </ToolbarButton>
        ) : (
          <ToolbarButton label="Stage Changes" onClick={props.onStage}>
            <Plus className="size-3.5" />
          </ToolbarButton>
        )}
      </span>
      <span className="flex w-3 shrink-0 items-center justify-center">
        {tone ? <span aria-hidden="true" className={cn("size-1.5 rounded-full", tone)} /> : null}
      </span>
    </div>
  );
}

/**
 * The paths an unstage has to name. A staged rename is two index entries — the
 * new path added and the old one removed — so restoring only the new path
 * would leave the old one's deletion staged.
 */
function unstagePaths(entries: readonly ScmFileEntry[]): string[] {
  return [
    ...new Set(
      entries.flatMap((entry) =>
        entry.previousPath ? [entry.path, entry.previousPath] : [entry.path],
      ),
    ),
  ];
}

function ChangeGroup(props: {
  readonly id: ScmGroupId;
  readonly entries: readonly ScmFileEntry[];
  readonly viewAsTree: boolean;
  readonly changes: SourceControlChangesProps;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedDirectories, setCollapsedDirectories] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const rows: ScmTreeRow[] = useMemo(
    () =>
      props.viewAsTree
        ? buildTreeRows(props.entries, collapsedDirectories)
        : buildListRows(props.entries),
    [collapsedDirectories, props.entries, props.viewAsTree],
  );
  if (props.entries.length === 0) return null;

  const paths = props.entries.map((entry) => entry.path);
  const staged = props.id === "staged";

  return (
    <div className="min-w-0">
      <div className="group/group flex h-6 items-center gap-1 rounded-sm px-1 hover:bg-accent/40">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium text-foreground text-xs">
            {GROUP_TITLES[props.id]}
          </span>
        </button>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover/group:flex">
          {props.id === "changes" ? (
            <>
              <ToolbarButton
                label="Discard All Changes"
                onClick={() => props.changes.onDiscard(props.entries)}
              >
                <Undo2 className="size-3.5" />
              </ToolbarButton>
              <ToolbarButton
                label="Stage All Changes"
                onClick={() => props.changes.onStage("changes", paths)}
              >
                <Plus className="size-3.5" />
              </ToolbarButton>
            </>
          ) : null}
          {staged ? (
            <ToolbarButton
              label="Unstage All Changes"
              onClick={() => props.changes.onUnstage(unstagePaths(props.entries))}
            >
              <Minus className="size-3.5" />
            </ToolbarButton>
          ) : null}
          {props.id === "merge" ? (
            <ToolbarButton
              label="Stage All Merge Changes"
              onClick={() => props.changes.onStage("merge", paths)}
            >
              <Plus className="size-3.5" />
            </ToolbarButton>
          ) : null}
        </span>
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-info px-1 text-[9px] font-semibold text-white tabular-nums group-hover/group:hidden">
          {props.entries.length}
        </span>
      </div>
      {collapsed ? null : (
        <div className="min-w-0">
          {rows.map((row) =>
            row.kind === "directory" ? (
              <DirectoryRow
                key={`dir:${row.id}`}
                label={row.label}
                depth={row.depth}
                group={props.id}
                entries={row.entries}
                collapsed={collapsedDirectories.has(row.path)}
                onToggle={() =>
                  setCollapsedDirectories((current) => {
                    const next = new Set(current);
                    if (next.has(row.path)) next.delete(row.path);
                    else next.add(row.path);
                    return next;
                  })
                }
                onStage={() =>
                  props.changes.onStage(
                    props.id,
                    row.entries.map((entry) => entry.path),
                  )
                }
                onUnstage={() => props.changes.onUnstage(unstagePaths(row.entries))}
                onDiscard={() => props.changes.onDiscard(row.entries)}
              />
            ) : (
              <FileRow
                key={`file:${props.id}:${row.entry.path}`}
                entry={row.entry}
                label={row.label}
                depth={row.depth}
                group={props.id}
                showDirectory={!props.viewAsTree}
                onOpenDiff={() => props.changes.onOpenDiff(row.entry, staged)}
                onOpenFile={() => props.changes.onOpenFile(row.entry.path)}
                onOpenTimeline={() => props.changes.onOpenTimeline(row.entry.path)}
                onPrimaryAction={() =>
                  staged
                    ? props.changes.onUnstage(unstagePaths([row.entry]))
                    : props.changes.onStage(props.id, [row.entry.path])
                }
                onDiscard={() => props.changes.onDiscard([row.entry])}
                onStash={() => props.changes.onStash([row.entry.path])}
                onAcceptOurs={() => props.changes.onAcceptSide("ours", [row.entry.path])}
                onAcceptTheirs={() => props.changes.onAcceptSide("theirs", [row.entry.path])}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function SourceControlChanges(props: SourceControlChangesProps) {
  const { status } = props;
  const branchLabel = status.repository.branch ?? status.repository.headSha ?? "HEAD";
  const disabledReason = commitDisabledReason({
    message: props.message,
    stagedCount: status.staged.length,
    changesCount: status.changes.length,
    mergeCount: status.merge.length,
    amend: props.amend,
    busy: props.busy,
  });
  const label = commitButtonLabel({
    stagedCount: status.staged.length,
    changesCount: status.changes.length,
    amend: props.amend,
  });

  return (
    <div className="flex min-w-0 flex-col gap-2 px-2 pb-2">
      <div className="flex flex-col gap-1.5">
        <Textarea
          value={props.message}
          onChange={(event) => props.onMessageChange(event.target.value)}
          placeholder={`Message (Ctrl+Enter to commit on "${branchLabel}")`}
          aria-label="Commit message"
          rows={1}
          className="max-h-40 min-h-8 resize-y py-1.5 text-xs"
          onKeyDown={(event) => {
            if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
            event.preventDefault();
            if (disabledReason === null) props.onCommit({ push: false, sync: false });
          }}
        />
        <div className="flex min-w-0 items-stretch gap-px">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  className="min-w-0 flex-1 rounded-r-none"
                  disabled={disabledReason !== null}
                  onClick={() => props.onCommit({ push: false, sync: false })}
                />
              }
            >
              <Check className="size-3.5" />
              <span className="truncate">{label}</span>
            </TooltipTrigger>
            <TooltipPopup>{disabledReason ?? `${label} on "${branchLabel}"`}</TooltipPopup>
          </Tooltip>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  aria-label="More commit actions"
                  className="rounded-l-none px-1.5"
                  disabled={props.busy}
                />
              }
            >
              <ChevronDown className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-56">
              <MenuItem onClick={() => props.onCommit({ push: true, sync: false })}>
                Commit &amp; Push
              </MenuItem>
              <MenuItem onClick={() => props.onCommit({ push: false, sync: true })}>
                Commit &amp; Sync
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => props.onAmendChange(!props.amend)}>
                {props.amend ? "Cancel Amend" : "Amend Last Commit"}
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>

      <div className="flex items-center justify-end gap-0.5">
        <ToolbarButton
          label={props.viewAsTree ? "View as List" : "View as Tree"}
          onClick={() => props.onViewAsTreeChange(!props.viewAsTree)}
        >
          {props.viewAsTree ? <ListIcon className="size-3.5" /> : <ListTree className="size-3.5" />}
        </ToolbarButton>
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Views and more actions"
              />
            }
          >
            <MoreHorizontal className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-52">
            <MenuItem onClick={() => props.onStash([])}>Stash All Changes</MenuItem>
            <MenuItem onClick={() => props.onStage("changes", [])}>Stage All Changes</MenuItem>
            <MenuItem onClick={() => props.onUnstage([])}>Unstage All Changes</MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => props.onDiscard(status.changes)}>Discard All Changes</MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      {status.merge.length + status.staged.length + status.changes.length === 0 ? (
        <p className="px-1 py-4 text-center text-muted-foreground text-xs">There are no changes.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <ChangeGroup
            id="merge"
            entries={status.merge}
            viewAsTree={props.viewAsTree}
            changes={props}
          />
          <ChangeGroup
            id="staged"
            entries={status.staged}
            viewAsTree={props.viewAsTree}
            changes={props}
          />
          <ChangeGroup
            id="changes"
            entries={status.changes}
            viewAsTree={props.viewAsTree}
            changes={props}
          />
        </div>
      )}
    </div>
  );
}
