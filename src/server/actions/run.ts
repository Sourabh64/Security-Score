import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { requireUser } from "../auth";
import { ServiceError } from "../errors";
import { WeightError } from "@/lib/scoring/engine";
import type { Actor } from "../permissions";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Executes a mutation as the current user. Converts validation/domain errors into safe messages.
 * Unexpected errors are logged by type only (never request payloads or evidence content).
 */
export async function run<T>(fn: (actor: Actor) => Promise<T>, opts: { revalidate?: boolean } = {}): Promise<ActionResult<T>> {
  try {
    const actor = await requireUser();
    const data = await fn(actor);
    // Autosave calls skip revalidation: the client applies the returned score itself.
    if (opts.revalidate !== false) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of e.issues) {
        const key = issue.path.join(".") || "_";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: Object.values(fieldErrors)[0] ?? "Invalid input", fieldErrors };
    }
    if (e instanceof ServiceError || e instanceof WeightError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") return { ok: false, error: "A record with this identifier already exists" };
      if (e.code === "P2025") return { ok: false, error: "Record not found" };
      if (e.code === "P2003") return { ok: false, error: "This record is referenced by other records and cannot be changed this way" };
    }
    console.error("[action] unexpected error:", e instanceof Error ? `${e.name}: ${e.message.split("\n")[0]}` : "unknown");
    return { ok: false, error: "Unexpected error. The change was not saved." };
  }
}
