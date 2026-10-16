'use client';

import { Laptop, Moon, Search, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { GlobalSearchDialog } from "@/components/GlobalSearchDialog";
import { ViewAsSwitcher } from "@/components/ViewAsSwitcher";
import { getSavedTheme, setSavedTheme, type ThemeMode } from "@/lib/theme";

export function Header({ title }: { title: string }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return getSavedTheme();
    } catch {
      return "system";
    }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const themeIcon = useMemo(() => {
    if (theme === "dark") return <Moon className="w-4 h-4" />;
    if (theme === "light") return <Sun className="w-4 h-4" />;
    return <Laptop className="w-4 h-4" />;
  }, [theme]);

  const cycleTheme = () => {
    const next: ThemeMode = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    setSavedTheme(next);
  };

  return (
    <header className="bg-background/80 backdrop-blur-sm border-b border-border/50 h-16 flex items-center justify-between px-8 sticky top-0 z-10">
      <h2 className="text-xl font-bold font-display text-foreground">{title}</h2>
      
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
            <Search className="w-4 h-4 ml-2" />
            بحث
          </Button>
          <Button variant="outline" size="sm" onClick={cycleTheme} title="تغيير الثيم">
            {themeIcon}
          </Button>
        </div>
        <div className="flex items-center gap-3 border-r border-border/50 pr-4 mr-1">
          <ViewAsSwitcher />
</div>
      </div>

      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
