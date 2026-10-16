import { create } from "zustand";

export type PersistenceStatus = "loading" | "ready" | "incompatible" | "unavailable";

type PersistenceStatusState = {
  status: PersistenceStatus;
  message: string | null;
  setStatus: (status: PersistenceStatus, message?: string | null) => void;
};

/** Tells the UI whether saved data was loaded, is unreadable, or cannot be stored at all. */
export const usePersistenceStatus = create<PersistenceStatusState>((set) => ({
  status: "loading",
  message: null,
  setStatus: (status, message = null) => set({ status, message }),
}));
