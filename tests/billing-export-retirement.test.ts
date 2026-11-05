import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Guard the #84 migration: LibreOffice-based direct billing export must not
 * quietly reappear as a broken endpoint, while Google Sheets and the Python
 * finance spreadsheet import remain supported.
 */
function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("retired direct billing export routes, renderer, and local XLSX template stay absent", () => {
  const retired = [
    "app/api/billing/[id]/export/pdf/route.ts",
    "app/api/billing/[id]/export/xlsx/route.ts",
    "lib/billing-export.ts",
    "scripts/render-billing-template.py",
    "public/templates/Neverland請款單.xlsx",
  ];
  for (const path of retired) {
    assert.equal(existsSync(join(process.cwd(), path)), false, `Retired billing exporter unexpectedly restored: ${path}`);
  }
});

test("billing detail exposes Google Sheets, not broken PDF/XLSX download buttons", () => {
  const actions = source("components/BillingDetailActions.tsx");
  assert.match(actions, /\/api\/billing\/\$\{id\}\/google-sheet/);
  assert.match(actions, /Google 試算表/);
  assert.doesNotMatch(actions, /\/api\/billing\/\$\{id\}\/export\/(pdf|xlsx)/);
  assert.doesNotMatch(actions, /匯出 (PDF|XLSX)/);
  assert.match(source("app/api/billing/[id]/google-sheet/route.ts"), /openBillingGoogleSheet/);
  assert.match(source("lib/mcp/billing-tools.ts"), /create_billing_google_sheet/);
});

test("Docker runtime drops LibreOffice/UNO/fonts but preserves Python Finance XLSX import", () => {
  const dockerfile = source("Dockerfile");
  assert.doesNotMatch(dockerfile, /apk add[^\n]*\b(libreoffice|font-noto-cjk|font-liberation)\b/i);
  assert.match(dockerfile, /RUN apk add --no-cache python3/);
  assert.equal(existsSync(join(process.cwd(), "scripts/parse-finance-xlsx.py")), true);
  assert.match(source("app/api/finance/import/preview/route.ts"), /parse-finance-xlsx\.py/);
});

test("CI no longer depends on the deleted renderer or XLSX template", () => {
  const workflow = source(".github/workflows/ci.yml");
  assert.doesNotMatch(workflow, /render-billing-template\.py|public\/templates\/Neverland請款單\.xlsx/);
  assert.doesNotMatch(workflow, /apt-get install[^\n]*libreoffice/i);
  assert.match(workflow, /python3 -m py_compile scripts\/parse-finance-xlsx\.py/);
  assert.match(workflow, /npm run test:parity/);
  assert.match(workflow, /npm run test:integration/);
});
