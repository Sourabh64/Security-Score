import "server-only";
import { cookies } from "next/headers";
import { db } from "./db";
import type { Actor } from "./permissions";
import type { Role } from "@/lib/constants";

/**
 * LOCAL SINGLE-ORGANIZATION DEPLOYMENT MODE
 * -----------------------------------------
 * This build has no password/SSO authentication. The acting user is selected in the sidebar
 * ("Acting as") and stored in an httpOnly cookie. Every mutation is still authorized on the
 * server against that user's role, so role boundaries are enforced consistently - but anyone
 * with access to the app can switch users. For a multi-user deployment, replace getCurrentUser()
 * with your identity provider (OIDC/SAML via a reverse proxy or NextAuth) - see README.
 */
export const USER_COOKIE = "psmh_actor";

export async function getCurrentUser(): Promise<Actor | null> {
  const store = await cookies();
  const id = store.get(USER_COOKIE)?.value;
  let user = id ? await db.user.findFirst({ where: { id, active: true } }) : null;
  if (!user) user = await db.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" } });
  if (!user) return null;
  return { id: user.id, name: user.name, role: user.role as Role };
}

export async function requireUser(): Promise<Actor> {
  const u = await getCurrentUser();
  if (!u) throw new Error("No active users configured. Run the seed script.");
  return u;
}
