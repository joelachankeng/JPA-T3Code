# JPA fork features

Everything this fork adds to or changes in upstream T3 Code
([pingdotgg/t3code](https://github.com/pingdotgg/t3code)). Use it as the checklist after
every upstream merge: each feature lists how it works, where the code lives, and how to
check that it still works.

Keep it current. A new fork feature, or a change to one listed here, gets its entry
updated in the same commit.

## After an upstream merge

1. Resolve conflicts, then confirm that upstream itself still works (typecheck, the tests
   for the areas touched, a quick run of the app).
2. Check the [integration points](#integration-points-upstream-merges-break) below. They
   are the places where fork code is wired into upstream code, so they break first and
   often without a conflict.
3. Walk the **Verify** list of every feature below in a real client. Do anything that
   writes (stage, commit, rename, delete, replace) in a throwaway git repo added as a
   project, never in a real checkout.
4. Run the fork's own tests:

   ```sh
   vp test run apps/web/src/components/sourceControl apps/web/src/components/files \
     apps/server/src/sourceControl apps/server/src/workspace/WorkspaceFileSystem.test.ts \
     apps/web/src/lib/composedRangesCompat.test.ts apps/web/src/keybindings.test.ts \
     apps/web/src/rightPanelStore.test.ts
   ```

5. Run `vp run knip:check`. The pre-commit hook runs it too, and fork code that nothing
   imports fails it.

## Integration points upstream merges break

Fork code plugs into upstream code in a handful of places. Upstream regularly moves or
rewrites them, which drops the fork's wiring silently, sometimes with no merge conflict.
After a merge, grep for each one and confirm it is still there.

| Wiring                                                                                                            | Where it lives now                                                                           | What breaks without it                                                                                           |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `source-control` and `timeline` surface kinds, `openTimeline`, `revealInFiles`, `renameFilePath`, `closeFilePath` | `apps/web/src/rightPanelStore.ts`                                                            | Surfaces never open; renamed or deleted files leave stale tabs                                                   |
| `RIGHT_PANEL_STORAGE_VERSION` is the fork's own bump (currently 15)                                               | `apps/web/src/rightPanelStore.ts`                                                            | Saved panel state from an older build fails to load. If upstream raises its own version, set the fork's above it |
| `addSourceControlSurfaceStable`, `openTimelineSurfaceStable`, `revealInFilesSurfaceStable`                        | `apps/web/src/components/chat/useRightPanelActions.ts`, used by `ChatView.tsx`               | Launcher item and timeline links do nothing                                                                      |
| `onAddSourceControl` / `sourceControlAvailable` props                                                             | `ChatView.tsx` (via `ChatRightPanel`) and `components/pullRequest/PullRequestsPage.tsx`      | Typecheck fails, or the launcher item disappears                                                                 |
| Surface rendering for `source-control` and `timeline`                                                             | `apps/web/src/components/chat/RightPanelSurfaceContent.tsx`, `RightPanelTabs.tsx`            | Tab opens empty                                                                                                  |
| `fileSurfaceFocus` in the shortcut context                                                                        | `apps/web/src/shortcuts/dispatcher.ts` (`readFocusContext`)                                  | `mod+f` / `mod+h` stay on thread find                                                                            |
| `installComposedRangesCompat()` at startup                                                                        | `apps/web/src/appInit.tsx` (`startAppServices`)                                              | Typing and pasting into the file editor fail on iOS Safari                                                       |
| `WsScmRpcGroup`, merged into `WsRpcGroup`                                                                         | `packages/contracts/src/rpc.ts`                                                              | Every `scm.*` request fails                                                                                      |
| `layerWsScmRpc` merged next to `layerWsRpc`                                                                       | `apps/server/src/ws.ts`                                                                      | Server rejects `scm.*` as unknown methods                                                                        |
| `sourceControlPanel: true` capability                                                                             | `apps/server/src/environment/ServerEnvironment.ts`, `packages/contracts/src/environment.ts`  | Surface reports the environment is too old                                                                       |
| `scm.*` and `projects.renameEntry` / `deleteEntry` scopes                                                         | `apps/server/src/auth/RpcAuthorization.ts`, `packages/contracts/src/clientRpcPermissions.ts` | Requests are refused as unauthorized                                                                             |
| Mocked `resolveFileContextMenuAbsolutePath`                                                                       | `apps/web/src/components/files/FileBrowserPanel.browser.test.tsx`                            | Upstream rewrites this test; without the mock it fails to load                                                   |
| `wordWrapOverrideAtom` in place of the `wordWrapOverride` `useState`                                              | `apps/web/src/components/files/FilePreviewPanel.tsx`                                         | Line wrap resets to the default on every thread switch                                                           |

**Why the server has a separate scm RPC group:** one group holding every method exceeds
TypeScript's type instantiation depth limit. Upstream has its own split (`SplitWsRpcGroup`
/ `OtherWsRpcGroup` in `ws.ts`); it runs over `WsCoreRpcGroup`, and the scm group keeps its
own layer. If upstream restructures this again, keep the scm handlers in their own layer
rather than folding them back in.

**Lint and knip apply to whole files.** The pre-commit hook lints every staged file in
full. Touching an old fork file during a merge can surface lint debt against newer
upstream rules. Fix it in the same commit; do not skip the hook.

## Source control surface

A right-panel surface modeled on VS Code's Source Control view with GitLens. Works on web
and desktop, for local and remote environments. User guide:
[docs/user/source-control.md](../user/source-control.md).

**What it does**

- Commit box: Commit, Commit & Push, Commit & Sync, Amend Last Commit. With nothing
  staged, a commit includes every tracked change, as in VS Code.
- Merge Changes, Staged Changes, and Changes groups, with stage, unstage, and discard
  for files, folders, and whole groups. Discard asks first.
- Flat list or folder tree, remembered per repository.
- Header sync or publish button with ahead and behind counts.
- Commit graph with lanes, branch and tag chips, current branch or all branches, and
  filtering to one path. Right-click a commit to copy its message.
- GitLens section: Commits, Branches, Remotes, Stashes, Tags, Worktrees, Contributors,
  and File or Folder History that can be pinned to a path.
- Refreshes every 5 seconds while visible and when the window regains focus.

**How it works**

- Server: `SourceControlPanelService` runs git plumbing through `VcsProcess`, which
  supplies the concurrency limit, timeouts, and output caps. Pure parsers for porcelain
  v2, log records, and name-status live in `SourceControlPanelGit`.
- Every mutation refreshes the shared VCS status (`VcsStatusBroadcaster`), so the branch
  chip and thread change indicators follow the panel.
- Paths on the wire are repository-root relative. Pathspecs are pinned with `:(top)`, so
  a project rooted below the repository root still works. `resolveRepoPath` accepts paths
  in either basis.
- Client: queries are keyed by `{environmentId, cwd}`, so the accordions and timelines
  share one request each.
- Polls instead of watching the filesystem: on Linux a recursive watch needs an inotify
  watch per directory and can exhaust `max_user_watches`.

**Tips and tricks**

- Read scopes (`AuthOrchestrationReadScope`) cover status, log, views, diff, timeline,
  patch, show. Write actions need `AuthSourceControlWriteScope`.
- An environment without the `sourceControlPanel` capability gets an explanation, not
  five failed requests per refresh (`sourceControlError.ts`).
- The surface shows the whole repository even when the project is a subfolder.

**References**

- Contracts: `packages/contracts/src/sourceControlPanel.ts`, the scm RPCs in
  `packages/contracts/src/rpc.ts`
- Server: `apps/server/src/sourceControl/SourceControlPanelService.ts`,
  `SourceControlPanelGit.ts`, handlers in `apps/server/src/ws.ts` (`layerWsScmRpc`)
- Client state: `packages/client-runtime/src/state/sourceControlPanel.ts`,
  `apps/web/src/state/sourceControlPanel.ts`
- UI: `apps/web/src/components/sourceControl/` (`SourceControlPanel.tsx`,
  `SourceControlChanges.tsx`, `SourceControlGraph.tsx`, `GitLensAccordion.tsx`,
  `useSourceControl.ts`, `useScmAutoRefresh.ts`, `sourceControlUiStore.ts`)
- Tests: `apps/server/src/sourceControl/*.test.ts`,
  `apps/web/src/components/sourceControl/*.test.ts`

**Verify**

- [ ] **Source control** appears in the panel launcher, the **+** menu, and on `S`.
- [ ] Changes list, branch, ahead/behind, and the graph match `git status` and `git log`.
- [ ] Stage, unstage, and commit in a scratch repo, confirmed by `git log`.
- [ ] An edit made outside the app shows up within about 5 seconds.

## VS Code right-click menus for changes

**What it does:** changed files and folder-tree folders get VS Code's menu: Open Changes
(also against a revision, branch, or tag), Open File, Open File (HEAD), Open on Remote and
Share (GitHub, GitLab, Bitbucket, Azure DevOps, Gitea/Codeberg), File History (list,
graph filter, chart, quick pick), Open Timeline, Discard, Stage or Unstage, Stash, Add to
.gitignore, Reveal in File Explorer or Explorer View, Copy Changes (Patch), Copy Relative
Path.

**How it works:** `scmMenus.ts` builds the items for a file or folder in a given group.
Items that cannot work are left out; for example, a deleted file has no Open File.

**References:** `apps/web/src/components/sourceControl/scmMenus.ts`,
`useScmContextMenu.ts`, `ScmRefPickerDialog.tsx`, `ScmFileAtRef.tsx`; tests in
`scmMenus.test.ts`.

**Verify**

- [ ] Right-clicking a modified file shows the full menu; a deleted file hides Open File.
- [ ] Stage Changes from the menu stages the file.

## Source control diff: toolbar and in-place editing

**What it does**

- Diff header toolbar: open the file, previous and next change, ignore whitespace, wrap
  lines, unified or split view. Wrap and layout share settings with the chat diff panel.
- The working-tree side of an unstaged diff is editable. Nothing is written until you
  save: save and discard controls appear beside the file's name, and `Ctrl`/`Cmd`+`S`
  saves. Leaving or closing with unsaved edits asks first.

**How it works:** a working-tree diff requests `includeContents`, so the editor has the
whole file. Staged diffs, commit diffs, and files outside the project stay read-only.
`scmDiffEdits.ts` holds the unsaved flag, because the panel close control lives in
the chat view.

**Tips and tricks:** "Read-only" next to a working-tree diff means the file is outside the
thread's project, which is expected when the project is a subfolder of the repository.
Hover it for the reason.

**References:** `apps/web/src/components/sourceControl/ScmDiffToolbar.tsx`,
`ScmEditableDiff.tsx`, `scmDiffEdits.ts`, `editablePath` and `editTarget` in
`SourceControlPanel.tsx`, `workspacePathFor` in `sourceControlPanel.logic.ts`.

**Verify**

- [ ] Toolbar buttons work on a diff.
- [ ] In a scratch repo, type into a working-tree diff, save, and check the file on disk;
      discard really discards.

## File timelines

**What it does:** **Open Timeline** (Files or Source control right-click menu) opens a
tab listing every commit that touched a file or folder, newest first, with an inline diff
per commit. Uncommitted edits show at the top. **Show Visual History** charts commits over
time by author. Several timelines can stay open.

**How it works:** timeline surfaces are keyed `timeline:<path>` in the right panel store.
The server answers `scm.timeline`. The Source Control surface's File History follows the
file open in the panel (`activeRightPanelFilePath` in `ChatView.tsx`).

**References:** `apps/web/src/components/sourceControl/TimelinePanel.tsx`,
`VisualHistoryChart.tsx`, `openTimeline` in `apps/web/src/rightPanelStore.ts`.

**Verify**

- [ ] Open Timeline on a file lists the same commits as `git log -- <path>`.

## Files tree additions

**What it does**

- Right-click a file: Rename…, Delete…, Copy path, Copy relative path, Open Timeline.
- Right-click a folder: New file…, Rename…, Delete…, Copy path, Copy relative path.
- New file from the tree's toolbar button too.
- Rename can move: folders in the target path are created. A new file opens once created.
- Delete is permanent (skips the trash) and asks first.
- Open tabs follow a rename and close on a delete.
- Rename and delete wait (up to 5 seconds) for unsaved edits under the path to save first.
  An editor writes to the path it opened even after a rename or delete, which would bring
  the old file back. If the edits do not land in time, the dialog says so instead.

**How it works:** server RPCs `projects.renameEntry` and `projects.deleteEntry` in
`WorkspaceFileSystem` (filesystem write scope); new files use `projects.writeFile`.
The tree's menu is built in `FileBrowserPanel.tsx` on top of upstream's
`useFileContextMenu`.

**References:** `apps/web/src/components/files/FileBrowserPanel.tsx`,
`ProjectFilePathDialog.tsx`, `DeleteProjectEntryDialog.tsx`, `newProjectFile.ts`,
`usePendingFileSaves.ts`; `apps/server/src/workspace/WorkspaceFileSystem.ts`;
`packages/contracts/src/project.ts`; `packages/client-runtime/src/state/projectCommands.ts`.

**Verify** (scratch repo only)

- [ ] Rename a file into a new folder; it moves on disk and its tab follows.
- [ ] New file… inside a folder pre-fills the folder and creates the file.
- [ ] Delete removes the file and closes its tab.
- [ ] Copy path and Copy relative path copy the right strings.

## Find and replace in the open file

**What it does:** with an open file focused, `mod+f` finds and `mod+h` (also `mod+alt+f`,
since macOS takes `cmd+h`) replaces. Match case, whole word, regex (with `$1` and `$&` in
replacements), Enter / Shift+Enter between matches, Escape to close. Replace all is one
undo step. Rendered Markdown is searchable by its visible text, without replace.

**How it works**

- `fileSurfaceFocus` is a keybinding context that is true while the file surface holds
  the keyboard. It is added to every shortcut through upstream's dispatcher
  (`readFocusContext`).
- Matches are painted with the CSS Custom Highlight API, so the renderer's DOM is never
  touched. The highlight rules are injected into the file surface CSS
  (`fileSurfaceChrome.tsx`) and also into the document for light-DOM Markdown.
- Replace goes through the editor's `applyEdits`, and the change saves through upstream's
  file save sessions.
- Replace is offered only where the file is writable: not for truncated (over 1 MB),
  host, or read-only-connection files.

**Tips and tricks:** opening a file leaves focus in the composer, so `mod+f` still finds in
the thread until you click into the file or use the magnifier button.

**References:** `apps/web/src/components/files/useFileFind.ts`, `FileFindBar.tsx`,
`fileFind.ts`, `fileFindDom.ts`, `fileFindHighlights.ts`, `fileFindReveal.ts`;
`apps/web/src/lib/fileSurfaceFocus.ts`; the `file.find` and `file.replace` bindings in
`packages/shared/src/keybindings.ts`; docs in `docs/user/keybindings.md` and
`docs/user/keyboard-focus.md`.

**Verify**

- [ ] Click into an open file, press `Ctrl+F`: the "Find in file" bar opens and counts
      matches.
- [ ] With the composer focused, `Ctrl+F` still opens thread find.
- [ ] In a scratch repo, Replace all changes the file on disk.

## iOS Safari file editor fix

**What it does:** typing and pasting into the file editor work on iOS Safari.

**How it works:** Safari 17 and 18 throw on the standard `{ shadowRoots }` form of
`Selection.getComposedRanges`, so the editor never finds the caret inside its shadow
root. `installComposedRangesCompat` patches the call once at startup, before any editor
mounts.

**References:** `apps/web/src/lib/composedRangesCompat.ts` (+ test), called from
`startAppServices` in `apps/web/src/appInit.tsx`.

**Verify**

- [ ] `installComposedRangesCompat()` is still called in `startAppServices`.
- [ ] When possible, type into a file on an iPhone or iPad.

## Line wrap in the file viewer persists

**What it does:** the file viewer's line wrap toggle keeps its state for each thread. Switching
to another thread and back, or to another surface on the same thread (diff, browser, source
control) and back to the file, leaves wrap as you set it. Each thread has its own setting;
a thread you have never toggled uses the **Word wrap** setting.

**How it works:** upstream kept the toggle in component state, so it reset to the default
whenever the panel remounted, which happens on every thread switch. The fork moves it into
`wordWrapOverrideAtom`, an atom family keyed by `scopedThreadKey` and kept alive. It lives in
memory only, so a reload falls back to the Settings default.

**References:** `wordWrapOverrideAtom` in `apps/web/src/components/files/FilePreviewPanel.tsx`.

**Verify**

- [ ] Open a file on thread A and turn wrap on. Switch to thread B, then back to thread A:
      the file is still wrapped.
- [ ] On thread A, open another surface (diff or browser), then return to the file: still
      wrapped.
- [ ] Thread B's file viewer still uses the Settings default.

## Fork branding

**What it does:** release builds are named **T3 Code (JPA)** (app name "T3 Code JPA"),
so the fork is distinguishable from an official install. Dev and nightly builds keep
their own labels. The legacy user-data directory name is unchanged so existing data
still migrates.

**References:** `apps/desktop/src/app/DesktopEnvironment.ts`,
`apps/desktop/scripts/electron-launcher.mjs`, `apps/web/src/branding.ts`,
`apps/web/index.html`, `packages/contracts/src/ipc.ts`, `README.md` (fork note).

**Verify**

- [ ] `git grep -n "(Beta)"` under `apps/desktop`, `apps/web`, and `scripts` finds no new
      upstream name that should read JPA.
- [ ] The browser tab or window title shows the JPA name.

## SSH environments from the fork's own releases

**What it does:** the desktop app provisions SSH remotes from this fork's GitHub releases
instead of upstream's, so a remote runs the same fork version as the desktop.

**How it works:** the desktop reads `T3CODE_RELEASE_BASE_URL` (`CLI_RELEASE_BASE_URL_ENV`)
and passes it with the archive version to the SSH runner, which downloads from that base.
Unset keeps upstream's default. Every version bump needs a matching fork CLI release, or
remotes 404. See [version-bump-fork.md](../operations/version-bump-fork.md).

**References:** `apps/desktop/src/app/DesktopConfig.ts` (`cliReleaseBaseUrl`),
`DesktopEnvironment.ts`, `resolveDesktopSshCliRunner` in `apps/desktop/src/main.ts`,
`packages/ssh/src/tunnel.ts` (`buildRemoteT3RunnerScript`),
`packages/shared/src/cliRelease.ts`.

**Verify**

- [ ] `releaseBaseUrl` still flows from `DesktopConfig` through `main.ts` to
      `buildRemoteT3RunnerScript`.

## Release and dependency pins

- Version numbers stay on the fork's own line (`0.0.x` in each `package.json`). Keep the
  fork's version when upstream bumps its own, unless the merge is also a fork release.
- `node-pty` is pinned to `1.2.0-beta.15` in `apps/server/package.json`, because the
  Windows sidecar installs without the lockfile and the node-pty patch is keyed to that
  version.
- Release procedure: [docs/operations/version-bump-fork.md](../operations/version-bump-fork.md).
