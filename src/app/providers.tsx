"use client";

import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { AttendanceStoreProvider } from "@/store/AttendanceStoreProvider";

/** Everything here is browser-only: the whole app renders after local data is loaded. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AttendanceStoreProvider>
      <Suspense fallback={null}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </AttendanceStoreProvider>
  );
}
