"use client";

import type { ReactNode } from "react";

export type Column<T> = { header: string; cell: (row: T) => ReactNode; className?: string };

export function DataTable<T>({ columns, rows, empty = "لا توجد بيانات.", rowKey }: { columns: Column<T>[]; rows: T[]; empty?: string; rowKey: (row: T) => string }) {
  if (rows.length === 0) return <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">{empty}</div>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm text-right">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>{columns.map((c) => (<th key={c.header} className="px-4 py-3 font-medium whitespace-nowrap">{c.header}</th>))}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-muted/30">
              {columns.map((c) => (<td key={c.header} className={`px-4 py-3 ${c.className ?? ""}`}>{c.cell(row)}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
