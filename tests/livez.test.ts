import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { GET } from "../app/livez/route";

test("GET /livez returns HTTP 200 with an uncached OK response", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("liveness does not probe external dependencies", () => {
  const source = readFileSync(join(process.cwd(), "app/livez/route.ts"), "utf8");
  assert.doesNotMatch(source, /from ["']@\/lib\/(?:prisma|db|services)|\b(?:fetch|PrismaClient|\$queryRaw|\$executeRaw)\s*\(/);
  assert.doesNotMatch(source, /process\.env\.(?:DATABASE_URL|S3_ENDPOINT|GOOGLE_\w+)/);
});
