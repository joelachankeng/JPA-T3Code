/**
 * Durable per-repository UI state for the Source Control surface.
 *
 * The right panel renders only its active surface, so the panel unmounts
 * whenever the user opens a file beside it. Anything held in component state —
 * the list/tree choice, which accordions are open, a half-typed commit message —
 * would be lost on the way back. This store keeps it, keyed by repository so two
 * projects do not share one presentation.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";
import type { GitLensViewId } from "./GitLensAccordion";

const STORAGE_KEY = "t3code:source-control-ui:v1";

export type ScmSectionId = "gitlens" | "changes" | "graph";

export interface ScmRepositoryUiState {
  readonly viewAsTree: boolean;
  /** Collapsed rather than open, so a new repository starts with the defaults. */
  readonly collapsedSections: readonly ScmSectionId[];
  readonly gitLensView: GitLensViewId;
  readonly allBranches: boolean;
  /**
   * The commit message in progress. Losing a written message because the user
   * looked at a diff first is worse than losing a toggle.
   */
  readonly message: string;
}

export const DEFAULT_SCM_UI_STATE: ScmRepositoryUiState = {
  viewAsTree: false,
  // The GitLens accordion sits last and starts closed; the working tree and the
  // graph are what the surface is opened for.
  collapsedSections: ["gitlens"],
  gitLensView: "commits",
  allBranches: false,
  message: "",
};

interface ScmUiStoreState {
  byRepository: Record<string, ScmRepositoryUiState>;
  update: (key: string, patch: Partial<ScmRepositoryUiState>) => void;
  toggleSection: (key: string, section: ScmSectionId) => void;
}

/** One entry per repository, so switching projects does not carry state across. */
export function scmUiKey(input: { readonly environmentId: string; readonly cwd: string }): string {
  return `${input.environmentId}:${input.cwd}`;
}

export const useSourceControlUiStore = create<ScmUiStoreState>()(
  persist(
    (set) => ({
      byRepository: {},
      update: (key, patch) =>
        set((state) => ({
          byRepository: {
            ...state.byRepository,
            [key]: { ...(state.byRepository[key] ?? DEFAULT_SCM_UI_STATE), ...patch },
          },
        })),
      toggleSection: (key, section) =>
        set((state) => {
          const current = state.byRepository[key] ?? DEFAULT_SCM_UI_STATE;
          const collapsed = new Set(current.collapsedSections);
          if (collapsed.has(section)) collapsed.delete(section);
          else collapsed.add(section);
          return {
            byRepository: {
              ...state.byRepository,
              [key]: { ...current, collapsedSections: [...collapsed] },
            },
          };
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => resolveStorage(globalThis.localStorage)),
      partialize: (state) => ({ byRepository: state.byRepository }),
    },
  ),
);

export function selectScmUiState(
  byRepository: Record<string, ScmRepositoryUiState>,
  key: string,
): ScmRepositoryUiState {
  return byRepository[key] ?? DEFAULT_SCM_UI_STATE;
}
