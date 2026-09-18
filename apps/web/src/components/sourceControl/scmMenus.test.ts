import type { ScmFileEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { fileMenuItems, menuIds } from "./scmMenus";

function entry(overrides: Partial<ScmFileEntry> = {}): ScmFileEntry {
  return {
    path: "docs/a.md",
    previousPath: null,
    index: "unmodified",
    worktree: "modified",
    conflicted: false,
    insertions: 0,
    deletions: 0,
    ...overrides,
  };
}

const base = { hasRemote: true, revealInFileManagerLabel: "Reveal in File Explorer" } as const;

describe("fileMenuItems", () => {
  it("lays out a modified file's menu in VS Code's order and grouping", () => {
    const items = fileMenuItems({ ...base, group: "changes", entry: entry() });
    expect(items.map((item) => item.label)).toEqual([
      "Open Changes",
      "Open Changes with",
      "Open File",
      "Open File (HEAD)",
      "Open on Remote (Web)",
      "File History",
      "Open Timeline",
      "Discard Changes",
      "Stage Changes",
      "Stash Changes…",
      "Add to .gitignore",
      "Reveal in File Explorer",
      "Reveal in Explorer View",
      "Share",
      "Copy Changes (Patch)",
      "Copy Relative Path",
    ]);
    // Each block after the first opens with a separator, and only there.
    expect(items.filter((item) => item.separatorBefore).map((item) => item.label)).toEqual([
      "File History",
      "Discard Changes",
      "Reveal in File Explorer",
      "Share",
      "Copy Changes (Patch)",
    ]);
  });

  it("gives a staged file unstage and stash, and no discard or .gitignore", () => {
    const ids = menuIds(fileMenuItems({ ...base, group: "staged", entry: entry() }));
    expect(ids).toContain("unstage");
    expect(ids).toContain("stash");
    expect(ids).not.toContain("discard");
    expect(ids).not.toContain("gitignore");
    expect(ids).toContain("copy-patch");
  });

  it("gives a merge conflict VS Code's shorter menu, without a patch to copy", () => {
    const ids = menuIds(fileMenuItems({ ...base, group: "merge", entry: entry() }));
    expect(ids).not.toContain("open-changes");
    expect(ids).not.toContain("open-head");
    expect(ids).not.toContain("copy-patch");
    expect(ids).toContain("stage");
    expect(ids).toContain("copy-path");
  });

  it("offers nothing that reads HEAD or the remote for a file neither has seen", () => {
    const ids = menuIds(
      fileMenuItems({ ...base, group: "changes", entry: entry({ worktree: "untracked" }) }),
    );
    expect(ids).not.toContain("open-head");
    expect(ids).not.toContain("open-on-remote");
    expect(ids).not.toContain("share");
    // It is on disk, so it can still be opened and revealed.
    expect(ids).toContain("open-file");
    expect(ids).toContain("reveal-files");
  });

  it("offers a deleted file's last committed version but nothing on disk", () => {
    const ids = menuIds(
      fileMenuItems({ ...base, group: "changes", entry: entry({ worktree: "deleted" }) }),
    );
    expect(ids).toContain("open-head");
    expect(ids).toContain("open-on-remote");
    expect(ids).not.toContain("open-file");
    expect(ids).not.toContain("reveal-os");
    expect(ids).not.toContain("reveal-files");
  });

  it("leaves remote items out when the repository has no usable remote", () => {
    const ids = menuIds(
      fileMenuItems({ ...base, hasRemote: false, group: "changes", entry: entry() }),
    );
    expect(ids).not.toContain("open-on-remote");
    expect(ids).not.toContain("share");
  });

  it("leaves the file-manager reveal out when the host cannot do it", () => {
    const ids = menuIds(
      fileMenuItems({ ...base, revealInFileManagerLabel: null, group: "changes", entry: entry() }),
    );
    expect(ids).not.toContain("reveal-os");
    expect(ids).toContain("reveal-files");
  });

  it("offers every GitLens submenu item", () => {
    const ids = menuIds(fileMenuItems({ ...base, group: "changes", entry: entry() }));
    for (const id of [
      "compare-revision",
      "compare-ref",
      "remote-open",
      "remote-open-from",
      "history",
      "history-graph",
      "history-visual",
      "history-quick",
      "remote-copy",
      "remote-copy-from",
    ] as const) {
      expect(ids).toContain(id);
    }
  });
});
