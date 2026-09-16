import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateClientMetadataHost, redirectUriMatches, validateAuthorizationResponseIssuer, validateRedirectUri } from "../lib/mcp/oauth";

test("web clients require HTTPS redirect URIs", () => {
  assert.equal(validateRedirectUri("https://chatgpt.com/connector/oauth/callback", "web"), "https://chatgpt.com/connector/oauth/callback");
  assert.throws(() => validateRedirectUri("http://example.com/callback", "web"), /HTTPS/);
});

test("web redirect matching stays exact", () => {
  assert.equal(redirectUriMatches("https://chatgpt.com/connector/oauth/callback", "https://chatgpt.com/connector/oauth/callback", "web"), true);
  assert.equal(redirectUriMatches("https://chatgpt.com/connector/oauth/callback", "https://chatgpt.com/connector/oauth/callback/", "web"), false);
  assert.equal(redirectUriMatches("https://example.com:8443/callback", "https://example.com:9443/callback", "web"), false);
});

test("native clients may use loopback HTTP callbacks", () => {
  assert.equal(validateRedirectUri("http://127.0.0.1:43123/callback/codex", "native"), "http://127.0.0.1:43123/callback/codex");
  assert.equal(validateRedirectUri("http://[::1]:43123/callback/codex", "native"), "http://[::1]:43123/callback/codex");
  assert.equal(validateRedirectUri("http://localhost:43123/callback/codex", "native"), "http://localhost:43123/callback/codex");
});

test("native loopback matching allows Codex ephemeral port changes", () => {
  assert.equal(redirectUriMatches("http://127.0.0.1:43123/callback/codex", "http://127.0.0.1:51742/callback/codex", "native"), true);
  assert.equal(redirectUriMatches("http://127.0.0.1/callback/codex", "http://127.0.0.1:51742/callback/codex", "native"), true);
  assert.equal(redirectUriMatches("http://[::1]:43123/callback/codex", "http://[::1]:51742/callback/codex", "native"), true);
  assert.equal(redirectUriMatches("http://localhost:43123/callback/codex", "http://localhost:51742/callback/codex", "native"), true);
});

test("native loopback matching keeps host path and query exact", () => {
  assert.equal(redirectUriMatches("http://127.0.0.1:43123/callback/codex", "http://localhost:51742/callback/codex", "native"), false);
  assert.equal(redirectUriMatches("http://127.0.0.1:43123/callback/codex", "http://127.0.0.1:51742/callback/other", "native"), false);
  assert.equal(redirectUriMatches("http://127.0.0.1:43123/callback/codex?mode=cli", "http://127.0.0.1:51742/callback/codex?mode=other", "native"), false);
});

test("native HTTP redirects cannot escape the loopback host", () => {
  assert.throws(() => validateRedirectUri("http://192.168.1.10/callback", "native"), /loopback/);
  assert.throws(() => validateRedirectUri("http://127.0.0.1.example.com/callback", "native"), /loopback/);
  assert.throws(() => validateRedirectUri("http://user@127.0.0.1/callback", "native"), /帳密/);
  assert.throws(() => validateRedirectUri("http://127.0.0.1/callback#token", "native"), /fragment/);
});

test("OAuth metadata SSRF filtering blocks local private link-local and reserved addresses", () => {
  for (const host of [
    "localhost",
    "api.localhost",
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) assert.equal(isPrivateClientMetadataHost(host), true, host);
});

test("OAuth metadata SSRF filtering permits ordinary public addresses and hostnames", () => {
  assert.equal(isPrivateClientMetadataHost("8.8.8.8"), false);
  assert.equal(isPrivateClientMetadataHost("1.1.1.1"), false);
  assert.equal(isPrivateClientMetadataHost("example.com"), false);
});

test("RFC 9207 issuer validation rejects missing and mismatched issuers", () => {
  assert.equal(validateAuthorizationResponseIssuer("https://erp.example.com", "https://erp.example.com"), "https://erp.example.com");
  assert.throws(() => validateAuthorizationResponseIssuer(undefined, "https://erp.example.com"), /issuer/);
  assert.throws(() => validateAuthorizationResponseIssuer("https://evil.example", "https://erp.example.com"), /issuer/);
});
