import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/** Personal data (national id, phones, address) is hidden until the user explicitly reveals it. */
export function SensitiveValue({ value, visibleTail = 0 }: { value?: string | null; visibleTail?: number }) {
  const [revealed, setRevealed] = useState(false);
  const text = String(value ?? "").trim();
  if (!text) return <span>-</span>;

  const masked = visibleTail > 0 && text.length > visibleTail ? `${"•".repeat(text.length - visibleTail)}${text.slice(-visibleTail)}` : "•".repeat(Math.min(text.length, 10));
  return (
    <span className="inline-flex items-center gap-1">
      <span dir="ltr">{revealed ? text : masked}</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        aria-label={revealed ? "إخفاء" : "إظهار"}
        onClick={(event) => {
          event.stopPropagation();
          setRevealed((v) => !v);
        }}
      >
        {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </span>
  );
}
