import { create } from "zustand";

/**
 * Local-mode stand-in for "who is logged in".
 * There are no accounts yet, so the user chooses to view the app as HR or as a given employee.
 * (This is NOT security – anybody can switch. Real login arrives with the database.)
 */
type ViewAsState = {
  mode: "hr" | "employee";
  employeeCode: string;
  viewAsHr: () => void;
  viewAsEmployee: (code: string) => void;
};

const KEY = "hr_view_as";

const read = (): Pick<ViewAsState, "mode" | "employeeCode"> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (parsed && (parsed.mode === "hr" || parsed.mode === "employee")) return { mode: parsed.mode, employeeCode: String(parsed.employeeCode ?? "") };
  } catch {
    // ignore
  }
  return { mode: "hr", employeeCode: "" };
};

const write = (state: Pick<ViewAsState, "mode" | "employeeCode">) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // preference only
  }
};

export const useViewAs = create<ViewAsState>((set, get) => ({
  ...read(),
  viewAsHr: () => {
    set({ mode: "hr" });
    write({ mode: "hr", employeeCode: get().employeeCode });
  },
  viewAsEmployee: (code) => {
    set({ mode: "employee", employeeCode: code });
    write({ mode: "employee", employeeCode: code });
  },
}));
