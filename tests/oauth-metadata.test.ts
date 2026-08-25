import assert from "node:assert/strict";
import test from "node:test";
import { GET as getAuthorizationMetadata } from "../app/oauth-metadata/authorization-server/route";
import { GET as getProtectedMetadata } from "../app/.well-known/oauth-protected-resource/mcp/route";

test("authorization metadata advertises RFC 9207 and CIMD", async () => {
  const response = await getAuthorizationMetadata(new Request("https://erp.example.com/oauth-metadata/authorization-server"));
  assert.equal(response.status, 200);
  const metadata = await response.json() as Record<string, unknown>;
  assert.equal(metadata.issuer, "https://erp.example.com");
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.equal(metadata.client_id_metadata_document_supported, true);
  assert.equal(metadata.registration_endpoint, "https://erp.example.com/register");
  assert.ok((metadata.scopes_supported as string[]).includes("offline_access"));
});

test("path-specific protected-resource metadata matches the MCP resource", async () => {
  const response = await getProtectedMetadata(new Request("https://erp.example.com/.well-known/oauth-protected-resource/mcp"));
  assert.equal(response.status, 200);
  const metadata = await response.json() as Record<string, unknown>;
  assert.equal(metadata.resource, "https://erp.example.com/mcp");
  assert.deepEqual(metadata.authorization_servers, ["https://erp.example.com"]);
  assert.ok((metadata.scopes_supported as string[]).includes("offline_access"));
});
