/**
 * The Timeline surface: one file's commit history, opened from the Files
 * surface or the Source Control surface with "Open Timeline".
 *
 * VS Code shows this as a section pinned to a file at the bottom of the
 * Explorer. T3 Code's panel model has no sections, so it becomes its own
 * surface keyed by path — which also means two files' timelines can sit beside
 * each other as tabs.
 */
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { EnvironmentId, ScmDiffInput } from "@t3tools/contracts";
import { ArrowLeft, GitCommitHorizontal, RefreshCw, FileClock } from "lucide-react";
import { useMemo, useState } from "react";

import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useTheme } from "~/hooks/useTheme";
import { getRenderablePatch, resolveDiffThemeName, resolveFileDiffPath } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";

import {
  fileName,
  formatScmAbsoluteTime,
  formatScmRelativeTime,
  statusTitle,
} from "./sourceControlPanel.logic";
import { useScmContextMenu } from "./useScmContextMenu";
import { useScmDiff, useScmTimeline, type ScmTarget } from "./useSourceControl";

const PAGE_SIZE = 100;

export interface TimelinePanelProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly onOpenFile: (path: string) => void;
}

/** Which revision of the file the inline diff is showing, if any. */
type TimelineSelection =
  | { kind: "commit"; path: string; sha: string; subject: string }
  | { kind: "working"; path: string };

export function TimelinePanel(props: TimelinePanelProps) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const { resolvedTheme } = useTheme();
  const target: ScmTarget = { environmentId: props.environmentId, cwd: props.cwd };
  const timeline = useScmTimeline(target, props.relativePath, limit);
  const showContextMenu = useScmContextMenu();
  const entries = timeline.data?.entries ?? [];

  const diffInput: Omit<ScmDiffInput, "cwd"> | null = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "working") {
      return { path: selection.path, from: { _tag: "head" }, to: { _tag: "working" } };
    }
    return {
      path: selection.path,
      from: { _tag: "commitParent", sha: selection.sha },
      to: { _tag: "commit", sha: selection.sha },
    };
  }, [selection]);
  const diff = useScmDiff(target, diffInput);
  const renderablePatch = useMemo(
    () => getRenderablePatch(diff.data?.patch, `timeline-diff:${resolvedTheme}`),
    [diff.data?.patch, resolvedTheme],
  );

  if (selection) {
    const title =
      selection.kind === "working"
        ? `${fileName(selection.path)} (Uncommitted)`
        : `${fileName(selection.path)} — ${selection.subject || selection.sha.slice(0, 7)}`;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-8 shrink-0 items-center gap-1.5 border-border/60 border-b px-2">
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Back to timeline"
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
              {diff.isPending ? "Loading diff…" : "This commit made no textual change here."}
            </p>
          )}
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-8 shrink-0 items-center gap-1.5 border-border/60 border-b px-2">
        <FileClock className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium text-foreground text-xs">Timeline</span>
        <Tooltip>
          <TooltipTrigger
            render={<span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" />}
          >
            {fileName(props.relativePath)}
          </TooltipTrigger>
          <TooltipPopup>{props.relativePath}</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Refresh timeline"
                onClick={timeline.refresh}
              />
            }
          >
            <RefreshCw className={cn("size-3.5", timeline.isPending && "animate-spin")} />
          </TooltipTrigger>
          <TooltipPopup>Refresh</TooltipPopup>
        </Tooltip>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="min-w-0 py-1">
          {timeline.error ? (
            <p className="px-3 py-3 text-destructive-foreground text-xs">{timeline.error}</p>
          ) : timeline.data && !timeline.data.tracked ? (
            <p className="px-3 py-3 text-muted-foreground text-xs">
              This file is not tracked by git, so it has no history yet.
            </p>
          ) : (
            <>
              {timeline.data?.hasUncommittedChanges ? (
                <button
                  type="button"
                  className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 text-left hover:bg-accent/60"
                  onClick={() => setSelection({ kind: "working", path: props.relativePath })}
                >
                  <GitCommitHorizontal className="size-3.5 shrink-0 text-warning" />
                  <span className="min-w-0 shrink truncate text-foreground/90 text-xs italic">
                    Uncommitted changes
                  </span>
                  <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
                    now
                  </span>
                </button>
              ) : null}
              {entries.map((entry) => (
                <Tooltip key={entry.sha}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 text-left hover:bg-accent/60"
                        onClick={() =>
                          setSelection({
                            kind: "commit",
                            path: entry.pathAtCommit,
                            sha: entry.sha,
                            subject: entry.subject,
                          })
                        }
                        onContextMenu={(event) => {
                          event.preventDefault();
                          void showContextMenu(
                            [
                              { id: "open-changes", label: "Open Changes" },
                              { id: "open-file", label: "Open File" },
                            ],
                            { x: event.clientX, y: event.clientY },
                          ).then((clicked) => {
                            if (clicked === "open-changes") {
                              setSelection({
                                kind: "commit",
                                path: entry.pathAtCommit,
                                sha: entry.sha,
                                subject: entry.subject,
                              });
                            } else if (clicked === "open-file") {
                              props.onOpenFile(entry.pathAtCommit);
                            }
                          });
                        }}
                      />
                    }
                  >
                    <GitCommitHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 shrink truncate text-foreground/90 text-xs">
                      {entry.subject || "(no message)"}
                    </span>
                    <span className="min-w-0 shrink truncate text-[11px] text-muted-foreground">
                      {entry.authorName}
                    </span>
                    <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground tabular-nums">
                      {formatScmRelativeTime(entry.authorDate)}
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup className="max-w-96">
                    <span className="flex flex-col gap-0.5 text-left">
                      <span className="font-medium">{entry.subject || "(no message)"}</span>
                      <span className="text-muted-foreground">
                        {entry.authorName} · {formatScmAbsoluteTime(entry.authorDate)}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {entry.shortSha} ·{" "}
                        {statusTitle({
                          index: entry.state,
                          worktree: "unmodified",
                          conflicted: false,
                        })}{" "}
                        +{entry.insertions} −{entry.deletions}
                      </span>
                    </span>
                  </TooltipPopup>
                </Tooltip>
              ))}
              {entries.length === 0 && !timeline.isPending ? (
                <p className="px-3 py-3 text-muted-foreground text-xs">
                  No commits touch this file yet.
                </p>
              ) : null}
              {timeline.data?.nextSkip !== null && timeline.data !== null ? (
                <div className="px-2 py-1">
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="xs"
                    className="w-full"
                    disabled={timeline.isPending}
                    onClick={() => setLimit((value) => value + PAGE_SIZE)}
                  >
                    {timeline.isPending ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
