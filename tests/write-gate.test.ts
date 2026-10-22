import { test } from "node:test";
import assert from "node:assert/strict";
import { authCookieHeader, readCookie, safeNext, writeAuthorized } from "../src/lib/write-gate.ts";

test("writeAuthorized fails closed when the secret is missing or empty", () => {
  assert.equal(writeAuthorized(undefined, "anything"), false);
  assert.equal(writeAuthorized("", "anything"), false);
  assert.equal(writeAuthorized(undefined, undefined), false);
});

test("writeAuthorized accepts only an exact match", () => {
  assert.equal(writeAuthorized("s3cret", "s3cret"), true);
  assert.equal(writeAuthorized("s3cret", "s3creT"), false);
  assert.equal(writeAuthorized("s3cret", "s3cret "), false);
  assert.equal(writeAuthorized("s3cret", ""), false);
  assert.equal(writeAuthorized("s3cret", undefined), false);
});

test("readCookie returns the named value and ignores neighbours", () => {
  assert.equal(readCookie("a=1; sotp_write=abc%3D; b=2", "sotp_write"), "abc=");
  assert.equal(readCookie("a=1", "sotp_write"), undefined);
  assert.equal(readCookie(null, "sotp_write"), undefined);
});

test("safeNext stays on the tool path", () => {
  assert.equal(safeNext("/projects/valuation-lab/spacex", "/projects/valuation-lab", "/projects/valuation-lab"), "/projects/valuation-lab/spacex");
  assert.equal(safeNext("https://evil.example", "/projects/valuation-lab", "/projects/valuation-lab"), "/projects/valuation-lab");
  assert.equal(safeNext("//evil.example", "/projects/valuation-lab", "/projects/valuation-lab"), "/projects/valuation-lab");
  assert.equal(safeNext("/projects/stocks", "/projects/valuation-lab", "/projects/valuation-lab"), "/projects/valuation-lab");
});

test("auth cookie is HttpOnly and Secure only on https", () => {
  const local = authCookieHeader("carousell_write", "tok en", false, "/projects/carousell-bot");
  assert.match(local, /HttpOnly/);
  assert.doesNotMatch(local, /Secure/);
  assert.match(local, /carousell_write=tok%20en/);
  assert.match(authCookieHeader("sotp_write", "t", true, "/projects/valuation-lab"), /Secure/);
});
