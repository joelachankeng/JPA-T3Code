/**
 * Visual history: one dot per commit that touched a file or folder, placed in
 * time along x and in its author's row along y, sized by how many lines it
 * changed. This is the picture GitLens draws in its Visual File History.
 *
 * Authors are told apart by row, so the dots share one hue rather than
 * spending a colour on identity; the row label carries who. The list mode of
 * the same surface is the table view of this data.
 */
import type { ScmTimelineEntry } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import { formatScmAbsoluteTime } from "./sourceControlPanel.logic";

/** Beyond this many authors the rest share an "Others" row rather than a hue or a row each. */
const MAX_AUTHOR_ROWS = 8;
const ROW_HEIGHT = 28;
const AXIS_HEIGHT = 22;
const LABEL_WIDTH = 96;
const PLOT_PADDING_X = 14;
const MIN_RADIUS = 4;
const MAX_RADIUS = 11;
/** A dot's hit area: comfortably bigger than any dot, so a small one is not a pinpoint. */
const HIT_RADIUS = 12;

export interface VisualHistoryPoint {
  readonly entry: ScmTimelineEntry;
  readonly time: number;
  readonly row: number;
  readonly radius: number;
}

export interface VisualHistoryLayout {
  readonly rows: readonly string[];
  readonly points: readonly VisualHistoryPoint[];
  readonly start: number;
  readonly end: number;
}

/**
 * Place each commit. Rows are ordered by how often the author appears, busiest
 * first; dot area, not radius, grows with lines changed, so a commit twice the
 * size reads as twice the ink.
 */
export function layoutVisualHistory(entries: readonly ScmTimelineEntry[]): VisualHistoryLayout {
  const dated = entries
    .map((entry) => ({ entry, time: Date.parse(entry.authorDate) }))
    .filter((item) => Number.isFinite(item.time));

  const counts = new Map<string, number>();
  for (const { entry } of dated) {
    counts.set(entry.authorName, (counts.get(entry.authorName) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name]) => name);
  const overflow = ranked.length > MAX_AUTHOR_ROWS;
  const named = overflow ? ranked.slice(0, MAX_AUTHOR_ROWS - 1) : ranked;
  const rows = overflow ? [...named, "Others"] : named;
  const rowOf = (author: string) => {
    const index = named.indexOf(author);
    return index === -1 ? rows.length - 1 : index;
  };

  const largest = Math.max(1, ...dated.map(({ entry }) => entry.insertions + entry.deletions));
  const radiusOf = (lines: number) => {
    const share = Math.sqrt(Math.max(0, lines) / largest);
    return MIN_RADIUS + share * (MAX_RADIUS - MIN_RADIUS);
  };

  const times = dated.map((item) => item.time);
  return {
    rows,
    start: times.length > 0 ? Math.min(...times) : 0,
    end: times.length > 0 ? Math.max(...times) : 0,
    points: dated.map(({ entry, time }) => ({
      entry,
      time,
      row: rowOf(entry.authorName),
      radius: radiusOf(entry.insertions + entry.deletions),
    })),
  };
}

/** Evenly spaced tick times across the span, labelled at a resolution that suits it. */
export function timeTicks(start: number, end: number, count: number): number[] {
  if (!(end > start)) return [start];
  const step = (end - start) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, index) => start + step * index);
}

function tickLabel(time: number, span: number, first: boolean): string {
  const date = new Date(time);
  const day = 24 * 60 * 60 * 1000;
  if (span < 2 * day) {
    const clock = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    // Times alone do not say which day; the first tick carries it.
    return first
      ? `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${clock}`
      : clock;
  }
  if (span < 300 * day)
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function VisualHistoryChart(props: {
  readonly entries: readonly ScmTimelineEntry[];
  readonly onSelect: (entry: ScmTimelineEntry) => void;
}) {
  const layout = useMemo(() => layoutVisualHistory(props.entries), [props.entries]);
  const [width, setWidth] = useState(480);
  const [active, setActive] = useState<VisualHistoryPoint | null>(null);
  const hasPoints = layout.points.length > 0;

  // Track the container so the plot fills the panel as it is resized. The
  // callback is stable, so the observer attaches once per mounted container
  // and React runs the returned cleanup when it goes away.
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!hasPoints) {
    return <p className="px-3 py-3 text-muted-foreground text-xs">No commits to chart yet.</p>;
  }

  const plotLeft = LABEL_WIDTH + PLOT_PADDING_X;
  const plotRight = width - PLOT_PADDING_X;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const height = layout.rows.length * ROW_HEIGHT + AXIS_HEIGHT;
  const span = layout.end - layout.start;
  const xOf = (time: number) =>
    span > 0 ? plotLeft + ((time - layout.start) / span) * plotWidth : plotLeft + plotWidth / 2;
  const yOf = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;
  const ticks = timeTicks(
    layout.start,
    layout.end,
    Math.min(5, Math.max(2, Math.floor(plotWidth / 90))),
  );

  // Larger dots first, so a small commit is never buried under a big one.
  const drawOrder = [...layout.points].sort((left, right) => right.radius - left.radius);

  return (
    <div ref={measure} className="relative min-w-0 px-2 pt-2 pb-1">
      <svg
        role="img"
        aria-label={`Visual history: ${layout.points.length} commits by ${layout.rows.length} ${layout.rows.length === 1 ? "author" : "authors"}`}
        width={width}
        height={height}
        className="block max-w-full"
      >
        {layout.rows.map((author, row) => (
          <g key={author}>
            {/* Row guide: hairline, recessive, one step off the surface. */}
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={yOf(row)}
              y2={yOf(row)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={LABEL_WIDTH}
              y={yOf(row)}
              textAnchor="end"
              dominantBaseline="central"
              className="fill-muted-foreground text-[11px]"
            >
              {author.length > 14 ? `${author.slice(0, 13)}…` : author}
            </text>
          </g>
        ))}
        {ticks.map((time, index) => (
          <text
            key={time}
            x={xOf(time)}
            y={layout.rows.length * ROW_HEIGHT + AXIS_HEIGHT - 6}
            textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground text-[10px] tabular-nums"
          >
            {tickLabel(time, span, index === 0)}
          </text>
        ))}
        {drawOrder.map((point) => {
          const isActive = active?.entry.sha === point.entry.sha;
          return (
            <g
              key={point.entry.sha}
              role="button"
              tabIndex={0}
              aria-label={`${point.entry.subject || point.entry.shortSha}, ${point.entry.authorName}, +${point.entry.insertions} −${point.entry.deletions}`}
              className="cursor-pointer outline-none"
              onPointerEnter={() => setActive(point)}
              onPointerLeave={() => setActive((current) => (current === point ? null : current))}
              onFocus={() => setActive(point)}
              onBlur={() => setActive((current) => (current === point ? null : current))}
              onClick={() => props.onSelect(point.entry)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                props.onSelect(point.entry);
              }}
            >
              {/* The hit area: transparent and larger than the mark. */}
              <circle cx={xOf(point.time)} cy={yOf(point.row)} r={HIT_RADIUS} fill="transparent" />
              <circle
                cx={xOf(point.time)}
                cy={yOf(point.row)}
                r={point.radius}
                fill="var(--info)"
                fillOpacity={isActive ? 1 : 0.78}
                // The surface ring keeps overlapping dots legible without a border.
                stroke="var(--background)"
                strokeWidth={isActive ? 3 : 2}
              />
            </g>
          );
        })}
      </svg>
      <p className="px-1 pt-1 text-[10px] text-muted-foreground">
        Dot size shows lines changed. Select a dot to see what that commit changed.
      </p>
      {active ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-border bg-popover px-2.5 py-1.5 text-popover-foreground text-xs shadow-md"
          style={{
            left: Math.min(Math.max(8, xOf(active.time) - 60), Math.max(8, width - 260)),
            top: yOf(active.row) + 18,
          }}
        >
          {/* The numbers lead; the reader already knows whose row it is. */}
          <div className="font-medium tabular-nums">
            <span className="text-success">+{active.entry.insertions}</span>{" "}
            <span className="text-destructive-foreground">−{active.entry.deletions}</span>
          </div>
          <div className="truncate text-foreground/90">
            {active.entry.subject || "(no message)"}
          </div>
          <div className="text-muted-foreground">
            {active.entry.authorName} · {formatScmAbsoluteTime(active.entry.authorDate)}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">{active.entry.shortSha}</div>
        </div>
      ) : null}
    </div>
  );
}
