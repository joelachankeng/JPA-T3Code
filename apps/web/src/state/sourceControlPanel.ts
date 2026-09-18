import { createSourceControlPanelAtoms } from "@t3tools/client-runtime/state/source-control-panel";

import { connectionAtomRuntime } from "../connection/runtime";

export const sourceControlPanel = createSourceControlPanelAtoms(connectionAtomRuntime);
