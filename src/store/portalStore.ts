import { create } from "zustand";
import {
  DEFAULT_PORTAL_SETTINGS,
  type Announcement, type Bonus, type CustodyItem, type DeductionItem, type EmployeeDocument, type Loan,
  type Payslip, type PortalNotification, type PortalRequest, type PortalSettings, type SalaryProfile,
  type Survey, type SurveyResponse,
} from "@shared/portal";

export type PortalCollections = {
  requests: PortalRequest[];
  notifications: PortalNotification[];
  salaryProfiles: SalaryProfile[];
  payslips: Payslip[];
  loans: Loan[];
  bonuses: Bonus[];
  deductions: DeductionItem[];
  custody: CustodyItem[];
  documents: EmployeeDocument[];
  announcements: Announcement[];
  surveys: Survey[];
  surveyResponses: SurveyResponse[];
};
export type CollectionKey = keyof PortalCollections;
export type Row<K extends CollectionKey> = PortalCollections[K][number];

export type PortalData = PortalCollections & { settings: PortalSettings; counters: { request: number } };

export const COLLECTION_KEYS: CollectionKey[] = [
  "requests", "notifications", "salaryProfiles", "payslips", "loans", "bonuses", "deductions",
  "custody", "documents", "announcements", "surveys", "surveyResponses",
];

export const emptyPortalData = (): PortalData => ({
  requests: [], notifications: [], salaryProfiles: [], payslips: [], loans: [], bonuses: [], deductions: [],
  custody: [], documents: [], announcements: [], surveys: [], surveyResponses: [],
  settings: { ...DEFAULT_PORTAL_SETTINGS, leaveQuotaOverrides: {} },
  counters: { request: 0 },
});

type PortalActions = {
  /** Insert, or replace the row with the same id. */
  upsert: <K extends CollectionKey>(key: K, row: Row<K>) => void;
  patch: <K extends CollectionKey>(key: K, id: string, changes: Partial<Row<K>>) => void;
  remove: (key: CollectionKey, id: string) => void;
  setSettings: (settings: Partial<PortalSettings>) => void;
  nextRequestCode: () => string;
  replaceAll: (data: Partial<PortalData>) => void;
  reset: () => void;
  snapshot: () => PortalData;
};

export type PortalState = PortalData & PortalActions;

const pick = (s: PortalState): PortalData => ({
  requests: s.requests, notifications: s.notifications, salaryProfiles: s.salaryProfiles, payslips: s.payslips, loans: s.loans,
  bonuses: s.bonuses, deductions: s.deductions, custody: s.custody, documents: s.documents, announcements: s.announcements,
  surveys: s.surveys, surveyResponses: s.surveyResponses, settings: s.settings, counters: s.counters,
});

export const usePortalStore = create<PortalState>((set, get) => ({
  ...emptyPortalData(),

  upsert: (key, row) =>
    set((state) => {
      const list = state[key] as Array<{ id: string }>;
      const exists = list.some((r) => r.id === (row as { id: string }).id);
      const next = exists ? list.map((r) => (r.id === (row as { id: string }).id ? row : r)) : [...list, row];
      return { [key]: next } as Partial<PortalState>;
    }),

  patch: (key, id, changes) =>
    set((state) => ({ [key]: (state[key] as Array<{ id: string }>).map((r) => (r.id === id ? { ...r, ...changes } : r)) }) as Partial<PortalState>),

  remove: (key, id) => set((state) => ({ [key]: (state[key] as Array<{ id: string }>).filter((r) => r.id !== id) }) as Partial<PortalState>),

  setSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } })),

  nextRequestCode: () => {
    const n = get().counters.request + 1;
    set({ counters: { ...get().counters, request: n } });
    return `REQ-${String(n).padStart(3, "0")}`;
  },

  replaceAll: (data) => {
    const base = emptyPortalData();
    set({
      ...base,
      ...data,
      settings: { ...base.settings, ...(data.settings ?? {}) },
      counters: { ...base.counters, ...(data.counters ?? {}) },
    });
  },

  reset: () => set({ ...emptyPortalData() }),
  snapshot: () => pick(get()),
}));
