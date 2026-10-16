"use client";

import { ApprovalInbox } from "@/components/portal/ApprovalInbox";
import { PortalPage } from "@/components/portal/PageFrame";
import { useAttendanceStore } from "@/store/attendanceStore";

export default function PortalTeam() {
  const employees = useAttendanceStore((s) => s.employees);
  return (
    <PortalPage title="طلبات فريقي">
      {(code) => {
        const me = employees.find((e) => e.code === code);
        return <ApprovalInbox actor={{ code, isHr: false, name: me?.nameAr }} scope="mine" />;
      }}
    </PortalPage>
  );
}
