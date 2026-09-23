/* Milestone 6 — on-device model verification hash, checked against
   node:crypto, plus the pinned identity of the vendored model. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { sha256HexSync, sha256Hex } from "../js/movement/sha256.js";
import { POSE_MODEL } from "../js/movement/modelVersion.js";
import { loadVerifiedModel, PoseProviderError } from "../js/movement/poseProvider.js";

const ref = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("pure SHA-256 matches node:crypto across padding boundaries", () => {
  const lengths = [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000];
  lengths.forEach((n) => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
    assert.equal(sha256HexSync(b), ref(b), "length " + n);
  });
  assert.equal(sha256HexSync(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("async path uses Web Crypto when present and falls back when it is absent or throws", async () => {
  const b = new Uint8Array(4096).map((_, i) => i % 251);
  assert.equal(await sha256Hex(b, webcrypto.subtle), ref(b));
  assert.equal(await sha256Hex(b, null), ref(b));
  assert.equal(await sha256Hex(b, { digest: async () => { throw new Error("not secure"); } }), ref(b));
});

test("the vendored model is byte-identical to the pinned provenance", () => {
  const bytes = readFileSync(new URL("../vendor/mediapipe/pose_landmarker_full.task", import.meta.url));
  assert.equal(bytes.length, POSE_MODEL.bytes);
  assert.equal(ref(bytes), POSE_MODEL.sha256);
  assert.equal(sha256HexSync(new Uint8Array(bytes)), POSE_MODEL.sha256, "the on-device fallback must agree on the real file");
});

test("loadVerifiedModel accepts the real file and rejects a tampered or truncated one", async () => {
  const bytes = readFileSync(new URL("../vendor/mediapipe/pose_landmarker_full.task", import.meta.url));
  const serve = (b, ok = true) => async () => ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  const verified = await loadVerifiedModel("movement/models/x.task", serve(bytes), webcrypto.subtle);
  assert.equal(verified.length, POSE_MODEL.bytes);

  const tampered = Buffer.from(bytes);
  tampered[1000] ^= 0xff;
  await assert.rejects(loadVerifiedModel("m", serve(tampered), webcrypto.subtle), (e) => e instanceof PoseProviderError && e.code === "model_integrity");
  await assert.rejects(loadVerifiedModel("m", serve(bytes.subarray(0, 100)), null), (e) => e.code === "model_integrity");
  await assert.rejects(loadVerifiedModel("m", serve(bytes, false), null), (e) => e.code === "model_unavailable");
  await assert.rejects(loadVerifiedModel("m", async () => { throw new TypeError("offline"); }, null), (e) => e.code === "model_unavailable");
});
