# Source control

T3 Code integrates with GitHub, GitLab, Forgejo, Gitea, Bitbucket, and Azure DevOps to clone and publish
repositories, create pull requests, and review changes.

## Connect an account

Install Git and configure authentication on the machine running your T3 Code server. For a remote
environment, do this on the remote machine. After signing in, open **Settings → Source Control**
and choose **Rescan**.

### GitHub

T3 Code talks to GitHub's API directly and only needs a token. Any of these works, in this
order of precedence:

1. A token saved in **Settings → Source Control → GitHub**. It is kept in the server's secret
   store, and works without the GitHub CLI.
2. `GH_TOKEN` (`GH_ENTERPRISE_TOKEN` with `GH_HOST` for GitHub Enterprise Server) in the
   server's environment.
3. [GitHub CLI](https://cli.github.com/) 2.81.0 or newer, signed in with `gh auth login`.

If `gh` is signed in to several accounts or hosts, expand **GitHub** in the same place to pick
the account each host uses or turn a host off. A saved token or `GH_TOKEN` takes precedence
over that choice; a host turned off stays off either way.

### Forgejo and Gitea

Install [Forgejo CLI (`fj`)](https://codeberg.org/forgejo-contrib/forgejo-cli) or
[Gitea CLI (`tea`)](https://gitea.com/gitea/tea) 0.16 or later on your T3 Code server.
Sign in with `fj --host https://your-server auth add-token` or `tea login add`.
Repeat for each server you use, including Codeberg.

T3 Code prefers a matching `fj` login and falls back to `tea` when `fj` is unavailable
or has no login for that server. Once an account is selected, failed actions stay on that
account. Settings shows the detected CLI. Forgejo and Gitea share one integration entry.
Servers hosted under a URL subpath, such as `https://example.com/forgejo`, use `tea` because
fj 0.6 does not preserve the subpath when checking its account.

When cloning or publishing, use a full repository URL to select a specific server.
You can use `owner/repo` when only one fj server is configured, or with your default `tea`
login when fj is unavailable or unconfigured. With multiple fj servers, use the full URL.
If you have multiple `tea` accounts on one server, select one with
`tea login default <login-name>`. Git push and clone also need Git credentials or an SSH key
for that server.

### GitLab

Install [GitLab CLI](https://gitlab.com/gitlab-org/cli), then sign in:

```bash
glab auth login
```

### Bitbucket

Open **Settings → Source Control**, expand **Bitbucket**, and choose how to sign in:

- **Access token**: a token created for one repository, project, or workspace. It can only reach
  what it was created for.
- **API token**: an Atlassian API token for your account, used with your account email. It can
  reach every repository you can. Give it read/write access to repositories and pull requests, plus
  user read access (`read:user:bitbucket`).

Choose **Save**; the change applies right away, and replaces any credential saved with the other
method. Credentials are saved on the environment's server, so select a remote environment to
configure it. Saved tokens can't be viewed again; enter a new one to replace it, or choose
**Remove**.

If no credentials are saved, T3 Code falls back to these variables in the server's environment.
Restart the server after changing them:

```bash
export T3CODE_BITBUCKET_ACCESS_TOKEN="your-access-token"
# or
export T3CODE_BITBUCKET_EMAIL="you@example.com"
export T3CODE_BITBUCKET_API_TOKEN="your-token"
```

### Azure DevOps

Install [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/), add the DevOps extension, and sign in:

```bash
az extension add --name azure-devops
az login
```

## Start, clone, or publish a project

To start from nothing, choose **New project** in the command palette (`Cmd/Ctrl+K`), or
**New project** under **Add Project** on any client, and type a name. T3 Code makes a Git
repository in `~/.t3/projects` (the `projects` folder of your T3 data directory) with a README,
an icon, and a first commit, then opens a new thread in it. The folder is named after the project,
like `pinball-stats` for "Pinball Stats". Turn on **Create private repository on GitHub** to also
publish it. If Git has no name or email on that machine, the project is created without the
first commit.

Use **Add Project** in the command palette (`Cmd/Ctrl+K`) to clone a repository. Choose a hosting
provider or paste a Git URL, then choose where to save it. The project opens right away while the
clone runs in the background: you can write your first prompt, and sending waits until the files
are in place. A toast tracks progress and lets you cancel; if the clone fails, retry it from the
toast or from the banner above the composer.

For a local Git repository without a remote, **Publish Repository** creates a hosted repository,
adds it as `origin`, and pushes your commits. If there are no commits yet, it creates the remote;
make your first commit before pushing.

## The Source Control surface

Open **Source control** from a thread's panel launcher, the panel's **+** menu, or by pressing `S`
while the launcher is showing. It works on the repository the thread's project sits in, whether that
repository is on this machine or on a remote environment.

The surface has three sections:

- **GitLens** groups related views behind one header. Switch between Commits, Branches, Remotes,
  Stashes, Tags, Worktrees, Contributors, and the open file's history using the buttons in that
  header.
- **Changes** lists the working tree. Select a file to see its diff, use the checkbox to stage or
  unstage it, and write a message and press **Commit** to commit. The button's dropdown also offers
  Commit & Push, Commit & Sync, and Amend Last Commit. With nothing staged, committing includes every
  tracked change. Group headers carry stage, unstage, and discard for a whole group, and the toolbar
  switches the list between a flat list and a folder tree.
- **Graph** draws the commit history, with a lane per line of development and chips for the branches
  and tags pointing at each commit. Select a commit to see everything it changed, or right-click it
  to copy its message. The filter at the top switches between the current branch and all branches.

Right-click a changed file or, in the folder tree, a folder for the same menu VS Code offers: stage,
unstage, discard or stash it, add it to `.gitignore`, copy its changes as a patch, compare it with an
earlier commit or with a branch or tag, or open its history as a list, filtered into the graph, or as
a chart of commits over time. A file's menu can also show the version in HEAD, open or copy its link
on the remote's website, reveal it in the Files surface or your file manager, and copy its path.

The button beside the branch name in the header syncs with the upstream branch and shows how many
commits are waiting in each direction. On a branch that has no upstream yet, it publishes the branch.

An open diff carries its own controls at the right of its header: open the file itself, step to the
previous or next change, ignore whitespace, which hides differences that are only spacing, and wrap
long lines instead of scrolling them. The last control switches between reading the change in one
column and reading the two versions side by side. Wrapping and the column choice are the same
settings the chat diff panel and pull request reviews use.

You can also type directly into a diff of your working tree, on the side that shows the current
file. Nothing is written until you say so: once you type, a save and a discard control appear
beside the file's name, and `Ctrl`/`Cmd`+`S` saves as well. Discarding, leaving the diff, or
closing the panel with unsaved changes asks first. A diff of staged changes or of a commit is a
record of what happened, so it stays read-only, as is a file that lives outside the project.

## File timelines

Right-click a file in either the **Files** or the **Source control** surface and choose
**Open Timeline** to see every commit that touched it, newest first, with its author and age. Select
an entry to see what that commit changed in that file. A file with uncommitted edits shows those at
the top of the list. The timeline opens as its own tab, so you can keep several open at once.

## Create a pull request

Use a thread's Git actions to commit, push, and create a pull request. T3 Code can generate commit
messages, review titles, and descriptions from your changes.

Choose the writing style and model in **Settings → Source Control**. **Repository conventions**
uses the project's instructions and recent commit subjects.

## Review and merge

Open **Pull requests** to review changes and comments, request reviewers, check out a branch,
or merge. You can edit review titles and descriptions and your own comments where the host allows it.
GitLab calls these merge requests.

Enable **Remove agent credits when merging** in Settings → Source Control to remove recognized
agent co-author and generated-by lines from GitHub merge and squash commit messages. Human
co-authors stay credited. The setting is off by default and projects can override it. It also
applies to auto-merge, but not merge queues or native stack merges. Original commits keep their
messages, so merge and rebase can still retain agent credits in those commits.

On web and desktop, hold **Shift** in the GitHub pull request list for quick actions.
To close several, press **Close**, drag across the rows in the same group, and release.
Press **Escape** before releasing to cancel. Failed closes stay in the list so you can retry them.

GitHub, GitLab, and Azure DevOps support auto-merge while checks are outstanding. GitHub also
supports approving waiting fork workflows and opening a revert pull request for a merged change.

GitHub sharing is off by default. In Settings → Connections → GitHub sharing (Environments on mobile), choose
**Read PRs** or **Read and act** for each environment you trust to share GitHub access.
Enable both the original environment and the environment answering its requests on this client.
**Read and act** can use broader GitHub permissions than the original environment's credential;
only enable it for environments you control and trust. Changing a saved endpoint or removing an
environment clears its permission.

GitHub review details, linked PR status, and permitted review actions can then use another
connected environment signed in to the same GitHub account. Each needs a project on that host.
A connected local environment is preferred for actions and can answer slow or failed reads.
Browsers and mobile clients need a paired environment to use its GitHub credentials.
Credentials stay on their machines. Previously verified credentials remain usable for routing
for ten minutes during a GitHub outage; new credentials must be verified first. An action with
an uncertain result is never automatically retried elsewhere. Listings, diffs, and checkout or
PR creation from Git actions continue to use the project's environment.

For Azure DevOps, use the host website to change comments. Bitbucket does not support reopening a
declined pull request.

### Mark files as viewed

Tick a file off in the **Code** tab once you have read it and it collapses; the toolbar keeps a
running count. A tick belongs to the pull request rather than to a commit, so scoping the tab to a
single commit keeps them. A file pushed to after you cleared it comes back marked **Changed**.

On GitHub these are GitHub's own viewed marks, so a review carries between T3 Code and github.com
in either direction. Forgejo, GitLab, Bitbucket, and Azure DevOps expose no record T3 Code can read, so the
server you are connected to keeps them instead: they follow you across the apps connected to that
server, but the host's own site will not show them, and the count reads **viewed in T3 Code**.

The **Code** tab is a web and desktop surface. The mobile app reports a pull request's status but
does not show its diff, so marks are made and read on web and desktop.

## Troubleshooting

- **Not authenticated:** run the provider's login command on the server, then rescan. For Bitbucket,
  check the credentials saved in Settings → Source Control, or confirm the running server received
  the environment variables.
- **GitHub sign-in cannot be verified:** update GitHub CLI to at least 2.81.0, or save a token in Settings → Source Control.
- **Push fails despite a connected account:** check the Git remote's credentials. SSH and HTTPS
  remotes can require separate setup from the hosting provider's API access.
- **A review cannot load:** open it on the host website while resolving connectivity, permissions,
  or rate limits.

## Linked pull requests

A thread can hold several pull requests, including reviews from another repository on the same host.
Use **Link pull request** in the command palette or **Linked pull requests** panel, or right-click a
pull request link in the conversation. Creating a pull request from Git actions links it automatically.
Agents can link their pull requests with the `link_pull_request` tool.

Use **Link this PR** in a branch-detected badge's tooltip to keep it with the thread. From a review
on the Pull Requests page, **Link to thread** lets you search for an active thread. The review header
also lists the threads that link to it, including archived threads, so you can return to their context.

Thread badges show a stack's layer count or the current review number with a count of additional
links. Clicking a badge with more than one review opens the **Linked pull requests** panel. On mobile, the Git overview lists linked reviews and their stacks; tap a review to open it.
Linking and unlinking are available in the web and desktop clients.

The **Linked pull requests** panel lists every review and groups stacks. Unlink a review from its
row menu. An unlinked stack layer stays out of later syncs. Open linked reviews refresh on the server;
closed reviews refresh periodically so reopening one on the host is detected. Merged reviews refresh
when requested. A settled thread's reviews stop refreshing until you unsettle it. With **Auto-settle merged threads** enabled, a thread can settle after every linked
review is terminal. An open or unsynced link keeps it active.

Ask the agent to watch, monitor, or babysit a pull request and it calls `watch_pull_request`. While
the thread is active, the server checks the pull request every two minutes and wakes the agent when a
check fails, the required checks pass, someone else comments or reviews, or the branch starts to
conflict. Threads in a project that watch the same pull request share one check. On GitHub, a check
first asks whether anything changed and reads the pull request only when it did, which keeps
watching inside GitHub's rate limit. Comments from your own account do not wake it. Watching ends
when the pull request merges or closes, after 10 wakes in a row that bring only comments, after 8
failed reads in a row, or when you press Stop on the thread. A rate limit only pauses watching.
Settling or archiving a thread also ends all its watches. Unsettle the thread before starting a new
watch. Subagents cannot watch pull requests; the thread that delegated to them does. To start or stop
it yourself, use the row menu in the **Linked pull requests** panel. In the thread details card, a
watched pull request shows an eye; click it to stop watching.

A watched thread counts as working between wakes, so it stays in the **Working** section and does
not auto-settle. Agents stop watching when they hand the work back to you, and the thread then
returns to your inbox.

Cross-repository links use a project on the same host. Azure DevOps reviews require a project checked
out from the matching organization and repository.

## GitHub stacks

The Pull Requests page shows each PR's position in its GitHub stack. Open the stack badge in a
review to navigate its layers. **Merge stack** submits the selected pull request and every unmerged
layer below it to GitHub together, respecting branch rules and merge queues. The confirmation shows
the scope and merge strategy. GitHub rebases the remaining stack after merging.

**Rebase stack** updates remote branches from bottom to top without changing your local checkout.
It can rewrite history and restart checks. If a layer fails, earlier updates remain; resolve that
layer before retrying. GitHub may require manual conflict resolution after a lower layer is amended,
even when its changes look independent. Stack actions require an environment that supports them.
