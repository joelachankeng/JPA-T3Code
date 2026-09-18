# T3 Code (fork)

> [!NOTE]
> This is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code) by Ping Labs. It is not affiliated with or supported by the T3 Code team. The upstream README follows the list of changes below; its install links and release downloads point to the official upstream builds, which do not include these changes.

## Changes in this fork

The main addition is a **Source control** surface in the right panel, built to work like VS Code's Source Control view with GitLens. It is available on web and desktop. Guide: [docs/user/source-control.md](./docs/user/source-control.md).

- **Source control surface.** Open it from the panel launcher, the panel's **+** menu, or `S`.
  - Commit box with Commit, Commit & Push, Commit & Sync, and Amend Last Commit. With nothing staged, a commit includes every tracked change, as in VS Code.
  - Merge Changes, Staged Changes, and Changes groups with stage, unstage, and discard for single files, folders, and whole groups. Discarding asks for confirmation first.
  - A flat list or folder tree view, remembered for each repository. Folders in the tree get VS Code's hover actions.
  - Clicking a change opens its diff inside the panel. Staging, unstaging, and discarding leave you on the change list.
  - Refreshes every 5 seconds while visible and when the window regains focus, with an indicator while a refresh runs.
  - Sync or publish from the header, with ahead and behind counts.
- **VS Code's right-click menus for files and folders.** Each group (Changes, Staged, Merge) gets the items VS Code gives it:
  - Open Changes, Open Changes with a revision or a branch or tag, Open File, and Open File (HEAD).
  - Open on Remote and Share, which open or copy the file's URL on GitHub, GitLab, Bitbucket, Azure DevOps, or Gitea/Codeberg.
  - File History, as a list, filtered into the graph, as a chart, or through a quick picker.
  - Stash, Add to .gitignore, Reveal in File Explorer or the Files surface, Copy Changes (Patch), and Copy Relative Path.
  - Items that cannot work for a file are hidden. For example, a deleted file has no Open File.
- **Commit graph.** Lanes, branch and tag chips, a switch between the current branch and all branches, and filtering to one file or folder. Select a commit to see everything it changed.
- **GitLens section.** Branches, Remotes, Tags, Stashes, Worktrees, and Contributors views, plus File History and Folder History that you can pin to a path.
- **File timelines.** **Open Timeline** from the Files or Source control surface lists every commit that touched a file or folder, with an inline diff for each. A visual view charts commits over time by author.
- **Server.** New `scm.*` WebSocket RPCs (status, stage, commit, remote actions, stash, branch, log, commit detail, views, diff, timeline, ignore, patch, show), with read and operate scopes, typed in `packages/contracts`.

---

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, T3 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Command line

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

Then run `t3` to start the server and open the local web app. `t3 service install` keeps it running in the background, `t3 update` moves to a newer release, and `t3 --help` has the full reference.

To try it once without installing, run `npx t3@latest` instead.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
