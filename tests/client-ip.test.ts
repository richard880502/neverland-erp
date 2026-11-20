import assert from "node:assert/strict";
import test from "node:test";
import { getClientIp, isCloudflareIp } from "../lib/client-ip";

function request(headers: Record<string, string>) {
  return new Request("https://erp.example.test/", { headers });
}

test("uses CF-Connecting-IP when the peer is a Cloudflare edge", () => {
  assert.equal(getClientIp(request({ "x-forwarded-for": "172.70.1.2", "cf-connecting-ip": "1.2.3.4" })), "1.2.3.4");
  assert.equal(getClientIp(request({ "x-forwarded-for": "2a06:98c1:3120::5", "cf-connecting-ip": "2001:db8::1" })), "2001:db8::1");
});

test("ignores CF-Connecting-IP from a peer outside Cloudflare", () => {
  assert.equal(getClientIp(request({ "x-forwarded-for": "45.9.9.9", "cf-connecting-ip": "6.6.6.6" })), "45.9.9.9");
  assert.equal(getClientIp(request({ "x-forwarded-for": "162.158.10.10, 45.9.9.9", "cf-connecting-ip": "6.6.6.6" })), "45.9.9.9");
});

test("falls back to the peer when CF-Connecting-IP is missing or invalid", () => {
  assert.equal(getClientIp(request({ "x-forwarded-for": "172.70.1.2" })), "172.70.1.2");
  assert.equal(getClientIp(request({ "x-forwarded-for": "172.70.1.2", "cf-connecting-ip": "not-an-ip" })), "172.70.1.2");
  assert.equal(getClientIp(request({ "x-real-ip": "10.0.0.7" })), "10.0.0.7");
  assert.equal(getClientIp(request({})), null);
  assert.equal(getClientIp(undefined), null);
});

test("Cloudflare range edges", () => {
  assert.equal(isCloudflareIp("104.23.255.1"), true);
  assert.equal(isCloudflareIp("104.15.255.255"), false);
  assert.equal(isCloudflareIp("garbage"), false);
});
