import { useEffect, useRef, useState, type ReactNode } from "react";
import { applySnapshot, buildSnapshot, useAttendanceStore } from "@/store/attendanceStore";
import { useEffectsStore } from "@/store/effectsStore";
import { storage } from "@/data/storage";
import { usePortalStore, type PortalData } from "@/store/portalStore";
import { usePersistenceStatus } from "@/store/persistenceStatus";

const PERSIST_DEBOUNCE_MS = 600;

/** Renders children only after saved data has been loaded, then keeps IndexedDB in sync. */
export function AttendanceStoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const writesEnabled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const status = usePersistenceStatus.getState();

    (async () => {
      const result = await storage.load();
      if (cancelled) return;

      if (result.status === "ok" || result.status === "none") {
        const portal = (await storage.loadPortal()) as Partial<PortalData> | null;
        if (portal && !cancelled) usePortalStore.getState().replaceAll(portal);
      }
      if (cancelled) return;

      if (result.status === "ok") {
        applySnapshot(result.snapshot);
        writesEnabled.current = true;
        if (result.migratedFromLegacy) {
          try {
            await storage.save(result.snapshot);
            storage.removeLegacy();
          } catch {
            // keep legacy copy until a save succeeds
          }
        }
        status.setStatus("ready");
      } else if (result.status === "none") {
        writesEnabled.current = true;
        status.setStatus("ready");
      } else if (result.status === "incompatible") {
        // NEVER write while the stored data is unreadable – that would destroy it.
        writesEnabled.current = false;
        status.setStatus("incompatible", result.reason);
      } else {
        writesEnabled.current = false;
        status.setStatus("unavailable", result.reason);
      }
      void storage.requestPersistence();
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;
    let portalDirty = false;

    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!writesEnabled.current) return;
      if (portalDirty) {
        portalDirty = false;
        void storage.savePortal(usePortalStore.getState().snapshot()).catch(() => {
          portalDirty = true;
        });
      }
      if (!dirty) return;
      dirty = false;
      const snapshot = buildSnapshot();
      void storage.save(snapshot, { autoBackup: snapshot.state.config.autoBackupEnabled }).catch(() => {
        dirty = true; // retry on next change
      });
    };

    const schedulePortal = () => {
      if (!writesEnabled.current) return;
      portalDirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, PERSIST_DEBOUNCE_MS);
    };

    const schedule = () => {
      if (!writesEnabled.current) return;
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, PERSIST_DEBOUNCE_MS);
    };

    const unsubAttendance = useAttendanceStore.subscribe(schedule);
    const unsubEffects = useEffectsStore.subscribe(schedule);
    const unsubPortal = usePortalStore.subscribe(schedulePortal);
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);

    return () => {
      flush();
      unsubAttendance();
      unsubEffects();
      unsubPortal();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground" dir="rtl">
        جاري تحميل البيانات المحفوظة...
      </div>
    );
  }
  return <>{children}</>;
}
