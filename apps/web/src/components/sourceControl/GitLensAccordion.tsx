/**
 * The GitLens accordion.
 *
 * GitLens groups a set of related views into one section of the Source Control
 * container and switches between them from the section header. This rebuilds
 * that grouping — Commits, Branches, Remotes, Stashes, Tags, Worktrees,
 * Contributors and File History — over T3 Code's own git service. It is a
 * reimplementation of the accordion's behaviour, not a port of GitLens code.
 */
import type {
  ScmBranchNode,
  ScmCommit,
  ScmLogResult,
  ScmStatusResult,
  ScmTimelineResult,
  ScmViewResult,
} from "@t3tools/contracts";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Cloud,
  FileClock,
  GitBranch,
  GitCommitHorizontal,
  Inbox,
  RefreshCw,
  Tag,
  TreePalm,
  Users,
} from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { useScmContextMenu } from "./useScmContextMenu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { formatScmAbsoluteTime, formatScmRelativeTime } from "./sourceControlPanel.logic";

export const GITLENS_VIEWS = [
  { id: "commits", label: "Commits", icon: GitCommitHorizontal },
  { id: "branches", label: "Branches", icon: GitBranch },
  { id: "remotes", label: "Remotes", icon: Cloud },
  { id: "stashes", label: "Stashes", icon: Inbox },
  { id: "tags", label: "Tags", icon: Tag },
  { id: "worktrees", label: "Worktrees", icon: TreePalm },
  { id: "contributors", label: "Contributors", icon: Users },
  { id: "file-history", label: "File History", icon: FileClock },
] as const;

export type GitLensViewId = (typeof GITLENS_VIEWS)[number]["id"];

function Row(props: {
  readonly icon?: React.ReactNode;
  readonly title: string;
  readonly detail?: string;
  readonly trailing?: string;
  readonly muted?: boolean;
  readonly onClick?: () => void;
  readonly onContextMenu?: React.ReactNode;
  readonly indent?: number;
}) {
  const content = (
    <>
      {props.icon ? <span className="shrink-0">{props.icon}</span> : null}
      <span
        className={cn(
          "min-w-0 shrink truncate text-xs",
          props.muted ? "text-muted-foreground" : "text-foreground/90",
        )}
      >
        {props.title}
      </span>
      {props.detail ? (
        <span className="min-w-0 shrink truncate text-[11px] text-muted-foreground">
          {props.detail}
        </span>
      ) : null}
      {props.trailing ? (
        <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground tabular-nums">
          {props.trailing}
        </span>
      ) : null}
    </>
  );
  const className = cn(
    "flex h-6 w-full items-center gap-1.5 rounded-sm pr-2 text-left",
    props.onClick && "cursor-pointer hover:bg-accent/60",
  );
  const style = { paddingLeft: `${8 + (props.indent ?? 0) * 12}px` };
  if (!props.onClick) {
    return (
      <div className={className} style={style}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" className={className} style={style} onClick={props.onClick}>
      {content}
    </button>
  );
}

function CommitsView(props: {
  readonly status: ScmStatusResult;
  readonly log: ScmLogResult | null;
  readonly isPending: boolean;
  readonly onSelectCommit: (commit: ScmCommit) => void;
  readonly onRemoteAction: (action: "fetch" | "pull" | "push") => void;
}) {
  const repository = props.status.repository;
  const upstreamLabel = repository.upstream
    ? repository.ahead === 0 && repository.behind === 0
      ? `Up to date with ${repository.upstream}`
      : `${repository.behind} behind, ${repository.ahead} ahead of ${repository.upstream}`
    : "No upstream branch";

  return (
    <div className="min-w-0">
      <Row
        icon={<Cloud className="size-3.5 text-muted-foreground" />}
        title={upstreamLabel}
        muted
      />
      {repository.upstream ? (
        <Row
          icon={<GitBranch className="size-3.5 text-muted-foreground" />}
          title={`Compare ${repository.branch ?? "HEAD"} with ${repository.upstream}`}
          muted
        />
      ) : null}
      {(props.log?.commits ?? []).map((commit) => (
        <Row
          key={commit.sha}
          icon={<GitCommitHorizontal className="size-3.5 text-muted-foreground" />}
          title={commit.subject || "(no message)"}
          detail={`${commit.authorName}, ${formatScmRelativeTime(commit.authorDate)}`}
          onClick={() => props.onSelectCommit(commit)}
        />
      ))}
      {props.log && props.log.commits.length === 0 ? (
        <p className="px-3 py-3 text-muted-foreground text-xs">
          {props.isPending ? "Loading commits…" : "No commits yet."}
        </p>
      ) : null}
    </div>
  );
}

function BranchRow(props: { readonly branch: ScmBranchNode; readonly onCheckout: () => void }) {
  const { branch } = props;
  const showContextMenu = useScmContextMenu();
  const track =
    branch.ahead === 0 && branch.behind === 0
      ? undefined
      : `${branch.behind > 0 ? `\u2193${branch.behind}` : ""}${branch.ahead > 0 ? `\u2191${branch.ahead}` : ""}`;
  return (
    <button
      type="button"
      className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-sm pr-2 pl-2 text-left hover:bg-accent/60"
      onClick={props.onCheckout}
      onContextMenu={(event) => {
        event.preventDefault();
        void showContextMenu([{ id: "checkout", label: "Switch to Branch", icon: "git-branch" }], {
          x: event.clientX,
          y: event.clientY,
        }).then((clicked) => {
          if (clicked === "checkout") props.onCheckout();
        });
      }}
    >
      <GitBranch
        className={cn("size-3.5 shrink-0", branch.current ? "text-info" : "text-muted-foreground")}
      />
      <span
        className={cn(
          "min-w-0 shrink truncate text-xs",
          branch.current ? "font-medium text-foreground" : "text-foreground/90",
        )}
      >
        {branch.name}
      </span>
      {track ? (
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{track}</span>
      ) : null}
      {branch.worktreePath ? <TreePalm className="size-3 shrink-0 text-muted-foreground" /> : null}
      <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground tabular-nums">
        {formatScmRelativeTime(branch.authorDate)}
      </span>
    </button>
  );
}

/** A stash row, with apply and drop behind its context menu. */
function StashRow(props: {
  readonly label: string;
  readonly date: string;
  readonly onApply: () => void;
  readonly onDrop: () => void;
}) {
  const showContextMenu = useScmContextMenu();
  return (
    <button
      type="button"
      className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-sm pr-2 pl-2 text-left hover:bg-accent/60"
      onClick={props.onApply}
      onContextMenu={(event) => {
        event.preventDefault();
        void showContextMenu(
          [
            { id: "apply", label: "Apply Stash" },
            { id: "drop", label: "Drop Stash", destructive: true, separatorBefore: true },
          ],
          { x: event.clientX, y: event.clientY },
        ).then((clicked) => {
          if (clicked === "apply") props.onApply();
          else if (clicked === "drop") props.onDrop();
        });
      }}
    >
      <Inbox className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 shrink truncate text-foreground/90 text-xs">{props.label}</span>
      <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground tabular-nums">
        {formatScmRelativeTime(props.date)}
      </span>
    </button>
  );
}

export interface GitLensAccordionProps {
  readonly view: GitLensViewId;
  readonly onViewChange: (view: GitLensViewId) => void;
  readonly status: ScmStatusResult;
  readonly log: ScmLogResult | null;
  readonly logPending: boolean;
  readonly viewData: ScmViewResult | null;
  readonly viewPending: boolean;
  readonly viewError: string | null;
  readonly fileHistory: ScmTimelineResult | null;
  readonly fileHistoryPath: string | null;
  readonly onRefresh: () => void;
  readonly onSelectCommit: (commit: ScmCommit) => void;
  readonly onCheckoutBranch: (name: string) => void;
  readonly onApplyStash: (ref: string) => void;
  readonly onDropStash: (ref: string) => void;
  readonly onRemoteAction: (action: "fetch" | "pull" | "push") => void;
  readonly onOpenTimelineEntry: (path: string, sha: string) => void;
}

export function GitLensAccordion(props: GitLensAccordionProps) {
  const [showAllViews, setShowAllViews] = useState(false);
  const active = GITLENS_VIEWS.find((entry) => entry.id === props.view) ?? GITLENS_VIEWS[0];
  // The header shows a handful of switchers inline and the rest behind the
  // overflow, the way GitLens does when the sidebar is narrow.
  const inlineViews = showAllViews ? GITLENS_VIEWS : GITLENS_VIEWS.slice(0, 6);

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-0.5 px-2 pb-1">
        <span className="shrink-0 pr-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          {active.label}
        </span>
        {props.status.repository.branch ? (
          <span className="min-w-0 shrink truncate text-[11px] text-muted-foreground">
            {props.status.repository.branch}
          </span>
        ) : null}
        <span className="min-w-0 flex-1" />
        {props.view === "commits" ? (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label="Push"
                    onClick={() => props.onRemoteAction("push")}
                  />
                }
              >
                <ArrowUpFromLine className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup>Push</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label="Pull"
                    onClick={() => props.onRemoteAction("pull")}
                  />
                }
              >
                <ArrowDownToLine className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup>Pull</TooltipPopup>
            </Tooltip>
          </>
        ) : null}
        {inlineViews.map((entry) => {
          const Icon = entry.icon;
          return (
            <Tooltip key={entry.id}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={entry.id === props.view ? "ghost" : "ghost-muted"}
                    size="icon-xs"
                    aria-label={entry.label}
                    aria-pressed={entry.id === props.view}
                    onClick={() => props.onViewChange(entry.id)}
                  />
                }
              >
                <Icon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup>{entry.label}</TooltipPopup>
            </Tooltip>
          );
        })}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Refresh"
                onClick={props.onRefresh}
              />
            }
          >
            <RefreshCw className={cn("size-3.5", props.viewPending && "animate-spin")} />
          </TooltipTrigger>
          <TooltipPopup>Refresh</TooltipPopup>
        </Tooltip>
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Show or hide views"
              />
            }
          >
            <span aria-hidden="true" className="text-sm leading-none">
              ⋯
            </span>
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-48">
            {GITLENS_VIEWS.map((entry) => (
              <MenuItem key={entry.id} onClick={() => props.onViewChange(entry.id)}>
                {entry.label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onClick={() => setShowAllViews((value) => !value)}>
              {showAllViews ? "Show Fewer Buttons" : "Show All Buttons"}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      {props.viewError ? (
        <p className="px-3 py-3 text-destructive-foreground text-xs">{props.viewError}</p>
      ) : props.view === "commits" ? (
        <CommitsView
          status={props.status}
          log={props.log}
          isPending={props.logPending}
          onSelectCommit={props.onSelectCommit}
          onRemoteAction={props.onRemoteAction}
        />
      ) : props.view === "file-history" ? (
        <div className="min-w-0">
          {props.fileHistoryPath === null ? (
            <p className="px-3 py-3 text-muted-foreground text-xs">
              Open a file to see its history.
            </p>
          ) : (
            <>
              <Row
                icon={<FileClock className="size-3.5 text-muted-foreground" />}
                title={props.fileHistoryPath}
                muted
              />
              {(props.fileHistory?.entries ?? []).map((entry) => (
                <Row
                  key={entry.sha}
                  indent={1}
                  icon={<GitCommitHorizontal className="size-3.5 text-muted-foreground" />}
                  title={entry.subject || "(no message)"}
                  detail={entry.authorName}
                  trailing={formatScmRelativeTime(entry.authorDate)}
                  onClick={() => props.onOpenTimelineEntry(props.fileHistoryPath ?? "", entry.sha)}
                />
              ))}
              {props.fileHistory && props.fileHistory.entries.length === 0 ? (
                <p className="px-3 py-3 text-muted-foreground text-xs">
                  No commits touch this file yet.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : props.viewData === null ? (
        <p className="px-3 py-3 text-muted-foreground text-xs">
          {props.viewPending ? "Loading…" : "Nothing to show."}
        </p>
      ) : props.viewData._tag === "branches" ? (
        <div className="min-w-0">
          {props.viewData.branches.map((branch) => (
            <BranchRow
              key={branch.name}
              branch={branch}
              onCheckout={() => props.onCheckoutBranch(branch.name)}
            />
          ))}
        </div>
      ) : props.viewData._tag === "remotes" ? (
        <div className="min-w-0">
          {props.viewData.remotes.map((remote) => (
            <Row
              key={remote.name}
              icon={<Cloud className="size-3.5 text-muted-foreground" />}
              title={remote.name}
              detail={remote.fetchUrl ?? remote.pushUrl ?? ""}
              trailing={`${remote.branchCount}`}
            />
          ))}
          {props.viewData.remotes.length === 0 ? (
            <p className="px-3 py-3 text-muted-foreground text-xs">No remotes configured.</p>
          ) : null}
        </div>
      ) : props.viewData._tag === "stashes" ? (
        <div className="min-w-0">
          {props.viewData.stashes.map((stash) => (
            <StashRow
              key={stash.ref}
              label={stash.message || stash.ref}
              date={stash.date}
              onApply={() => props.onApplyStash(stash.ref)}
              onDrop={() => props.onDropStash(stash.ref)}
            />
          ))}
          {props.viewData.stashes.length === 0 ? (
            <p className="px-3 py-3 text-muted-foreground text-xs">No stashes.</p>
          ) : null}
        </div>
      ) : props.viewData._tag === "tags" ? (
        <div className="min-w-0">
          {props.viewData.tags.map((tag) => (
            <Row
              key={tag.name}
              icon={<Tag className="size-3.5 text-muted-foreground" />}
              title={tag.name}
              detail={tag.subject}
              trailing={formatScmRelativeTime(tag.date)}
            />
          ))}
          {props.viewData.tags.length === 0 ? (
            <p className="px-3 py-3 text-muted-foreground text-xs">No tags.</p>
          ) : null}
        </div>
      ) : props.viewData._tag === "worktrees" ? (
        <div className="min-w-0">
          {props.viewData.worktrees.map((worktree) => (
            <Row
              key={worktree.path}
              icon={<TreePalm className="size-3.5 text-muted-foreground" />}
              title={worktree.branch ?? worktree.sha.slice(0, 7)}
              detail={worktree.path}
              {...(worktree.isCurrent
                ? { trailing: "current" }
                : worktree.isMain
                  ? { trailing: "main" }
                  : {})}
            />
          ))}
        </div>
      ) : (
        <div className="min-w-0">
          {props.viewData.contributors.map((contributor) => (
            <Row
              key={`${contributor.email}:${contributor.name}`}
              icon={<Users className="size-3.5 text-muted-foreground" />}
              title={contributor.name || contributor.email}
              detail={`${contributor.commitCount} ${contributor.commitCount === 1 ? "commit" : "commits"}`}
              trailing={formatScmRelativeTime(contributor.latestDate)}
            />
          ))}
          {props.viewData.contributors.length === 0 ? (
            <p className="px-3 py-3 text-muted-foreground text-xs">No contributors yet.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Long-form hover text for a commit, matching GitLens's card. */
export function commitHoverText(commit: ScmCommit): string {
  return [
    `${commit.authorName} · ${formatScmRelativeTime(commit.authorDate)} (${formatScmAbsoluteTime(commit.authorDate)})`,
    commit.shortSha,
    "",
    commit.subject,
    commit.body,
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();
}
