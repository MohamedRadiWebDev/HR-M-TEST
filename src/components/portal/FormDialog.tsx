"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "time" | "select" | "textarea" | "file";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  /** Show the field only when this returns true for the current values. */
  when?: (values: Record<string, string>) => boolean;
};

/** Small generic form modal used by every create/edit action of the portal. */
export function FormDialog({
  open, onOpenChange, title, fields, initial, submitLabel = "حفظ", onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  fields: Field[];
  initial?: Record<string, string>;
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValues({ ...Object.fromEntries(fields.map((f) => [f.name, f.type === "select" ? f.options?.[0]?.value ?? "" : ""])), ...(initial ?? {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visible = fields.filter((f) => !f.when || f.when(values));

  const submit = async () => {
    const missing = visible.find((f) => f.required && !String(values[f.name] ?? "").trim());
    if (missing) return toast({ title: "بيانات ناقصة", description: `${missing.label} مطلوب.`, variant: "destructive" });
    setBusy(true);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (error) {
      toast({ title: "تعذر الحفظ", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {visible.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label>{f.label}{f.required ? " *" : ""}</Label>
              {f.type === "select" ? (
                <select className="h-10 w-full rounded-md border border-input bg-background px-3" value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                  {f.options?.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              ) : f.type === "textarea" ? (
                <Textarea value={values[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              ) : f.type === "file" ? (
                <Input
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) return toast({ title: "الملف كبير", description: "الحد الأقصى 2 ميجابايت.", variant: "destructive" });
                    const reader = new FileReader();
                    reader.onload = () => setValues((v) => ({ ...v, [f.name]: String(reader.result), [`${f.name}Name`]: file.name }));
                    reader.readAsDataURL(file);
                  }}
                />
              ) : (
                <Input type={f.type ?? "text"} value={values[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              )}
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "جاري الحفظ…" : submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
