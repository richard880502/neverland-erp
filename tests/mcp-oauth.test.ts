import assert from "node:assert/strict";
import test from "node:test";
import { validateRedirectUri } from "../lib/mcp/oauth";

test("web clients require HTTPS redirect URIs", () => {
  assert.equal(validateRedirectUri("https://chatgpt.com/connector/oauth/callback", "web"), "https://chatgpt.com/connector/oauth/callback");
  assert.throws(() => validateRedirectUri("http://example.com/callback", "web"), /HTTPS/);
});

test("native clients may use exact loopback HTTP callbacks", () => {
  assert.equal(validateRedirectUri("http://127.0.0.1:43123/callback/codex", "native"), "http://127.0.0.1:43123/callback/codex");
  assert.equal(validateRedirectUri("http://[::1]:43123/callback/codex", "native"), "http://[::1]:43123/callback/codex");
  assert.equal(validateRedirectUri("http://localhost:43123/callback/codex", "native"), "http://localhost:43123/callback/codex");
});

test("native HTTP redirects cannot escape the loopback host", () => {
  assert.throws(() => validateRedirectUri("http://192.168.1.10/callback", "native"), /loopback/);
  assert.throws(() => validateRedirectUri("http://127.0.0.1.example.com/callback", "native"), /loopback/);
  assert.throws(() => validateRedirectUri("http://user@127.0.0.1/callback", "native"), /帳密/);
  assert.throws(() => validateRedirectUri("http://127.0.0.1/callback#token", "native"), /fragment/);
});
