import { describe, expect, it } from "vitest";

import {
  demoKeysInUse,
  getMachineByApiKey,
  getMachineByCode,
  listMachines,
  machineApiKey,
} from "@/lib/catalog/machines";
import { MachineAuthError, authenticateMachine, bearerToken } from "@/lib/machines/auth";
import { MoneyError, fromMinorUnits, multiplyPrice, sumPrices, toMinorUnits } from "@/lib/orders/money";

/**
 * The machine is now an authenticated actor, so its identity is the thing that
 * has to hold up: an order is attributed to whoever holds the key, and nothing
 * in a request body may override that.
 */

const [MACHINE_ONE, MACHINE_TWO] = listMachines();

function bearer(key: string): Headers {
  return new Headers({ authorization: `Bearer ${key}` });
}

describe("machine identity", () => {
  it("resolves a machine by its own API key", () => {
    expect(getMachineByApiKey(machineApiKey(MACHINE_ONE, {}), {})?.id).toBe(MACHINE_ONE.id);
  });

  it("does not resolve one machine from another's key", () => {
    expect(getMachineByApiKey(machineApiKey(MACHINE_TWO, {}), {})?.id).not.toBe(MACHINE_ONE.id);
  });

  it("refuses an unknown or empty key", () => {
    expect(getMachineByApiKey("not-a-key", {})).toBeUndefined();
    expect(getMachineByApiKey("", {})).toBeUndefined();
    expect(getMachineByApiKey("   ", {})).toBeUndefined();
  });

  it("lets MACHINE_API_KEYS replace the committed demo keys", () => {
    const env = { MACHINE_API_KEYS: `${MACHINE_ONE.code}:rotated-secret` };

    expect(machineApiKey(MACHINE_ONE, env)).toBe("rotated-secret");
    expect(getMachineByApiKey("rotated-secret", env)?.id).toBe(MACHINE_ONE.id);
    // The old committed key stops working for that machine.
    expect(getMachineByApiKey(MACHINE_ONE.demoApiKey, env)).toBeUndefined();
    // Machines with no override keep their demo key.
    expect(getMachineByApiKey(MACHINE_TWO.demoApiKey, env)?.id).toBe(MACHINE_TWO.id);
  });

  it("reports which machines still use a key that is committed to git", () => {
    expect(demoKeysInUse({})).toContain(MACHINE_ONE.code);
    expect(demoKeysInUse({ MACHINE_API_KEYS: `${MACHINE_ONE.code}:x` })).not.toContain(
      MACHINE_ONE.code,
    );
  });

  it("resolves a machine code case-insensitively but not a made-up one", () => {
    expect(getMachineByCode(MACHINE_ONE.code.toLowerCase())?.id).toBe(MACHINE_ONE.id);
    expect(getMachineByCode("MACHINE-999")).toBeUndefined();
  });
});

describe("authenticateMachine", () => {
  it("accepts a valid bearer key", () => {
    expect(authenticateMachine(bearer(machineApiKey(MACHINE_ONE, {})), {}).id).toBe(MACHINE_ONE.id);
  });

  it("rejects a missing, malformed or wrong credential the same way", () => {
    const cases: Headers[] = [
      new Headers(),
      new Headers({ authorization: machineApiKey(MACHINE_ONE, {}) }),
      new Headers({ authorization: "Basic abc" }),
      bearer("wrong-key"),
    ];

    for (const headers of cases) {
      const error = (() => {
        try {
          authenticateMachine(headers, {});
        } catch (e) {
          return e;
        }
      })();

      expect(error).toBeInstanceOf(MachineAuthError);
      // Identical public message: probing the endpoint reveals nothing.
      expect((error as MachineAuthError).publicMessage).toBe("Machine authentication failed.");
      expect((error as MachineAuthError).httpStatus).toBe(401);
    }
  });

  it("reads the scheme case-insensitively", () => {
    const headers = new Headers({ authorization: `bearer ${machineApiKey(MACHINE_ONE, {})}` });
    expect(bearerToken(headers)).toBe(machineApiKey(MACHINE_ONE, {}));
  });
});

describe("money", () => {
  it("converts decimal strings to minor units and back", () => {
    expect(toMinorUnits("3.00")).toBe(300);
    expect(toMinorUnits("0.05")).toBe(5);
    expect(toMinorUnits("12")).toBe(1200);
    expect(fromMinorUnits(1205)).toBe("12.05");
    expect(fromMinorUnits(0)).toBe("0.00");
  });

  it("totals without floating-point drift", () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004, which AFS would
    // reject as an amount mismatch.
    expect(sumPrices(["0.10", "0.20"])).toBe("0.30");
    expect(multiplyPrice("0.07", 3)).toBe("0.21");
    expect(sumPrices(Array.from({ length: 10 }, () => "0.10"))).toBe("1.00");
  });

  it("refuses input it cannot represent exactly", () => {
    expect(() => toMinorUnits("3.005")).toThrowError(MoneyError);
    expect(() => toMinorUnits("-1.00")).toThrowError(MoneyError);
    expect(() => toMinorUnits("3,00")).toThrowError(MoneyError);
    expect(() => multiplyPrice("3.00", 0)).toThrowError(MoneyError);
    expect(() => multiplyPrice("3.00", 1.5)).toThrowError(MoneyError);
    expect(() => sumPrices([])).toThrowError(MoneyError);
  });
});
