"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PERSISTENCE_ERROR_EVENT, storage } from "@/data/storage";
import { usePersistenceStatus } from "@/store/persistenceStatus";
import { downloadBlob } from "@/lib/excel";
import { useToast } from "@/hooks/use-toast";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { pushDiagnosticError } from "@/lib/errorHandling";
import { applyTheme, getSavedTheme } from "@/lib/theme";


export function AppShell({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const persistenceStatus = usePersistenceStatus((state) => state.status);
  const persistenceMessage = usePersistenceStatus((state) => state.message);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    applyTheme(getSavedTheme());
    const onError = (event: ErrorEvent) => {
      if (/ResizeObserver loop/i.test(event.message)) return; // harmless browser notice
      pushDiagnosticError(event.error ?? event.message, "window");
    };
    const onRejection = (event: PromiseRejectionEvent) => pushDiagnosticError(event.reason, "promise");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  const showIncompatible = persistenceStatus === "incompatible" && !dismissed;

  useEffect(() => {
    if (persistenceStatus === "unavailable") {
      toast({
        title: "التخزين المحلي غير متاح",
        description: persistenceMessage ?? "لن يتم حفظ البيانات بعد إغلاق الصفحة. صدّر نسخة احتياطية قبل الخروج.",
        variant: "destructive",
      });
    }
  }, [persistenceStatus, persistenceMessage, toast]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { message?: string } | undefined;
      toast({ title: "تعذر حفظ البيانات", description: detail?.message ?? "حدث خطأ أثناء الحفظ.", variant: "destructive" });
    };
    window.addEventListener(PERSISTENCE_ERROR_EVENT, handler);
    return () => window.removeEventListener(PERSISTENCE_ERROR_EVENT, handler);
  }, [toast]);

  useEffect(() => {
    const appErrorHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { message?: string } | undefined;
      if (!detail?.message) return;
      toast({ title: "خطأ تشغيلي", description: detail.message, variant: "destructive" });
    };
    window.addEventListener("app:error", appErrorHandler);
    return () => window.removeEventListener("app:error", appErrorHandler);
  }, [toast]);
  const handleExportIncompatible = async () => {
    downloadBlob(await storage.exportRawBackup(), "storage_backup.json");
  };

  const handleClearStorage = async () => {
    await storage.clear();
    window.location.reload();
  };

  return (
    <TooltipProvider>
      <Toaster />
      <AppErrorBoundary>
        {children}
      </AppErrorBoundary>
      <AlertDialog open={showIncompatible}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>البيانات المخزنة غير متوافقة</AlertDialogTitle>
            <AlertDialogDescription>
              {persistenceMessage ?? "تم العثور على بيانات مخزنة بإصدار غير مدعوم."} لن يتم الحفظ فوق هذه البيانات إلا إذا اخترت مسح التخزين. يمكنك تصدير نسخة منها أولاً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel onClick={() => setDismissed(true)}>متابعة بدون حفظ</AlertDialogCancel>
            <AlertDialogAction onClick={handleExportIncompatible}>تصدير نسخة احتياطية</AlertDialogAction>
            <AlertDialogAction onClick={handleClearStorage}>مسح التخزين</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}


