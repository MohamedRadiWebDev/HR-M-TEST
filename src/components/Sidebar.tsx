import { Link, useLocation } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Users, 
  CalendarCheck, 
  Grid2x2,
  Settings, 
  Upload, 
  Briefcase,
  ClipboardList,
  Archive,
  Sparkles,
  Bug,
  SlidersHorizontal,
  Inbox, Wallet, Package, Megaphone, UserCircle, Calendar, Bell, FileText, Users2, Clock, CalendarDays,
  Receipt, HandCoins, Gift, MinusCircle, FolderOpen, ClipboardCheck
} from "lucide-react";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { useViewAs } from "@/store/viewAsStore";

const hrNavigation = [
  { name: 'لوحة التحكم', href: '/', icon: LayoutDashboard },
  { name: 'الموظفين', href: '/employees', icon: Users },
  { name: 'الحضور والانصراف', href: '/attendance', icon: CalendarCheck },
  { name: 'خريطة الحضور', href: '/attendance-heatmap', icon: Grid2x2 },
  { name: 'التسويات والإجازات', href: '/adjustments', icon: Briefcase },
  { name: 'إدارة الإجازات', href: '/leaves', icon: ClipboardList },
  { name: 'إدارة المؤثرات', href: '/effects', icon: Sparkles },
  { name: 'القواعد والورديات', href: '/rules', icon: Settings },
  { name: 'استيراد بيانات', href: '/import', icon: Upload },
  { name: 'طلبات الموظفين', href: '/hr/requests', icon: Inbox },
  { name: 'الرواتب والسلف', href: '/hr/payroll', icon: Wallet },
  { name: 'العهد والمستندات', href: '/hr/assets', icon: Package },
  { name: 'الإعلانات والاستبيانات', href: '/hr/communication', icon: Megaphone },
  { name: 'الإعدادات', href: '/settings', icon: SlidersHorizontal },
  { name: 'النسخ الاحتياطي', href: '/backup', icon: Archive },
  { name: 'التشخيص', href: '/diagnostics', icon: Bug },
];

const portalNavigation = [
  { name: 'لوحتي', href: '/portal', icon: LayoutDashboard },
  { name: 'ملفي الشخصي', href: '/portal/profile', icon: UserCircle },
  { name: 'التقويم', href: '/portal/calendar', icon: Calendar },
  { name: 'الإشعارات', href: '/portal/notifications', icon: Bell },
  { name: 'طلباتي', href: '/portal/requests', icon: FileText },
  { name: 'طلبات فريقي', href: '/portal/team', icon: Users2 },
  { name: 'حضوري', href: '/portal/attendance', icon: Clock },
  { name: 'إجازاتي وأرصدتي', href: '/portal/leaves', icon: CalendarDays },
  { name: 'قسائم راتبي', href: '/portal/payslips', icon: Receipt },
  { name: 'سلفي', href: '/portal/loans', icon: HandCoins },
  { name: 'مكافآتي', href: '/portal/bonuses', icon: Gift },
  { name: 'خصوماتي', href: '/portal/deductions', icon: MinusCircle },
  { name: 'عهدي', href: '/portal/custody', icon: Package },
  { name: 'مستنداتي', href: '/portal/documents', icon: FolderOpen },
  { name: 'الإعلانات', href: '/portal/announcements', icon: Megaphone },
  { name: 'الاستبيانات', href: '/portal/surveys', icon: ClipboardCheck },
];

export function Sidebar() {
  const mode = useViewAs((s) => s.mode);
  const employeeCode = useViewAs((s) => s.employeeCode);
  const unread = usePortalStore((s) => s.notifications.filter((n) => !n.read && n.employeeCode === employeeCode).length);
  const employeeName = useAttendanceStore((s) => s.employees.find((e) => e.code === employeeCode)?.nameAr);
  const navigation = mode === 'hr' ? hrNavigation : portalNavigation;
  const [location] = useLocation();

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground border-l border-sidebar-border/60 shadow-sm w-72">
      <div className="p-6 border-b border-sidebar-border/60">
        <h1 className="text-2xl font-display font-bold text-primary flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <CalendarCheck className="w-5 h-5 text-primary" />
          </div>
          نظام الموارد البشرية
        </h1>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer group font-medium",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                )}
              >
                <item.icon className={cn("w-5 h-5", isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-primary")} />
                {item.name}
                {item.href === '/portal/notifications' && unread > 0 && (
                  <span className="mr-auto rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{unread}</span>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border/60">
        <div className="bg-sidebar-accent/60 rounded-xl p-4 border border-sidebar-border/60">
          <p className="text-xs text-muted-foreground text-center">الإصدار 1.0.0 &copy; 2024</p>
        </div>
      </div>
    </div>
  );
}
