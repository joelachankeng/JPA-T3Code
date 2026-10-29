@AGENTS.md

## This fork

Before bumping the version, building an installer or CLI archive, cutting a release, or upgrading a remote connection, read `docs/operations/version-bump-fork.md` and follow it. It records the steps and the mistakes that have repeated: never run `nvm`, publish with `gh` inside WSL, and give every build a short timeout and read its output.

### Fork features

[`docs/JPA/features.md`](docs/JPA/features.md) lists every custom feature this fork adds to upstream T3 Code: how each works, tips, reference files, and how to verify it. Read it when either rule below applies.

- **After pulling from upstream:** once conflicts are resolved and you have tested that upstream itself still works, review that file and verify each custom feature still works as expected. Check its integration-points table first: upstream refactors silently drop fork wiring there. Do anything that writes in a throwaway repo, never a real checkout.
- **When adding or changing a custom feature:** update its entry in that file in the same commit, including its reference files and verify steps. That keeps every fork feature tracked, so none can be overwritten by upstream unnoticed.
