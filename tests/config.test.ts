import { afterEach, describe, expect, it, vi } from "vitest";

import { describeAfsConfig, getAppBaseUrl, parseAfsConfig } from "@/lib/payments/afs/config";
import { AfsError } from "@/lib/payments/afs/errors";

const VALID = {
  AFS_ENTITY_ID: "test-entity-id",
  AFS_ACCESS_TOKEN: "test-token-value",
  AFS_BASE_URL: "https://eu-test.oppwa.com/",
  AFS_CURRENCY: "AED",
};

describe("parseAfsConfig", () => {
  it("accepts a complete TEST configuration", () => {
    const config = parseAfsConfig(VALID);
    expect(config.entityId).toBe(VALID.AFS_ENTITY_ID);
    expect(config.baseUrl).toBe("https://eu-test.oppwa.com/");
    expect(config.currency).toBe("AED");
    expect(config.webhookDecryptionKey).toBeNull();
  });

  it("defaults base URL and currency when they are absent", () => {
    const config = parseAfsConfig({
      AFS_ENTITY_ID: VALID.AFS_ENTITY_ID,
      AFS_ACCESS_TOKEN: VALID.AFS_ACCESS_TOKEN,
    });
    expect(config.baseUrl).toBe("https://eu-test.oppwa.com/");
    expect(config.currency).toBe("AED");
  });

  it("normalises a base URL without a trailing slash", () => {
    const config = parseAfsConfig({ ...VALID, AFS_BASE_URL: "https://eu-test.oppwa.com" });
    expect(config.baseUrl).toBe("https://eu-test.oppwa.com/");
  });

  it("rejects a missing entity id", () => {
    expect(() => parseAfsConfig({ ...VALID, AFS_ENTITY_ID: "" })).toThrowError(AfsError);
    try {
      parseAfsConfig({ ...VALID, AFS_ENTITY_ID: "" });
    } catch (error) {
      expect((error as AfsError).kind).toBe("CONFIG");
      expect((error as AfsError).message).toContain("AFS_ENTITY_ID");
    }
  });

  it("rejects a missing access token", () => {
    expect(() => parseAfsConfig({ ...VALID, AFS_ACCESS_TOKEN: undefined })).toThrowError(
      /AFS_ACCESS_TOKEN/,
    );
  });

  it("rejects a non-https base URL", () => {
    expect(() => parseAfsConfig({ ...VALID, AFS_BASE_URL: "http://eu-test.oppwa.com/" })).toThrowError(
      /AFS_BASE_URL/,
    );
  });

  it("rejects a malformed currency", () => {
    expect(() => parseAfsConfig({ ...VALID, AFS_CURRENCY: "aed" })).toThrowError(/AFS_CURRENCY/);
  });

  it("never leaks the access token in the error message", () => {
    try {
      parseAfsConfig({ ...VALID, AFS_CURRENCY: "aed" });
      throw new Error("expected a config error");
    } catch (error) {
      expect((error as Error).message).not.toContain(VALID.AFS_ACCESS_TOKEN);
    }
  });

  it("reads the webhook key when supplied", () => {
    const key = "a".repeat(64);
    const config = parseAfsConfig({ ...VALID, AFS_WEBHOOK_DECRYPTION_KEY: key });
    expect(config.webhookDecryptionKey).toBe(key);
  });

  it("describeAfsConfig exposes no secrets", () => {
    const described = describeAfsConfig(parseAfsConfig(VALID));
    expect(JSON.stringify(described)).not.toContain(VALID.AFS_ACCESS_TOKEN);
    expect(described).toMatchObject({ accessTokenConfigured: true, currency: "AED" });
  });
});

describe("getAppBaseUrl", () => {
  function request(url: string, headers: Record<string, string> = {}) {
    return { url, headers: new Headers(headers) };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the Host the client actually reached us on, not the server's own origin", () => {
    // A phone that scanned a QR arrives with Host: 192.168.1.45:3000 even
    // though request.url reports localhost. Redirecting it to localhost would
    // send the phone to itself after the payment.
    const base = getAppBaseUrl(
      request("http://localhost:3000/api/v1/payments/checkout", { host: "192.168.1.45:3000" }),
    );
    expect(base).toBe("http://192.168.1.45:3000");
  });

  it("honours x-forwarded-host and x-forwarded-proto behind a proxy", () => {
    const base = getAppBaseUrl(
      request("http://localhost:3000/x", {
        host: "localhost:3000",
        "x-forwarded-host": "pay.example.com",
        "x-forwarded-proto": "https",
      }),
    );
    expect(base).toBe("https://pay.example.com");
  });

  it("lets APP_BASE_URL override everything", () => {
    vi.stubEnv("APP_BASE_URL", "https://tunnel.example.com/");
    const base = getAppBaseUrl(request("http://localhost:3000/x", { host: "192.168.1.45:3000" }));
    expect(base).toBe("https://tunnel.example.com");
  });

  it("falls back to the request origin when there is no Host header", () => {
    expect(getAppBaseUrl(request("http://localhost:3000/x"))).toBe("http://localhost:3000");
  });
});
