import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Single PrismaClient per process. All queries are parameterised by Prisma. */
export const db: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: process.env.PRISMA_LOG === "1" ? ["query", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Db = PrismaClient;
export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
