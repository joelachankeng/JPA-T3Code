import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_SCM_UI_STATE,
  scmUiKey,
  selectScmUiState,
  useSourceControlUiStore,
} from "./sourceControlUiStore";

function reset() {
  useSourceControlUiStore.setState({ byRepository: {} });
}

const key = scmUiKey({ environmentId: "env-1", cwd: "/repo" });

describe("selectScmUiState", () => {
  it("gives a repository it has never seen the defaults", () => {
    reset();
    const state = selectScmUiState(useSourceControlUiStore.getState().byRepository, key);
    expect(state).toEqual(DEFAULT_SCM_UI_STATE);
    expect(state.viewAsTree).toBe(false);
    // GitLens is the section that starts closed, so the working tree leads.
    expect(state.collapsedSections).toEqual(["gitlens"]);
  });
});

describe("useSourceControlUiStore", () => {
  it("remembers a presentation choice, which is the point of the store", () => {
    reset();
    useSourceControlUiStore.getState().update(key, { viewAsTree: true });
    expect(selectScmUiState(useSourceControlUiStore.getState().byRepository, key).viewAsTree).toBe(
      true,
    );
  });

  it("keeps each repository's choices apart", () => {
    reset();
    const other = scmUiKey({ environmentId: "env-1", cwd: "/other" });
    useSourceControlUiStore.getState().update(key, { viewAsTree: true, message: "wip" });
    const otherState = selectScmUiState(useSourceControlUiStore.getState().byRepository, other);
    expect(otherState.viewAsTree).toBe(false);
    expect(otherState.message).toBe("");
  });

  it("keeps the same repository in two environments apart", () => {
    reset();
    const elsewhere = scmUiKey({ environmentId: "env-2", cwd: "/repo" });
    useSourceControlUiStore.getState().update(key, { viewAsTree: true });
    expect(
      selectScmUiState(useSourceControlUiStore.getState().byRepository, elsewhere).viewAsTree,
    ).toBe(false);
  });

  it("merges a patch rather than replacing the whole entry", () => {
    reset();
    useSourceControlUiStore.getState().update(key, { viewAsTree: true });
    useSourceControlUiStore.getState().update(key, { message: "a message" });
    const state = selectScmUiState(useSourceControlUiStore.getState().byRepository, key);
    expect(state.viewAsTree).toBe(true);
    expect(state.message).toBe("a message");
  });

  it("toggles a section both ways", () => {
    reset();
    const read = () => selectScmUiState(useSourceControlUiStore.getState().byRepository, key);

    useSourceControlUiStore.getState().toggleSection(key, "changes");
    expect(read().collapsedSections).toContain("changes");

    useSourceControlUiStore.getState().toggleSection(key, "changes");
    expect(read().collapsedSections).not.toContain("changes");
    // Toggling one section leaves the others where they were.
    expect(read().collapsedSections).toContain("gitlens");
  });
});
