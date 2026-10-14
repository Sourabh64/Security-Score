"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, FolderKanban, ClipboardCheck, Grid3x3, BarChartHorizontal, Layers, ListTodo, FileCheck2, FileText, BookOpen, Settings,
} from "lucide-react";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/assessments", label: "Assessments", icon: ClipboardCheck },
  { href: "/heatmap", label: "Heatmap", icon: Grid3x3 },
  { href: "/compare", label: "Compare products", icon: BarChartHorizontal },
  { href: "/domains", label: "Security domains", icon: Layers },
  { href: "/actions", label: "Remediation", icon: ListTodo },
  { href: "/evidence", label: "Evidence", icon: FileCheck2 },
  { href: "/reports", label: "Reports & exports", icon: FileText },
  { href: "/framework", label: "Framework", icon: BookOpen },
  { href: "/admin", label: "Administration", icon: Settings },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition",
              active ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-subtle hover:text-fg",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
