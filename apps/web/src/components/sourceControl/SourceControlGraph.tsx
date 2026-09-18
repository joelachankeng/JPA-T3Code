/**
 * The Source Control Graph accordion.
 *
 * One row per commit with a drawn gutter on the left. A repository whose
 * history is linear — no merge commits, as a project without pull requests
 * will be — renders a single straight lane, which is the correct picture
 * rather than a degenerate one.
 */
import type { ScmCommit, ScmCommitRef, ScmLogResult } from "@t3tools/contracts";
import { GitBranch, Cloud, Tag, RefreshCw } from "lucide-react";
import { memo, useMemo } from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import {
  buildGraphRows,
  formatScmAbsoluteTime,
  formatScmRelativeTime,
  graphWidth,
  type GraphRow,
} from "./sourceControlPanel.logic";

const LANE_WIDTH = 12;
const ROW_HEIGHT = 22;
const DOT_RADIUS = 3.5;

/**
 * Lane colours cycle so two branches drawn side by side stay distinguishable.
 * These are theme tokens rather than literals so the graph follows the palette.
 */
const LANE_COLORS = [
  "var(--info)",
  "var(--success)",
  "var(--warning)",
  "var(--destructive)",
  "var(--primary)",
] as const;

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] ?? LANE_COLORS[0];
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/**
 * The gutter for one row. Lines are drawn from the top edge to the row's
 * centre for every lane already live above it, and from the centre to the
 * bottom edge for every lane that continues below, so consecutive rows join up
 * without needing a single tall SVG over the whole list.
 */
/* oxlint-disable react/no-array-index-key -- a lane's index is its identity in the gutter. */
const GraphCell = memo(function GraphCell(props: {
  readonly row: GraphRow;
  readonly width: number;
  readonly isHead: boolean;
}) {
  const { row } = props;
  const half = ROW_HEIGHT / 2;
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      width={props.width * LANE_WIDTH}
      height={ROW_HEIGHT}
    >
      {row.incoming.map((sha, lane) =>
        sha === null || sha === row.sha ? null : (
          <line
            key={`in:${lane}`}
            x1={laneX(lane)}
            y1={0}
            x2={laneX(lane)}
            y2={half}
            stroke={laneColor(lane)}
            strokeWidth={1.5}
            strokeOpacity={0.75}
          />
        ),
      )}
      {/* A lane above that resolves into this commit bends into its dot. */}
      {row.incoming.map((sha, lane) =>
        sha === row.sha ? (
          <path
            key={`bend:${lane}`}
            d={
              lane === row.lane
                ? `M ${laneX(lane)} 0 L ${laneX(lane)} ${half}`
                : `M ${laneX(lane)} 0 L ${laneX(lane)} ${half - 4} Q ${laneX(lane)} ${half} ${laneX(row.lane)} ${half}`
            }
            fill="none"
            stroke={laneColor(lane)}
            strokeWidth={1.5}
            strokeOpacity={0.75}
          />
        ) : null,
      )}
      {row.outgoing.map((sha, lane) =>
        sha === null || row.parentLanes.includes(lane) ? null : (
          <line
            key={`out:${lane}`}
            x1={laneX(lane)}
            y1={half}
            x2={laneX(lane)}
            y2={ROW_HEIGHT}
            stroke={laneColor(lane)}
            strokeWidth={1.5}
            strokeOpacity={0.75}
          />
        ),
      )}
      {/* Each parent leaves the dot toward the lane it continues in. */}
      {row.parentLanes.map((lane) => (
        <path
          key={`parent:${lane}`}
          d={
            lane === row.lane
              ? `M ${laneX(lane)} ${half} L ${laneX(lane)} ${ROW_HEIGHT}`
              : `M ${laneX(row.lane)} ${half} Q ${laneX(lane)} ${half} ${laneX(lane)} ${half + 4} L ${laneX(lane)} ${ROW_HEIGHT}`
          }
          fill="none"
          stroke={laneColor(lane)}
          strokeWidth={1.5}
          strokeOpacity={0.75}
        />
      ))}
      <circle
        cx={laneX(row.lane)}
        cy={half}
        r={DOT_RADIUS}
        fill={props.isHead ? "var(--background)" : laneColor(row.lane)}
        stroke={laneColor(row.lane)}
        strokeWidth={props.isHead ? 2 : 0}
      />
    </svg>
  );
});
/* oxlint-enable react/no-array-index-key */

function RefChip(props: { readonly refEntry: ScmCommitRef }) {
  const { refEntry } = props;
  const Icon = refEntry.kind === "tag" ? Tag : refEntry.kind === "remote" ? Cloud : GitBranch;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex max-w-32 shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px font-medium text-[10px]",
              refEntry.kind === "head"
                ? "bg-info text-white"
                : refEntry.kind === "tag"
                  ? "bg-warning/20 text-warning"
                  : "bg-accent text-foreground/80",
            )}
          />
        }
      >
        <Icon className="size-2.5 shrink-0" />
        <span className="truncate">{refEntry.name}</span>
      </TooltipTrigger>
      <TooltipPopup>{refEntry.name}</TooltipPopup>
    </Tooltip>
  );
}

export interface SourceControlGraphProps {
  readonly log: ScmLogResult | null;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly allBranches: boolean;
  readonly onAllBranchesChange: (value: boolean) => void;
  readonly onRefresh: () => void;
  readonly onSelectCommit: (commit: ScmCommit) => void;
  readonly onLoadMore: (() => void) | null;
  readonly selectedSha: string | null;
}

export function SourceControlGraph(props: SourceControlGraphProps) {
  const commits = props.log?.commits ?? [];
  const rows = useMemo(() => buildGraphRows(commits), [commits]);
  const width = useMemo(() => graphWidth(rows), [rows]);

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-1 px-2 pb-1">
        <Menu>
          <MenuTrigger
            render={
              <Button type="button" variant="ghost-muted" size="xs" className="gap-1">
                <GitBranch className="size-3" />
              </Button>
            }
          >
            <span className="text-[11px]">{props.allBranches ? "All" : "Auto"}</span>
          </MenuTrigger>
          <MenuPopup align="start" className="min-w-44">
            <MenuItem onClick={() => props.onAllBranchesChange(false)}>
              Current Branch Only
            </MenuItem>
            <MenuItem onClick={() => props.onAllBranchesChange(true)}>All Branches</MenuItem>
          </MenuPopup>
        </Menu>
        <span className="min-w-0 flex-1" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Refresh graph"
                onClick={props.onRefresh}
              />
            }
          >
            <RefreshCw className={cn("size-3.5", props.isPending && "animate-spin")} />
          </TooltipTrigger>
          <TooltipPopup>Refresh</TooltipPopup>
        </Tooltip>
      </div>

      {props.error ? (
        <p className="px-3 py-3 text-destructive-foreground text-xs">{props.error}</p>
      ) : commits.length === 0 ? (
        <p className="px-3 py-3 text-muted-foreground text-xs">
          {props.isPending ? "Loading history…" : "No commits yet."}
        </p>
      ) : (
        <div className="min-w-0">
          {props.log?.hasWorkingTreeChanges ? (
            <div
              className="flex items-center gap-1.5 px-2 text-muted-foreground text-xs italic"
              style={{ height: ROW_HEIGHT }}
            >
              <span aria-hidden="true" className="shrink-0" style={{ width: width * LANE_WIDTH }} />
              Uncommitted changes
            </div>
          ) : null}
          {commits.map((commit, index) => {
            const row = rows[index];
            if (!row) return null;
            const isHead = commit.refs.some((entry) => entry.kind === "head");
            return (
              <Tooltip key={commit.sha}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className={cn(
                        "flex w-full min-w-0 cursor-pointer items-center gap-1.5 px-2 text-left hover:bg-accent/60",
                        props.selectedSha === commit.sha && "bg-accent",
                      )}
                      style={{ height: ROW_HEIGHT }}
                      onClick={() => props.onSelectCommit(commit)}
                    />
                  }
                >
                  <GraphCell row={row} width={width} isHead={isHead} />
                  <span
                    className={cn(
                      "min-w-0 shrink truncate text-xs",
                      isHead ? "font-medium text-foreground" : "text-foreground/85",
                    )}
                  >
                    {commit.subject || "(no message)"}
                  </span>
                  {commit.refs.map((refEntry) => (
                    <RefChip key={`${refEntry.kind}:${refEntry.name}`} refEntry={refEntry} />
                  ))}
                  <span className="ml-auto shrink-0 truncate text-[11px] text-muted-foreground">
                    {commit.authorName}
                  </span>
                  <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {formatScmRelativeTime(commit.authorDate)}
                  </span>
                </TooltipTrigger>
                {/* The same facts GitLens puts in its own hover card. */}
                <TooltipPopup className="max-w-96">
                  <span className="flex flex-col gap-0.5 text-left">
                    <span className="font-medium">{commit.subject || "(no message)"}</span>
                    <span className="text-muted-foreground">
                      {commit.authorName} · {formatScmAbsoluteTime(commit.authorDate)}
                    </span>
                    <span className="font-mono text-muted-foreground">{commit.shortSha}</span>
                  </span>
                </TooltipPopup>
              </Tooltip>
            );
          })}
          {props.onLoadMore ? (
            <div className="px-2 py-1">
              <Button
                type="button"
                variant="ghost-muted"
                size="xs"
                className="w-full"
                onClick={props.onLoadMore}
                disabled={props.isPending}
              >
                {props.isPending ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
