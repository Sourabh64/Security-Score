"use client";

import { createContext, useCallback, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "./ui";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/actions/run";
import { switchUserAction } from "@/server/actions";

// ------------------------------------------------------------------ toasts
type Toast = { id: number; kind: "ok" | "error"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 max-w-[90vw] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={cn("pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg", t.kind === "error" ? "border-danger/40 bg-surface text-danger" : "border-ok/40 bg-surface text-fg")}>
            {t.kind === "error" ? "⚠ " : "✓ "}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Runs a server action, reports the outcome and refreshes server components. */
export function useRunAction() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const exec = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; confirm?: string; onSuccess?: (data: T | undefined) => void } = {}) => {
      if (opts.confirm && !window.confirm(opts.confirm)) return;
      start(async () => {
        const res = await fn();
        if (res.ok) {
          if (opts.success) toast("ok", opts.success);
          opts.onSuccess?.(res.data);
          router.refresh();
        } else toast("error", res.error);
      });
    },
    [router, toast],
  );
  return { exec, pending };
}

export function ActionButton({
  action, children, confirm, success, variant = "secondary", size = "sm", redirectTo, className, disabled, title,
}: {
  action: () => Promise<ActionResult<unknown>>;
  children: ReactNode;
  confirm?: string;
  success?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  redirectTo?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const { exec, pending } = useRunAction();
  const router = useRouter();
  return (
    <button
      type="button"
      title={title}
      disabled={disabled || pending}
      className={cn(buttonClass(variant, size), className)}
      onClick={() => exec(action, { confirm, success, onSuccess: () => redirectTo && router.push(redirectTo) })}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

// ------------------------------------------------------------------ theme
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("psmh-theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <button type="button" onClick={toggle} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-subtle hover:text-fg" aria-label="Toggle dark mode">
      {dark ? "☀ Light" : "☾ Dark"}
    </button>
  );
}

/** Reads the active theme so SVG charts can use the theme's validated hex steps. */
export function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

// ------------------------------------------------------------------ user switcher (local mode)
export function UserSwitcher({ users, currentId }: { users: { id: string; name: string; role: string }[]; currentId: string | null }) {
  const { exec, pending } = useRunAction();
  return (
    <label className="block">
      <span className="label !mb-1 !text-[10px]">Acting as (local mode)</span>
      <select
        className="input !py-1 !text-xs"
        value={currentId ?? ""}
        disabled={pending}
        onChange={(e) => exec(() => switchUserAction(e.target.value), { success: "Switched user" })}
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} – {u.role.charAt(0) + u.role.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("primary", "md")}>
      {label}
    </button>
  );
}
