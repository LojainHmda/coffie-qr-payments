import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { afsRequest } from "@/lib/payments/afs/client";
import { AfsError } from "@/lib/payments/afs/errors";
import type { AfsConfig } from "@/lib/payments/afs/types";

const config: AfsConfig = {
  entityId: "entity-123",
  accessToken: "token-abc",
  baseUrl: "https://eu-test.oppwa.com/",
  currency: "AED",
  webhookDecryptionKey: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("afsRequest", () => {
  it("sends a Bearer token and form-encoded body to the configured base URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "chk_1", result: { code: "000.200.100" } }));

    await afsRequest(config, {
      path: "v1/checkouts",
      method: "POST",
      form: { entityId: config.entityId, amount: "5.00", currency: "AED", paymentType: "DB" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://eu-test.oppwa.com/v1/checkouts");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
    expect(init.headers["Content-Type"]).toContain("application/x-www-form-urlencoded");
    expect(init.body).toBe("entityId=entity-123&amount=5.00&currency=AED&paymentType=DB");
  });

  it("appends query parameters for status lookups", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: { code: "000.100.110" } }));

    await afsRequest(config, {
      path: "/v1/checkouts/chk_1/payment",
      method: "GET",
      query: { entityId: config.entityId },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://eu-test.oppwa.com/v1/checkouts/chk_1/payment?entityId=entity-123");
    expect(init.body).toBeUndefined();
  });

  it("parses the AFS JSON response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "chk_1", result: { code: "000.200.100" } }));
    const { data } = await afsRequest<{ id: string; result: { code: string } }>(config, {
      path: "v1/checkouts",
      method: "POST",
      form: {},
    });
    expect(data.id).toBe("chk_1");
    expect(data.result.code).toBe("000.200.100");
  });

  it("maps a network failure to a NETWORK AfsError without leaking the token", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const error = await afsRequest(config, { path: "v1/checkouts", method: "POST", form: {} }).catch(
      (e) => e as AfsError,
    );
    expect(error).toBeInstanceOf(AfsError);
    expect((error as AfsError).kind).toBe("NETWORK");
    expect(JSON.stringify((error as AfsError).details)).not.toContain(config.accessToken);
  });

  it("maps a timeout to a TIMEOUT AfsError", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);
    const error = await afsRequest(config, { path: "v1/checkouts", method: "POST", form: {} }).catch(
      (e) => e as AfsError,
    );
    expect((error as AfsError).kind).toBe("TIMEOUT");
  });

  it("maps a non-JSON body to a PARSE AfsError", async () => {
    fetchMock.mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));
    const error = await afsRequest(config, { path: "v1/checkouts", method: "POST", form: {} }).catch(
      (e) => e as AfsError,
    );
    expect((error as AfsError).kind).toBe("PARSE");
  });

  it("maps an unauthenticated response to an HTTP AfsError", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "unauthorized" }, 401));
    const error = await afsRequest(config, { path: "v1/checkouts", method: "POST", form: {} }).catch(
      (e) => e as AfsError,
    );
    expect((error as AfsError).kind).toBe("HTTP");
    expect((error as AfsError).httpStatus).toBe(500);
  });

  it("returns AFS business errors that arrive with a result block", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ result: { code: "200.300.404", description: "invalid or missing parameter" } }, 400),
    );
    const { data } = await afsRequest<{ result: { code: string } }>(config, {
      path: "v1/checkouts",
      method: "POST",
      form: {},
    });
    expect(data.result.code).toBe("200.300.404");
  });
});
