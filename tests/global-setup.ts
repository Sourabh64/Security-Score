import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Builds a fresh, isolated SQLite test database (prisma/test.db) by applying the real migrations.
 * Only the test-owned database file is removed; the development database (prisma/dev.db) is never touched.
 */
export default function setup() {
  const root = path.resolve(__dirname, "..");
  for (const f of ["test.db", "test.db-journal"]) rmSync(path.join(root, "prisma", f), { force: true });
  execSync("npx prisma migrate deploy", {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: "file:./test.db", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
}
