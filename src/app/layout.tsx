import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { ThemeToggle, Toaster, UserSwitcher } from "@/components/client";
import { getCurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import { ROLE_LABELS } from "@/lib/constants";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = await db.organizationSettings.findUnique({ where: { id: 1 } });
  return { title: s?.appTitle ?? "Product Security Maturity Hub", description: "Internal hybrid maturity model inspired by CMM and OWASP SAMM" };
}

const themeScript = `try{var t=localStorage.getItem('psmh-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [settings, user, users] = await Promise.all([
    db.organizationSettings.findUnique({ where: { id: 1 } }),
    getCurrentUser(),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
  ]);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <Toaster>
          <div className="flex min-h-screen">
            <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
              <div className="mb-5 flex items-start gap-2 px-1">
                <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-accent" aria-hidden />
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-tight">{settings?.appTitle ?? "Product Security Maturity Hub"}</div>
                  <div className="truncate text-xs text-muted">{settings?.orgName}</div>
                </div>
              </div>
              <Nav />
              <div className="mt-auto space-y-3 border-t border-line pt-3">
                <UserSwitcher users={users} currentId={user?.id ?? null} />
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{user ? ROLE_LABELS[user.role] : "No user"}</span>
                  <ThemeToggle />
                </div>
                <p className="text-[10px] leading-snug text-muted">
                  Internal hybrid maturity model inspired by CMM and OWASP SAMM. Not an official OWASP SAMM assessment.
                </p>
              </div>
            </aside>
            <div className="min-w-0 flex-1">
              <div className="no-print flex items-center justify-between border-b border-line bg-surface px-4 py-2 lg:hidden">
                <span className="text-sm font-semibold">{settings?.appTitle}</span>
                <details className="relative">
                  <summary className="cursor-pointer text-sm text-muted">Menu</summary>
                  <div className="absolute right-0 z-40 mt-2 w-64 rounded-md border border-line bg-surface p-3 shadow-lg">
                    <Nav />
                    <div className="mt-3 border-t border-line pt-3">
                      <UserSwitcher users={users} currentId={user?.id ?? null} />
                      <div className="mt-2"><ThemeToggle /></div>
                    </div>
                  </div>
                </details>
              </div>
              <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
            </div>
          </div>
        </Toaster>
      </body>
    </html>
  );
}
