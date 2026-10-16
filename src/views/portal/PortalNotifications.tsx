"use client";

import { useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalPage } from "@/components/portal/PageFrame";
import { useLocation } from "@/lib/nav";
import { usePortalStore } from "@/store/portalStore";
import { cn } from "@/lib/utils";

function Notifications({ code }: { code: string }) {
  const [, navigate] = useLocation();
  const all = usePortalStore((s) => s.notifications);
  const patch = usePortalStore((s) => s.patch);
  const remove = usePortalStore((s) => s.remove);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const mine = all.filter((n) => n.employeeCode === code).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shown = unreadOnly ? mine.filter((n) => !n.read) : mine;
  const unread = mine.filter((n) => !n.read);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant={unreadOnly ? "outline" : "default"} size="sm" onClick={() => setUnreadOnly(false)}>الكل ({mine.length})</Button>
          <Button variant={unreadOnly ? "default" : "outline"} size="sm" onClick={() => setUnreadOnly(true)}>غير مقروءة ({unread.length})</Button>
        </div>
        <Button variant="ghost" size="sm" disabled={unread.length === 0} onClick={() => unread.forEach((n) => patch("notifications", n.id, { read: true }))}>تعليم الكل كمقروء</Button>
      </div>
      {shown.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">لا توجد إشعارات.</div>}
      {shown.map((n) => (
        <div
          key={n.id}
          className={cn("flex items-start gap-3 rounded-xl border bg-card p-4", !n.read && "border-primary/40 bg-primary/5", n.link && "cursor-pointer")}
          onClick={() => { patch("notifications", n.id, { read: true }); if (n.link) navigate(n.link); }}
        >
          <Bell className="mt-1 h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="font-semibold">{n.title}</div>
            {n.body && <div className="text-sm text-muted-foreground">{n.body}</div>}
            <div className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString("ar-EG")}</div>
          </div>
          <Button variant="ghost" size="icon" aria-label="حذف" onClick={(e) => { e.stopPropagation(); remove("notifications", n.id); }}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
    </>
  );
}

export default function PortalNotifications() {
  return <PortalPage title="الإشعارات">{(code) => <Notifications code={code} />}</PortalPage>;
}
