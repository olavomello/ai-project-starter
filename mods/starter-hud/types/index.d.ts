// The mod's `$.state` contract: the values the Pending decisions band and pane read while drawing.
// Everything else the mod keeps lives in the module's own variables.

export type DecisionItem = {
  /** Stable id of the source line. */
  id: string;
  /** The section heading above the item. */
  section: string;
  /** Index of the section, used to colour the item. */
  group: number;
  title: string;
  detail: string;
  blocks: string;
  /** The exact markdown line, used to take the item out of the file. */
  raw: string;
};

/** What the pane shows: the list, or the confirmation for one item. */
export type DecisionScreen = { kind: 'list' } | { kind: 'confirm'; id: string };

export type DecisionStatus = {
  exists: boolean;
  /** `mtimeMs:size` of the file at the last read. */
  stamp: string;
  checkedAt: number;
  error: string | null;
};

declare module 'claude-code' {
  interface PluginState {
    'starter-hud': {
      decisionItems: DecisionItem[];
      decisionScreen: DecisionScreen;
      decisionOffset: number;
      decisionStatus: DecisionStatus;
    };
  }
}
