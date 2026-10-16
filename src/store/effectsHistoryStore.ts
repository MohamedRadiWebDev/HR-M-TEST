import { create } from "zustand";

import type { Effect } from "@/store/effectsStore";
import { useEffectsStore } from "@/store/effectsStore";

type HistoryResult = { before: Effect[]; after: Effect[] } | null;

type EffectsHistoryState = {
  past: Effect[][];
  future: Effect[][];
  limit: number;

  /** Capture a snapshot of the current effects BEFORE applying a change. */
  capture: (snapshot: Effect[]) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Restores the previous snapshot. Returns what changed so callers can re-sync attendance. */
  undo: () => HistoryResult;
  redo: () => HistoryResult;
  clear: () => void;
};

const clone = (rows: Effect[]) => rows.map((r) => ({ ...r }));

export const useEffectsHistoryStore = create<EffectsHistoryState>((set, get) => ({
  past: [],
  future: [],
  limit: 30,

  capture: (snapshot) => {
    set((state) => {
      const nextPast = [...state.past, clone(snapshot)];
      const trimmedPast = nextPast.length > state.limit ? nextPast.slice(nextPast.length - state.limit) : nextPast;
      return { past: trimmedPast, future: [] };
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  undo: () => {
    const { past, future } = get();
    if (!past.length) return null;
    const current = useEffectsStore.getState().effects;
    const previous = past[past.length - 1];
    set({ past: past.slice(0, -1), future: [clone(current), ...future] });
    // replaceEffects does NOT capture history, so redo stays available.
    useEffectsStore.getState().replaceEffects(previous);
    return { before: current, after: previous };
  },

  redo: () => {
    const { past, future } = get();
    if (!future.length) return null;
    const current = useEffectsStore.getState().effects;
    const next = future[0];
    set({ past: [...past, clone(current)], future: future.slice(1) });
    useEffectsStore.getState().replaceEffects(next);
    return { before: current, after: next };
  },

  clear: () => set({ past: [], future: [] }),
}));
