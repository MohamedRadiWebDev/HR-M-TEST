import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  Present: "status-present",
  Absent: "status-absent",
  Late: "status-late",
  Excused: "status-excused",
  "Leave Deduction": "bg-rose-100 text-rose-700 border-rose-200",
  "Excused Absence": "bg-amber-100 text-amber-700 border-amber-200",
  "Termination Period": "bg-slate-200 text-slate-700 border-slate-300",
  "Joining Period": "bg-cyan-100 text-cyan-700 border-cyan-300",
  Friday: "bg-amber-100 text-amber-700 border-amber-200",
  "Friday Attended": "bg-amber-100 text-amber-700 border-amber-200",
  "Comp Day": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "Official Holiday": "bg-blue-100 text-blue-700 border-blue-200",
};

const labels: Record<string, string> = {
  Present: "حضور",
  Absent: "غياب",
  Late: "تأخير",
  Excused: "مأذون",
  "Leave Deduction": "إجازة بالخصم",
  "Excused Absence": "غياب بعذر",
  "Termination Period": "فترة ترك",
  "Joining Period": "فترة التحاق",
  Friday: "جمعة",
  "Friday Attended": "جمعة (حضور)",
  "Comp Day": "يوم بالبدل",
  "Official Holiday": "إجازة رسمية",
};

export function StatusBadge({ status }: { status: string | null }) {
  const baseStyle = styles[status || ""] || "bg-slate-100 text-slate-600";
  const label = labels[status || ""] || status || "-";

  return (
    <div className="flex items-center gap-2">
      <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-bold border", baseStyle)}>
        {label}
      </span>
    </div>
  );
}
