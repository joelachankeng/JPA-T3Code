// @effect-diagnostics nodeBuiltinImport:off - fixtures are built with plain git and fs calls so the service under test is the only Effect code being exercised.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as SourceControlPanelService from "./SourceControlPanelService.ts";

const TestLayer = SourceControlPanelService.layer.pipe(
  Layer.provide(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

/** Fixture git, pinned so the host's autocrlf cannot rewrite the files under test. */
function git(cwd: string, args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync(
    "git",
    ["-C", cwd, "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8" },
  );
}

function write(root: string, relativePath: string, contents: string) {
  const absolute = NodePath.join(root, relativePath);
  NodeFS.mkdirSync(NodePath.dirname(absolute), { recursive: true });
  NodeFS.writeFileSync(absolute, contents);
}

/** A repository with one commit holding `docs/a.md`, `docs/b.md` and `README.md`. */
const makeRepository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-scm-panel-" });
  git(root, ["init", "-q"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@example.com"]);
  write(root, "docs/a.md", "alpha\n");
  write(root, "docs/b.md", "bravo\n");
  write(root, "README.md", "readme\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  return root;
});

it.layer(TestLayer)("SourceControlPanelService", (it) => {
  describe("patch", () => {
    it.effect("includes a deletion and an untracked file, as VS Code copies them", () =>
      Effect.gen(function* () {
        const root = yield* makeRepository;
        const service = yield* SourceControlPanelService.SourceControlPanelService;
        NodeFS.rmSync(NodePath.join(root, "docs/a.md"));
        write(root, "docs/new.md", "brand new\n");

        const { patch } = yield* service.patch({
          cwd: root,
          paths: ["docs/a.md", "docs/new.md"],
          staged: false,
        });

        assert.include(patch, "diff --git a/docs/a.md b/docs/a.md");
        assert.include(patch, "deleted file mode");
        // A plain `git diff` leaves an untracked file out entirely.
        assert.include(patch, "diff --git a/docs/new.md b/docs/new.md");
        assert.include(patch, "new file mode");
        assert.include(patch, "+brand new");
      }),
    );

    it.effect("reads the index for a staged group and ignores the working tree", () =>
      Effect.gen(function* () {
        const root = yield* makeRepository;
        const service = yield* SourceControlPanelService.SourceControlPanelService;
        write(root, "docs/b.md", "bravo staged\n");
        git(root, ["add", "docs/b.md"]);
        write(root, "docs/b.md", "bravo working\n");

        const { patch } = yield* service.patch({ cwd: root, paths: ["docs"], staged: true });

        assert.include(patch, "+bravo staged");
        assert.notInclude(patch, "bravo working");
      }),
    );
  });

  describe("ignore", () => {
    it.effect("appends each path once, after what the file already holds", () =>
      Effect.gen(function* () {
        const root = yield* makeRepository;
        const service = yield* SourceControlPanelService.SourceControlPanelService;
        write(root, ".gitignore", "node_modules");

        yield* service.ignore({ cwd: root, paths: ["docs/a.md", "docs/b.md", "docs/a.md"] });
        yield* service.ignore({ cwd: root, paths: ["docs/a.md"] });

        const contents = NodeFS.readFileSync(NodePath.join(root, ".gitignore"), "utf8");
        // The existing last line had no newline; it must not run into the new one.
        assert.strictEqual(contents, "node_modules\ndocs/a.md\ndocs/b.md\n");
      }),
    );

    it.effect("keeps a file's CRLF line endings", () =>
      Effect.gen(function* () {
        const root = yield* makeRepository;
        const service = yield* SourceControlPanelService.SourceControlPanelService;
        write(root, ".gitignore", "dist\r\n");

        yield* service.ignore({ cwd: root, paths: ["docs/a.md"] });

        const contents = NodeFS.readFileSync(NodePath.join(root, ".gitignore"), "utf8");
        assert.strictEqual(contents, "dist\r\ndocs/a.md\r\n");
      }),
    );

    it.effect("creates the file when the repository has none", () =>
      Effect.gen(function* () {
        const root = yield* makeRepository;
        const service = yield* SourceControlPanelService.SourceControlPanelService;

        yield* service.ignore({ cwd: root, paths: ["docs/a.md"] });

        const contents = NodeFS.readFileSync(NodePath.join(root, ".gitignore"), "utf8");
        assert.strictEqual(contents, "docs/a.md\n");
      }),
    );
  });

  describe("timeline", () => {
    it.effect("sums a folder's files per commit and calls mixed changes a modification", () =>
      Effect.gen(function* () {
        const root = yield* makeRepository;
        const service = yield* SourceControlPanelService.SourceControlPanelService;
        write(root, "docs/a.md", "alpha\nmore\n");
        write(root, "docs/c.md", "charlie\none\ntwo\n");
        git(root, ["add", "-A"]);
        git(root, ["commit", "-q", "-m", "touch two files"]);

        const result = yield* service.timeline({ cwd: root, path: "docs" });

        const [latest] = result.entries;
        assert.strictEqual(latest?.subject, "touch two files");
        // One line added to a.md plus three to c.md, rather than only the first file's count.
        assert.strictEqual(latest?.insertions, 4);
        assert.strictEqual(latest?.state, "modified");
        assert.strictEqual(latest?.pathAtCommit, "docs");
      }),
    );
  });

  describe("log", () => {
    it.effect("links a path-filtered history through the commits it kept", () =>
      Effect.gen(function* () {
        const root = yield* makeRepository;
        const service = yield* SourceControlPanelService.SourceControlPanelService;
        write(root, "docs/a.md", "alpha two\n");
        git(root, ["commit", "-q", "-am", "docs change"]);
        write(root, "README.md", "readme two\n");
        git(root, ["commit", "-q", "-am", "unrelated change"]);
        write(root, "docs/b.md", "bravo two\n");
        git(root, ["commit", "-q", "-am", "another docs change"]);

        const result = yield* service.log({ cwd: root, path: "docs" });

        const subjects = result.commits.map((commit) => commit.subject);
        assert.deepStrictEqual(subjects, ["another docs change", "docs change", "initial"]);
        // Its parent is the previous docs commit, not the unrelated one between them.
        const [latest, previous] = result.commits;
        assert.deepStrictEqual(latest?.parents, previous ? [previous.sha] : []);
      }),
    );
  });

  describe("diff", () => {
    it.effect("returns the patch without file contents when asked not to read them", () =>
      Effect.gen(function* () {
        const root = yield* makeRepository;
        const service = yield* SourceControlPanelService.SourceControlPanelService;
        write(root, "docs/a.md", "alpha changed\n");

        const result = yield* service.diff({
          cwd: root,
          path: "docs",
          from: { _tag: "head" },
          to: { _tag: "working" },
          includeContents: false,
        });

        assert.include(result.patch, "+alpha changed");
        assert.strictEqual(result.oldContents, "");
        assert.strictEqual(result.newContents, "");
      }),
    );

    it.effect("finds a root-relative path from a project rooted below the repository", () =>
      Effect.gen(function* () {
        const root = yield* makeRepository;
        const service = yield* SourceControlPanelService.SourceControlPanelService;
        write(root, "docs/a.md", "alpha edited\n");

        // Status reports from the repository root, so the panel asks with that
        // path even when the project's own directory is `docs`.
        const result = yield* service.diff({
          cwd: NodePath.join(root, "docs"),
          path: "docs/a.md",
          from: { _tag: "index" },
          to: { _tag: "working" },
        });

        assert.include(result.patch, "+alpha edited");
      }),
    );
  });
});
