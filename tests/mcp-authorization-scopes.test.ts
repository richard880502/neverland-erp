import assert from "node:assert/strict";
import test from "node:test";
import { consentScopeOptions, selectedConsentScopes } from "../lib/mcp/authorization-scopes";

test("consent page exposes all supported billing and finance scopes even when not requested", () => {
  const options = consentScopeOptions(["dashboard:read"]);
  const billingRead = options.find((option) => option.scope === "billing:read");
  const billingWrite = options.find((option) => option.scope === "billing:write");
  const financeRead = options.find((option) => option.scope === "finance:read");

  assert.ok(billingRead);
  assert.ok(billingWrite);
  assert.ok(financeRead);
  assert.equal(billingRead.requested, false);
  assert.equal(billingWrite.requested, false);
  assert.equal(financeRead.requested, false);
  assert.equal(options.find((option) => option.scope === "dashboard:read")?.requested, true);
});

test("selected consent scopes may include supported scopes that were not in the original client request", () => {
  assert.deepEqual(selectedConsentScopes([
    "dashboard:read",
    "billing:read",
    "finance:read",
    "billing:write",
    "unsupported:scope",
    "billing:read",
  ]), ["dashboard:read", "billing:read", "finance:read", "billing:write"]);
});

test("selected consent scopes reject unsupported and non-string values", () => {
  assert.deepEqual(selectedConsentScopes(["finance:read", 123, null, "not-real"]), ["finance:read"]);
});
