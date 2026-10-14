import type { Role } from "@/lib/constants";
import { forbidden } from "./errors";

export type Permission =
  | "project:write"
  | "project:delete"
  | "assessment:write"
  | "assessment:review"
  | "evidence:write"
  | "evidence:verify"
  | "action:write"
  | "action:close"
  | "action:acceptRisk"
  | "framework:admin"
  | "settings:admin"
  | "users:admin";

const MATRIX: Record<Role, Permission[]> = {
  ADMIN: [
    "project:write", "project:delete", "assessment:write", "assessment:review", "evidence:write", "evidence:verify",
    "action:write", "action:close", "action:acceptRisk", "framework:admin", "settings:admin", "users:admin",
  ],
  ASSESSOR: ["project:write", "assessment:write", "evidence:write", "action:write", "action:close"],
  REVIEWER: ["assessment:review", "evidence:write", "evidence:verify", "action:write", "action:close", "action:acceptRisk"],
  VIEWER: [],
};

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  if (!actor) return false;
  return MATRIX[actor.role]?.includes(permission) ?? false;
}

export function requirePermission(actor: Actor | null | undefined, permission: Permission): asserts actor is Actor {
  if (!can(actor, permission)) throw forbidden();
}

export function permissionsFor(role: Role): Permission[] {
  return MATRIX[role] ?? [];
}
