import { describe, expect, it } from "vite-plus/test";

import {
  operationFromMarkers,
  parseCommitRefs,
  parseLogRecords,
  parseNameStatusZ,
  parseNumstatZ,
  parseStatusPorcelainV2,
  remoteProvider,
  splitPerCommitBlocks,
  LOG_FIELD_SEPARATOR,
  LOG_RECORD_SEPARATOR,
} from "./SourceControlPanelGit.ts";

/** Build one porcelain v2 record stream the way `git status -z` emits it. */
function statusOutput(records: readonly string[]): string {
  return `${records.join("\0")}\0`;
}

describe("parseStatusPorcelainV2", () => {
  it("reads the branch header, including ahead and behind counts", () => {
    const parsed = parseStatusPorcelainV2(
      statusOutput([
        "# branch.oid 1234567890abcdef",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +3 -2",
      ]),
    );
    expect(parsed.branch).toBe("main");
    expect(parsed.headSha).toBe("1234567890abcdef");
    expect(parsed.upstream).toBe("origin/main");
    expect(parsed.ahead).toBe(3);
    expect(parsed.behind).toBe(2);
    expect(parsed.detached).toBe(false);
    expect(parsed.unborn).toBe(false);
  });

  it("marks a detached HEAD and an unborn branch", () => {
    const detached = parseStatusPorcelainV2(
      statusOutput(["# branch.oid abc", "# branch.head (detached)"]),
    );
    expect(detached.detached).toBe(true);
    expect(detached.branch).toBe(null);

    const unborn = parseStatusPorcelainV2(
      statusOutput(["# branch.oid (initial)", "# branch.head main"]),
    );
    expect(unborn.unborn).toBe(true);
    expect(unborn.headSha).toBe(null);
  });

  it("puts a file edited in both the index and the worktree into both groups", () => {
    const parsed = parseStatusPorcelainV2(
      statusOutput(["1 MM N... 100644 100644 100644 aaa bbb src/app.ts"]),
    );
    expect(parsed.staged).toEqual([
      {
        path: "src/app.ts",
        previousPath: null,
        index: "modified",
        worktree: "unmodified",
        conflicted: false,
        insertions: 0,
        deletions: 0,
      },
    ]);
    expect(parsed.changes[0]?.path).toBe("src/app.ts");
    expect(parsed.changes[0]?.worktree).toBe("modified");
  });

  it("only lists a staged-only file once", () => {
    const parsed = parseStatusPorcelainV2(
      statusOutput(["1 M. N... 100644 100644 100644 aaa bbb src/app.ts"]),
    );
    expect(parsed.staged).toHaveLength(1);
    expect(parsed.changes).toHaveLength(0);
  });

  it("consumes the extra field a rename record carries", () => {
    // A `2` record is followed by the original path as its own NUL field; a
    // reader that does not consume it treats that path as the next record.
    const parsed = parseStatusPorcelainV2(
      statusOutput([
        "2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts",
        "src/old.ts",
        "? untracked.txt",
      ]),
    );
    expect(parsed.staged).toHaveLength(1);
    expect(parsed.staged[0]?.path).toBe("src/new.ts");
    expect(parsed.staged[0]?.previousPath).toBe("src/old.ts");
    expect(parsed.staged[0]?.index).toBe("renamed");
    expect(parsed.changes.map((entry) => entry.path)).toEqual(["untracked.txt"]);
  });

  it("separates untracked, ignored and conflicted entries", () => {
    const parsed = parseStatusPorcelainV2(
      statusOutput([
        "? new.txt",
        "! build/output.js",
        "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
      ]),
    );
    expect(parsed.changes.map((entry) => entry.path)).toEqual(["new.txt"]);
    expect(parsed.changes[0]?.worktree).toBe("untracked");
    expect(parsed.ignored.map((entry) => entry.path)).toEqual(["build/output.js"]);
    expect(parsed.merge.map((entry) => entry.path)).toEqual(["conflict.ts"]);
    expect(parsed.merge[0]?.conflicted).toBe(true);
  });

  it("keeps a path containing spaces intact", () => {
    const parsed = parseStatusPorcelainV2(
      statusOutput(["1 .M N... 100644 100644 100644 aaa bbb docs/my notes.md"]),
    );
    expect(parsed.changes[0]?.path).toBe("docs/my notes.md");
  });
});

describe("parseCommitRefs", () => {
  it("classifies HEAD, branches, remotes and tags", () => {
    const refs = parseCommitRefs("HEAD -> main, origin/main, tag: v1.2.0, feature/x", ["origin"]);
    expect(refs).toEqual([
      { name: "main", kind: "head" },
      { name: "origin/main", kind: "remote" },
      { name: "v1.2.0", kind: "tag" },
      { name: "feature/x", kind: "branch" },
    ]);
  });

  it("treats a slashed branch name as a branch when no remote matches", () => {
    expect(parseCommitRefs("feature/login", ["origin"])).toEqual([
      { name: "feature/login", kind: "branch" },
    ]);
  });

  it("returns nothing for an undecorated commit", () => {
    expect(parseCommitRefs("", ["origin"])).toEqual([]);
  });
});

describe("parseLogRecords", () => {
  const record = (fields: readonly string[]) =>
    `${LOG_RECORD_SEPARATOR}${fields.join(LOG_FIELD_SEPARATOR)}`;

  it("reads every field, including a multi-line body", () => {
    const output = record([
      "abcdef1234",
      "abcdef1",
      "parent1 parent2",
      "Ada",
      "ada@example.com",
      "2026-08-27T17:25:00+00:00",
      "Ada",
      "2026-08-27T17:26:00+00:00",
      "HEAD -> main",
      "Add the thing",
      "Body line one\nBody line two\n",
    ]);
    const [commit] = parseLogRecords(output, ["origin"]);
    expect(commit?.sha).toBe("abcdef1234");
    expect(commit?.shortSha).toBe("abcdef1");
    expect(commit?.parents).toEqual(["parent1", "parent2"]);
    expect(commit?.authorName).toBe("Ada");
    expect(commit?.subject).toBe("Add the thing");
    expect(commit?.body).toBe("Body line one\nBody line two");
    expect(commit?.refs).toEqual([{ name: "main", kind: "head" }]);
  });

  it("reads several commits and skips empty chunks", () => {
    const output = [
      record(["aaa", "aaa", "", "A", "a@x", "d", "A", "d", "", "first", ""]),
      record(["bbb", "bbb", "aaa", "B", "b@x", "d", "B", "d", "", "second", ""]),
    ].join("");
    expect(parseLogRecords(output, []).map((commit) => commit.sha)).toEqual(["aaa", "bbb"]);
  });

  it("returns nothing for empty output", () => {
    expect(parseLogRecords("", [])).toEqual([]);
  });
});

describe("parseNameStatusZ", () => {
  it("reads simple statuses", () => {
    expect(parseNameStatusZ("M\0src/a.ts\0A\0src/b.ts\0")).toEqual([
      { state: "modified", path: "src/a.ts", previousPath: null },
      { state: "added", path: "src/b.ts", previousPath: null },
    ]);
  });

  it("reads a rename's two paths and keeps reading afterwards", () => {
    expect(parseNameStatusZ("R100\0src/old.ts\0src/new.ts\0D\0gone.ts\0")).toEqual([
      { state: "renamed", path: "src/new.ts", previousPath: "src/old.ts" },
      { state: "deleted", path: "gone.ts", previousPath: null },
    ]);
  });
});

describe("parseNumstatZ", () => {
  it("reads counts for a plain change", () => {
    expect(parseNumstatZ("3\t1\tsrc/a.ts\0")).toEqual([
      { insertions: 3, deletions: 1, path: "src/a.ts", previousPath: null },
    ]);
  });

  it("reads a rename, whose paths follow the record", () => {
    expect(parseNumstatZ("2\t0\t\0src/old.ts\0src/new.ts\0")).toEqual([
      { insertions: 2, deletions: 0, path: "src/new.ts", previousPath: "src/old.ts" },
    ]);
  });

  it("treats a binary file's dashes as zero", () => {
    expect(parseNumstatZ("-\t-\tlogo.png\0")).toEqual([
      { insertions: 0, deletions: 0, path: "logo.png", previousPath: null },
    ]);
  });
});

describe("splitPerCommitBlocks", () => {
  it("keys each block by its commit sha", () => {
    const output = `${LOG_RECORD_SEPARATOR}aaa\nM\0src/a.ts\0${LOG_RECORD_SEPARATOR}bbb\nA\0src/b.ts\0`;
    const blocks = splitPerCommitBlocks(output);
    expect([...blocks.keys()]).toEqual(["aaa", "bbb"]);
    expect(parseNameStatusZ(blocks.get("aaa") ?? "")).toEqual([
      { state: "modified", path: "src/a.ts", previousPath: null },
    ]);
  });

  it("records a commit that touched nothing with an empty block", () => {
    const blocks = splitPerCommitBlocks(`${LOG_RECORD_SEPARATOR}aaa`);
    expect(blocks.get("aaa")).toBe("");
  });
});

describe("operationFromMarkers", () => {
  const none = {
    mergeHead: false,
    rebaseMerge: false,
    rebaseApply: false,
    cherryPickHead: false,
    revertHead: false,
    bisectLog: false,
  };

  it("reports none when no marker exists", () => {
    expect(operationFromMarkers(none)).toBe("none");
  });

  it("prefers a rebase over a merge, because a rebase leaves both markers", () => {
    expect(operationFromMarkers({ ...none, rebaseMerge: true, mergeHead: true })).toBe("rebase");
  });

  it("maps each remaining marker", () => {
    expect(operationFromMarkers({ ...none, mergeHead: true })).toBe("merge");
    expect(operationFromMarkers({ ...none, cherryPickHead: true })).toBe("cherry-pick");
    expect(operationFromMarkers({ ...none, revertHead: true })).toBe("revert");
    expect(operationFromMarkers({ ...none, bisectLog: true })).toBe("bisect");
  });
});

describe("remoteProvider", () => {
  it("recognises the common hosts from either URL form", () => {
    expect(remoteProvider("git@github.com:owner/repo.git")).toBe("github");
    expect(remoteProvider("https://gitlab.com/owner/repo.git")).toBe("gitlab");
    expect(remoteProvider("https://bitbucket.org/owner/repo")).toBe("bitbucket");
    expect(remoteProvider("https://dev.azure.com/org/project/_git/repo")).toBe("azure-devops");
  });

  it("returns null for a self-hosted or missing remote", () => {
    expect(remoteProvider("git@git.internal:owner/repo.git")).toBe(null);
    expect(remoteProvider(null)).toBe(null);
  });
});
