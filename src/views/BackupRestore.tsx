import { useMemo, useRef, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { useToast } from "@/hooks/use-toast";
import { applySnapshot, useAttendanceStore } from "@/store/attendanceStore";
import { useEffectsStore } from "@/store/effectsStore";
import { storage } from "@/data/storage";
import { downloadBlob } from "@/lib/excel";
import {
  BACKUP_MODULES,
  BackupPasswordRequiredError,
  backupFileName,
  buildBackupPayload,
  createBackupBlob,
  readBackupFile,
  restoreBackup,
  type BackupModuleKey,
  type BackupPayload,
} from "@/backup/backupService";

type RestoreMode = "replace" | "merge";
const allSelected = () => Object.fromEntries(BACKUP_MODULES.map((m) => [m.key, true])) as Record<BackupModuleKey, boolean>;

export default function BackupRestore() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFile = useRef<File | null>(null);

  const employees = useAttendanceStore((s) => s.employees);
  const punches = useAttendanceStore((s) => s.punches);
  const attendanceRecords = useAttendanceStore((s) => s.attendanceRecords);
  const rules = useAttendanceStore((s) => s.rules);
  const leaves = useAttendanceStore((s) => s.leaves);
  const adjustments = useAttendanceStore((s) => s.adjustments);
  const officialHolidays = useAttendanceStore((s) => s.officialHolidays);
  const effects = useEffectsStore((s) => s.effects);
  const config = useAttendanceStore((s) => s.config);
  const setConfig = useAttendanceStore((s) => s.setConfig);

  const [selected, setSelected] = useState(allSelected);
  const [exportPassword, setExportPassword] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [preview, setPreview] = useState<BackupPayload | null>(null);
  const [restoreSelection, setRestoreSelection] = useState(allSelected);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("merge");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const counts: Record<BackupModuleKey, number> = useMemo(
    () => ({
      employees: employees.length,
      punches: punches.length,
      attendanceRecords: attendanceRecords.length,
      rules: rules.length,
      leaves: leaves.length,
      adjustments: adjustments.length,
      officialHolidays: officialHolidays.length,
      effects: effects.length,
      config: 1,
    }),
    [employees, punches, attendanceRecords, rules, leaves, adjustments, officialHolidays, effects]
  );

  const fail = (title: string, error: unknown) =>
    toast({ title, description: error instanceof Error ? error.message : String(error), variant: "destructive" });

  const handleExport = async () => {
    const modules = BACKUP_MODULES.filter((m) => selected[m.key]).map((m) => m.key);
    if (modules.length === 0) return toast({ title: "اختر قسماً واحداً على الأقل", variant: "destructive" });
    setBusy(true);
    try {
      const payload = buildBackupPayload({
        state: useAttendanceStore.getState().getSnapshot(),
        effects: useEffectsStore.getState().effects,
        selectedModules: modules,
      });
      const password = exportPassword.trim() || undefined;
      downloadBlob(await createBackupBlob(payload, password), backupFileName(Boolean(password)));
      toast({ title: "تم التصدير", description: password ? "النسخة مشفّرة بكلمة المرور. احتفظ بها في مكان آمن." : "تنبيه: النسخة تحتوي بيانات الموظفين بدون تشفير." });
    } catch (error) {
      fail("فشل التصدير", error);
    } finally {
      setBusy(false);
    }
  };

  const loadFile = async (file: File, password?: string) => {
    setBusy(true);
    try {
      const payload = await readBackupFile(file, password);
      pendingFile.current = file;
      setNeedsPassword(false);
      setPreview(payload);
      setRestoreSelection(Object.fromEntries(BACKUP_MODULES.map((m) => [m.key, payload.modules[m.key] !== undefined])) as Record<BackupModuleKey, boolean>);
    } catch (error) {
      if (error instanceof BackupPasswordRequiredError) {
        pendingFile.current = file;
        setNeedsPassword(true);
        setPreview(null);
      } else {
        setPreview(null);
        fail("تعذر قراءة النسخة", error);
      }
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!preview) return;
    setConfirmOpen(false);
    setBusy(true);
    try {
      const modules = BACKUP_MODULES.filter((m) => restoreSelection[m.key] && preview.modules[m.key] !== undefined).map((m) => m.key);
      const summary = await restoreBackup(preview, { mode: restoreMode, modules });
      toast({
        title: "تمت الاستعادة",
        description: `${Object.values(summary).reduce((a, b) => a + b, 0)} عنصر. يمكنك التراجع من زر "استرجاع الحالة قبل الاستعادة".`,
      });
      setPreview(null);
    } catch (error) {
      fail("فشلت الاستعادة", error);
    } finally {
      setBusy(false);
    }
  };

  const undoRestore = async () => {
    const saved = await storage.loadPreRestoreSnapshot();
    if (!saved) return toast({ title: "لا توجد حالة سابقة للاسترجاع", variant: "destructive" });
    applySnapshot(saved.snapshot);
    toast({ title: "تم الاسترجاع", description: `تمت العودة لحالة ${new Date(saved.createdAt).toLocaleString("ar-EG")}` });
  };

  const restoreAuto = async () => {
    const saved = await storage.loadAutoBackup();
    if (!saved) return toast({ title: "لا توجد نسخة تلقائية محفوظة", variant: "destructive" });
    await storage.savePreRestoreSnapshot().catch(() => undefined);
    applySnapshot(saved.snapshot);
    toast({ title: "تم استرجاع النسخة التلقائية", description: new Date(saved.createdAt).toLocaleString("ar-EG") });
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="النسخ الاحتياطي والاستعادة" />
        <main className="flex-1 overflow-y-auto p-8 space-y-6" dir="rtl">
          <Card>
            <CardHeader>
              <CardTitle>تصدير نسخة احتياطية</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {BACKUP_MODULES.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3">
                    <Checkbox checked={selected[key]} onCheckedChange={(v) => setSelected((p) => ({ ...p, [key]: Boolean(v) }))} />
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">({counts[key]})</span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="password"
                  className="w-64"
                  placeholder="كلمة مرور للتشفير (اختياري، موصى بها)"
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                />
                <Button onClick={handleExport} disabled={busy}>تصدير النسخة الاحتياطية</Button>
              </div>
              <p className="text-xs text-muted-foreground">النسخة تحتوي بيانات شخصية (الرقم القومي، العناوين، الهواتف). استخدم كلمة مرور قوية ولا تضعها في مكان مشترك.</p>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Switch checked={config.autoBackupEnabled} onCheckedChange={(v) => setConfig({ ...config, autoBackupEnabled: v })} />
                <span>نسخة تلقائية داخل المتصفح (تُحدَّث مع كل حفظ)</span>
                <Button variant="outline" size="sm" onClick={restoreAuto}>استرجاع النسخة التلقائية</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>استعادة نسخة احتياطية</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".zip,.hrbak"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void loadFile(file);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busy}>اختيار ملف النسخة الاحتياطية</Button>
                <Select value={restoreMode} onValueChange={(v) => setRestoreMode(v as RestoreMode)}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merge">دمج دون تكرار (الأكثر أماناً)</SelectItem>
                    <SelectItem value="replace">استبدال بالكامل</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" onClick={undoRestore}>استرجاع الحالة قبل آخر استعادة</Button>
              </div>

              {needsPassword && (
                <div className="flex flex-wrap items-center gap-3">
                  <Input type="password" className="w-64" placeholder="كلمة مرور النسخة" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} />
                  <Button onClick={() => pendingFile.current && loadFile(pendingFile.current, restorePassword)} disabled={busy || !restorePassword}>فك التشفير</Button>
                </div>
              )}

              {preview && (
                <div className="space-y-3 border rounded-lg p-4 bg-muted/40">
                  <div className="text-sm text-muted-foreground">تاريخ النسخة: {new Date(preview.meta.createdAt).toLocaleString("ar-EG")}</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {BACKUP_MODULES.filter((m) => preview.modules[m.key] !== undefined).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-3">
                        <Checkbox checked={restoreSelection[key]} onCheckedChange={(v) => setRestoreSelection((p) => ({ ...p, [key]: Boolean(v) }))} />
                        <span className="text-sm font-medium">{label}</span>
                        <span className="text-xs text-muted-foreground">({preview.meta.recordCounts?.[key] ?? 0})</span>
                      </label>
                    ))}
                  </div>
                  <Button onClick={() => (restoreMode === "replace" ? setConfirmOpen(true) : void doRestore())} disabled={busy}>
                    استعادة البيانات المحددة
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>استبدال البيانات الحالية؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم استبدال الأقسام المحددة بمحتوى النسخة. يتم حفظ نسخة من حالتك الحالية أولاً، ويمكنك التراجع بزر "استرجاع الحالة قبل آخر استعادة".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doRestore()}>استبدال</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
