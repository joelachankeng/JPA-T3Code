import type { ProjectEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { newProjectFileDirectory, resolveNewProjectFilePath } from "./newProjectFile";

const kinds = new Map<string, ProjectEntry["kind"]>([
  ["docs", "directory"],
  ["docs/guide.md", "file"],
  ["README.md", "file"],
]);

describe("newProjectFileDirectory", () => {
  it("offers the selected folder itself", () => {
    expect(newProjectFileDirectory("docs", kinds)).toBe("docs");
  });

  it("offers a selected file's folder", () => {
    expect(newProjectFileDirectory("docs/guide.md", kinds)).toBe("docs");
  });

  it("falls back to the project root", () => {
    expect(newProjectFileDirectory(null, kinds)).toBe("");
    expect(newProjectFileDirectory("README.md", kinds)).toBe("");
  });
});

describe("resolveNewProjectFilePath", () => {
  it("keeps a workspace-relative path", () => {
    expect(resolveNewProjectFilePath("  docs/notes.md ")).toEqual({
      relativePath: "docs/notes.md",
    });
  });

  it("folds backslashes and collapses empty segments", () => {
    expect(resolveNewProjectFilePath("docs\\deep\\\\notes.md")).toEqual({
      relativePath: "docs/deep/notes.md",
    });
  });

  it("refuses an empty name", () => {
    expect(resolveNewProjectFilePath("   ")).toEqual({ error: "Enter a file name." });
  });

  it("refuses a folder", () => {
    expect(resolveNewProjectFilePath("docs/")).toEqual({
      error: "Enter a file name, not a folder.",
    });
  });

  it("refuses paths outside the project", () => {
    const error = { error: "Enter a path inside the project." };
    expect(resolveNewProjectFilePath("/etc/passwd")).toEqual(error);
    expect(resolveNewProjectFilePath("C:\\Windows\\notes.md")).toEqual(error);
    expect(resolveNewProjectFilePath("\\\\host\\share\\notes.md")).toEqual(error);
    expect(resolveNewProjectFilePath("../outside.md")).toEqual(error);
    expect(resolveNewProjectFilePath("docs/../../outside.md")).toEqual(error);
  });

  it("refuses a path the write RPC would reject", () => {
    expect(resolveNewProjectFilePath(`${"a".repeat(513)}.md`)).toEqual({
      error: "That path is too long.",
    });
  });
});
