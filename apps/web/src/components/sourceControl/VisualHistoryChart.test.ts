import type { ScmTimelineEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { layoutVisualHistory, timeTicks } from "./VisualHistoryChart";

function entry(
  sha: string,
  authorName: string,
  authorDate: string,
  lines: { insertions?: number; deletions?: number } = {},
): ScmTimelineEntry {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    subject: sha,
    body: "",
    authorName,
    authorEmail: `${authorName}@example.com`,
    authorDate,
    state: "modified",
    pathAtCommit: "docs",
    insertions: lines.insertions ?? 1,
    deletions: lines.deletions ?? 0,
  };
}

describe("layoutVisualHistory", () => {
  it("gives each author a row, busiest first", () => {
    const layout = layoutVisualHistory([
      entry("a", "Ada", "2026-09-01T00:00:00Z"),
      entry("b", "Grace", "2026-09-02T00:00:00Z"),
      entry("c", "Grace", "2026-09-03T00:00:00Z"),
    ]);
    expect(layout.rows).toEqual(["Grace", "Ada"]);
    expect(layout.points.find((point) => point.entry.sha === "a")?.row).toBe(1);
  });

  it("folds authors past the cap into one Others row instead of adding rows", () => {
    const authors = Array.from({ length: 11 }, (_, index) => `Author ${index}`);
    const layout = layoutVisualHistory(
      authors.map((name, index) =>
        entry(`s${index}`, name, `2026-09-0${(index % 9) + 1}T00:00:00Z`),
      ),
    );
    expect(layout.rows).toHaveLength(8);
    expect(layout.rows.at(-1)).toBe("Others");
    // Everyone past the named seven lands in that last row.
    const othersRow = layout.rows.length - 1;
    expect(layout.points.filter((point) => point.row === othersRow)).toHaveLength(4);
  });

  it("grows a dot's area, not its radius, with lines changed", () => {
    const layout = layoutVisualHistory([
      entry("small", "Ada", "2026-09-01T00:00:00Z", { insertions: 1 }),
      entry("big", "Ada", "2026-09-02T00:00:00Z", { insertions: 100 }),
      entry("quarter", "Ada", "2026-09-03T00:00:00Z", { insertions: 25 }),
    ]);
    const radius = (sha: string) => layout.points.find((point) => point.entry.sha === sha)?.radius;
    // The largest commit gets the largest dot, and every dot stays at or above 8px across.
    expect(radius("big")).toBeGreaterThan(radius("quarter") ?? 0);
    expect(radius("small")).toBeGreaterThanOrEqual(4);
    // A quarter of the lines is half the radius span above the minimum: sqrt(0.25) = 0.5.
    expect(radius("quarter")).toBeCloseTo(4 + 0.5 * (11 - 4), 5);
  });

  it("drops a commit whose date cannot be read rather than placing it at zero", () => {
    const layout = layoutVisualHistory([
      entry("ok", "Ada", "2026-09-01T00:00:00Z"),
      entry("bad", "Ada", "not a date"),
    ]);
    expect(layout.points.map((point) => point.entry.sha)).toEqual(["ok"]);
  });
});

describe("timeTicks", () => {
  it("spans the range evenly, ends included", () => {
    expect(timeTicks(0, 100, 3)).toEqual([0, 50, 100]);
  });

  it("returns a single tick when every commit shares one moment", () => {
    expect(timeTicks(5, 5, 4)).toEqual([5]);
  });
});
