import type { ScmCommit, ScmFileEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildGraphRows,
  buildListRows,
  buildTreeRows,
  canOpenFile,
  commitButtonLabel,
  commitDisabledReason,
  folderToneClassName,
  formatScmRelativeTime,
  graphWidth,
  statusLetter,
  statusTitle,
  syncLabel,
} from "./sourceControlPanel.logic";

function entry(path: string, overrides: Partial<ScmFileEntry> = {}): ScmFileEntry {
  return {
    path,
    previousPath: null,
    index: "unmodified",
    worktree: "modified",
    conflicted: false,
    insertions: 0,
    deletions: 0,
    ...overrides,
  };
}

function commit(sha: string, parents: readonly string[]): ScmCommit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents,
    subject: sha,
    body: "",
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate: "2026-09-01T00:00:00Z",
    committerName: "Ada",
    committerDate: "2026-09-01T00:00:00Z",
    refs: [],
  };
}

describe("statusLetter", () => {
  it("prefers the worktree side, which is what the row is showing", () => {
    expect(statusLetter({ index: "added", worktree: "modified" })).toBe("M");
  });

  it("falls back to the index side for a staged-only change", () => {
    expect(statusLetter({ index: "added", worktree: "unmodified" })).toBe("A");
    expect(statusLetter({ index: "renamed", worktree: "unmodified" })).toBe("R");
  });

  it("uses U for an untracked file, as VS Code does", () => {
    expect(statusLetter({ index: "unmodified", worktree: "untracked" })).toBe("U");
  });
});

describe("statusTitle", () => {
  it("reports a conflict ahead of the underlying states", () => {
    expect(statusTitle({ index: "modified", worktree: "modified", conflicted: true })).toBe(
      "Conflicted",
    );
  });

  it("names the state a row is showing", () => {
    expect(statusTitle({ index: "unmodified", worktree: "deleted", conflicted: false })).toBe(
      "Deleted",
    );
  });
});

describe("buildListRows", () => {
  it("emits one flat row per file", () => {
    const rows = buildListRows([entry("src/a.ts"), entry("docs/b.md")]);
    expect(rows.map((row) => [row.kind, row.label])).toEqual([
      ["file", "a.ts"],
      ["file", "b.md"],
    ]);
    expect(rows.every((row) => row.depth === 0)).toBe(true);
  });
});

describe("buildTreeRows", () => {
  it("nests files under their directories", () => {
    const rows = buildTreeRows([entry("src/a.ts"), entry("src/b.ts")], new Set());
    expect(rows.map((row) => [row.kind, row.label, row.depth])).toEqual([
      ["directory", "src", 0],
      ["file", "a.ts", 1],
      ["file", "b.ts", 1],
    ]);
  });

  it("compacts a chain of single-child directories into one row", () => {
    const rows = buildTreeRows([entry("src/components/ui/button.tsx")], new Set());
    expect(rows[0]).toMatchObject({
      kind: "directory",
      label: "src/components/ui",
      path: "src/components/ui",
    });
    expect(rows[1]).toMatchObject({ kind: "file", label: "button.tsx" });
  });

  it("stops descending into a collapsed directory but keeps its row", () => {
    const rows = buildTreeRows([entry("src/a.ts"), entry("docs/b.md")], new Set(["src"]));
    expect(rows.map((row) => row.label)).toEqual(["docs", "b.md", "src"]);
  });

  it("counts every file below a directory, including nested ones", () => {
    const rows = buildTreeRows(
      [entry("src/a.ts"), entry("src/deep/b.ts"), entry("src/deep/c.ts")],
      new Set(["src"]),
    );
    expect(rows[0]).toMatchObject({ kind: "directory", fileCount: 3 });
  });

  it("puts root-level files after the directories", () => {
    const rows = buildTreeRows([entry("README.md"), entry("src/a.ts")], new Set());
    expect(rows.map((row) => row.label)).toEqual(["src", "a.ts", "README.md"]);
  });
});

describe("buildGraphRows", () => {
  it("keeps a history without merges in a single lane", () => {
    const rows = buildGraphRows([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(graphWidth(rows)).toBe(1);
  });

  it("opens a second lane for a merge's other parent and closes it again", () => {
    // m merges b into a; b then rejoins a's history at r.
    const rows = buildGraphRows([
      commit("m", ["a", "b"]),
      commit("a", ["r"]),
      commit("b", ["r"]),
      commit("r", []),
    ]);
    expect(rows[0]?.lane).toBe(0);
    expect(rows[0]?.parentLanes).toEqual([0, 1]);
    expect(rows[1]?.lane).toBe(0);
    expect(rows[2]?.lane).toBe(1);
    // Both lanes wanted `r`, so it lands in the leftmost one and the other closes.
    expect(rows[3]?.lane).toBe(0);
    expect(graphWidth(rows)).toBe(2);
  });

  it("records the lanes live above and below each row", () => {
    const rows = buildGraphRows([commit("b", ["a"]), commit("a", [])]);
    expect(rows[0]?.incoming).toEqual([]);
    expect(rows[0]?.outgoing).toEqual(["a"]);
    expect(rows[1]?.incoming).toEqual(["a"]);
    expect(rows[1]?.outgoing).toEqual([]);
  });

  it("handles an empty history", () => {
    expect(buildGraphRows([])).toEqual([]);
    expect(graphWidth([])).toBe(1);
  });
});

describe("formatScmRelativeTime", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  const ago = (iso: string) => formatScmRelativeTime(iso, now);

  it("uses short units that stay legible in a dense row", () => {
    expect(ago("2026-09-17T11:59:30Z")).toBe("now");
    expect(ago("2026-09-17T11:45:00Z")).toBe("15 min");
    expect(ago("2026-09-17T09:00:00Z")).toBe("3 hr");
    expect(ago("2026-09-16T12:00:00Z")).toBe("1 day");
    expect(ago("2026-09-14T12:00:00Z")).toBe("3 days");
  });

  it("switches to weeks, months and years rather than a large day count", () => {
    expect(ago("2026-09-03T12:00:00Z")).toBe("2 wks");
    expect(ago("2026-06-17T12:00:00Z")).toBe("3 mos");
    expect(ago("2024-09-17T12:00:00Z")).toBe("2 yrs");
  });

  it("returns nothing for an unparseable date", () => {
    expect(ago("not a date")).toBe("");
  });
});

describe("commitButtonLabel", () => {
  it("reads Commit whether or not anything is staged, as VS Code does", () => {
    expect(commitButtonLabel({ stagedCount: 0, changesCount: 2, amend: false })).toBe("Commit");
    expect(commitButtonLabel({ stagedCount: 1, changesCount: 2, amend: false })).toBe("Commit");
  });

  it("calls out an amend regardless of what is staged", () => {
    expect(commitButtonLabel({ stagedCount: 0, changesCount: 0, amend: true })).toBe(
      "Commit (Amend)",
    );
  });
});

describe("commitDisabledReason", () => {
  const base = {
    message: "a message",
    stagedCount: 1,
    changesCount: 0,
    mergeCount: 0,
    amend: false,
    busy: false,
  };

  it("allows a commit with a message and staged work", () => {
    expect(commitDisabledReason(base)).toBe(null);
  });

  it("refuses while a git operation is running", () => {
    expect(commitDisabledReason({ ...base, busy: true })).toMatch(/already running/);
  });

  it("refuses while conflicts are unresolved, before checking the message", () => {
    expect(commitDisabledReason({ ...base, message: "", mergeCount: 1 })).toMatch(/conflicts/);
  });

  it("requires a message unless the commit is an amend", () => {
    expect(commitDisabledReason({ ...base, message: "   " })).toMatch(/commit message/);
    expect(commitDisabledReason({ ...base, message: "", amend: true })).toBe(null);
  });

  it("refuses when there is nothing to commit", () => {
    expect(commitDisabledReason({ ...base, stagedCount: 0, changesCount: 0 })).toMatch(
      /no changes/,
    );
  });
});

describe("syncLabel", () => {
  it("offers to publish a branch with no upstream", () => {
    expect(syncLabel({ ahead: 0, behind: 0, upstream: null, branch: "feature" })).toBe(
      'Publish Branch "feature"',
    );
  });

  it("reports an up-to-date branch by its upstream", () => {
    expect(syncLabel({ ahead: 0, behind: 0, upstream: "origin/main", branch: "main" })).toBe(
      "Up to date with origin/main",
    );
  });

  it("counts both directions when the branch has diverged", () => {
    expect(syncLabel({ ahead: 2, behind: 3, upstream: "origin/main", branch: "main" })).toBe(
      "Sync Changes — 3 to pull, 2 to push",
    );
  });
});

describe("canOpenFile", () => {
  it("offers a file that is still on disk", () => {
    expect(canOpenFile({ index: "unmodified", worktree: "modified" })).toBe(true);
    expect(canOpenFile({ index: "unmodified", worktree: "untracked" })).toBe(true);
    expect(canOpenFile({ index: "added", worktree: "unmodified" })).toBe(true);
  });

  it("does not offer a deleted file, staged or not", () => {
    expect(canOpenFile({ index: "unmodified", worktree: "deleted" })).toBe(false);
    expect(canOpenFile({ index: "deleted", worktree: "unmodified" })).toBe(false);
  });
});

describe("buildTreeRows folder entries", () => {
  it("gives a folder every change beneath it, so its actions reach nested files", () => {
    const rows = buildTreeRows(
      [entry("docs/a.md"), entry("docs/deep/b.md"), entry("other.md")],
      new Set(),
    );
    const docs = rows.find((row) => row.kind === "directory" && row.path === "docs");
    expect(docs?.kind === "directory" ? docs.entries.map((item) => item.path) : []).toEqual([
      "docs/a.md",
      "docs/deep/b.md",
    ]);
  });

  it("keeps a collapsed folder's entries, since staging it must still reach them", () => {
    const rows = buildTreeRows([entry("docs/a.md"), entry("docs/b.md")], new Set(["docs"]));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind === "directory" ? rows[0].entries : []).toHaveLength(2);
  });
});

describe("folderToneClassName", () => {
  const tone = (...states: Array<[ScmFileEntry["index"], ScmFileEntry["worktree"]]>) =>
    folderToneClassName(states.map(([index, worktree]) => ({ index, worktree })));

  it("takes the colour of an edit over a new file, as VS Code does", () => {
    expect(tone(["unmodified", "modified"], ["unmodified", "untracked"])).toBe("bg-info");
  });

  it("takes the colour of a new file over a deletion", () => {
    expect(tone(["unmodified", "deleted"], ["unmodified", "untracked"])).toBe("bg-success");
  });

  it("lets a conflict outrank everything", () => {
    expect(tone(["conflicted", "conflicted"], ["unmodified", "modified"])).toBe("bg-warning");
  });

  it("marks a folder that only lost files", () => {
    expect(tone(["unmodified", "deleted"])).toBe("bg-destructive");
  });

  it("reads the staged side for a staged folder", () => {
    expect(tone(["added", "unmodified"])).toBe("bg-success");
  });
});
