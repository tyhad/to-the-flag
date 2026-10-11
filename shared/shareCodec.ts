/**
 * Pure scenario share link encoder/decoder.
 * Shared between server and browser.
 * Uses CompressionStream("deflate-raw") + base64url with a "v1." version prefix.
 */
import type { Scenario } from "../engine/types";

export const SHARE_CODEC_VERSION = "v1.";

async function compressString(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const response = new Response(stream);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function decompressBytes(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const response = new Response(stream);
  return await response.text();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  const base64 = btoa(bin);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)!;
  }
  return bytes;
}

export async function encodeScenario(scenario: Scenario, contenders?: string[]): Promise<string> {
  const payload = {
    locks: scenario.locks ?? {},
    contenders: contenders && contenders.length > 0 ? contenders : undefined,
  };
  const json = JSON.stringify(payload);
  const compressed = await compressString(json);
  const b64 = bytesToBase64Url(compressed);
  return `${SHARE_CODEC_VERSION}${b64}`;
}

export async function decodeScenario(encoded: string): Promise<{ scenario: Scenario; contenders?: string[] }> {
  if (typeof encoded !== "string" || !encoded.startsWith(SHARE_CODEC_VERSION)) {
    throw new Error(`Unsupported or missing version prefix in share code. Expected "${SHARE_CODEC_VERSION}"`);
  }
  const body = encoded.slice(SHARE_CODEC_VERSION.length);
  if (!body) throw new Error("Empty share code payload");

  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(body);
  } catch {
    throw new Error("Invalid base64url string in share code");
  }

  let jsonText: string;
  try {
    jsonText = await decompressBytes(bytes);
  } catch {
    throw new Error("Failed to decompress share code data");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Invalid JSON in decompressed share code data");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Share code payload is not an object");
  }

  const locks = typeof parsed.locks === "object" && parsed.locks !== null ? parsed.locks : {};
  const contenders = Array.isArray(parsed.contenders) ? parsed.contenders : undefined;

  return {
    scenario: { locks },
    contenders,
  };
}
