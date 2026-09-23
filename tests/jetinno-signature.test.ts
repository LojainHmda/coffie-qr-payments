import { describe, expect, it } from "vitest";

import {
  jetinnoTimestamp,
  signFields,
  signatureBase,
  verifySignature,
} from "@/lib/jetinno/signature";

/**
 * The anchor for this whole integration.
 *
 * Jetinno's specification works one signature end to end in §2.5, apikey and
 * digest included. If our implementation reproduces that digest, we are
 * signing the way their machines do; if it does not, nothing downstream can
 * work. Every other test here is a property, but this one is ground truth and
 * must not be "fixed" by changing the expectation.
 */

const SPEC_APIKEY = "DBRW17YE7FHKR72T";

const SPEC_MESSAGE = {
  username: "testname",
  time: "20210203163138",
  deviceNo: "44401",
  orderAmount: "1000",
  orderNo: "201701041632542085957405",
  notifyUrl: "http://127.0.0.1",
};

const SPEC_BASE =
  "deviceNo=44401&notifyUrl=http://127.0.0.1&orderAmount=1000" +
  "&orderNo=201701041632542085957405&time=20210203163138&username=testname";

const SPEC_SIGN = "A682A6DCDAE3843FDF2107C033574E21";

describe("Jetinno signature — specification §2.5", () => {
  it("builds the exact signature base the specification prints", () => {
    expect(signatureBase(SPEC_MESSAGE)).toBe(SPEC_BASE);
  });

  it("reproduces the specification's published digest", () => {
    expect(signFields(SPEC_MESSAGE, SPEC_APIKEY)).toBe(SPEC_SIGN);
  });

  it("accepts that digest back", () => {
    expect(verifySignature(SPEC_SIGN, SPEC_MESSAGE, SPEC_APIKEY)).toBe(true);
  });
});

describe("Jetinno signature — rules", () => {
  it("sorts parameter names by ASCII, not by insertion order", () => {
    const base = signatureBase({ zebra: "1", Alpha: "2", middle: "3" });
    // Uppercase sorts before lowercase in ASCII.
    expect(base).toBe("Alpha=2&middle=3&zebra=1");
  });

  it("leaves null, undefined and empty values out entirely", () => {
    expect(signatureBase({ a: "1", b: null, c: undefined, d: "" })).toBe("a=1");
  });

  it("never signs the envelope's own structural members", () => {
    const base = signatureBase({ a: "1", sign: "DEADBEEF", nonce: "n", data: "{}" });
    expect(base).toBe("a=1");
  });

  it("treats a numeric amount and its string form as the same message", () => {
    expect(signFields({ orderAmount: 1000 }, SPEC_APIKEY)).toBe(
      signFields({ orderAmount: "1000" }, SPEC_APIKEY),
    );
  });

  it("prepends the nonce as an initial vector when one is present", () => {
    expect(signatureBase({ a: "1" }, { nonce: "IV" })).toBe("IVa=1");
  });

  it("changes the digest when any signed value changes", () => {
    const tampered = { ...SPEC_MESSAGE, orderAmount: "1" };
    expect(signFields(tampered, SPEC_APIKEY)).not.toBe(SPEC_SIGN);
  });
});

describe("Jetinno signature — verification", () => {
  it("rejects a digest produced with a different apikey", () => {
    const forged = signFields(SPEC_MESSAGE, "0000000000000000");
    expect(verifySignature(forged, SPEC_MESSAGE, SPEC_APIKEY)).toBe(false);
  });

  it("rejects a missing or malformed signature", () => {
    expect(verifySignature(null, SPEC_MESSAGE, SPEC_APIKEY)).toBe(false);
    expect(verifySignature("", SPEC_MESSAGE, SPEC_APIKEY)).toBe(false);
    expect(verifySignature("TOOSHORT", SPEC_MESSAGE, SPEC_APIKEY)).toBe(false);
  });

  it("accepts a lowercase digest rather than failing on letter case", () => {
    expect(verifySignature(SPEC_SIGN.toLowerCase(), SPEC_MESSAGE, SPEC_APIKEY)).toBe(true);
  });

  /**
   * §3.1.2 excludes payType from the signature and §3.3.2 includes it. A
   * message signed either way must verify, because which firmware sent it is
   * not something we get to choose.
   */
  it("accepts payType whether or not the sender signed it", () => {
    const message = { ...SPEC_MESSAGE, payType: "1001" };

    const signedWithout = signFields(message, SPEC_APIKEY, { exclude: ["payType"] });
    const signedWith = signFields(message, SPEC_APIKEY);

    expect(signedWithout).not.toBe(signedWith);
    expect(verifySignature(signedWithout, message, SPEC_APIKEY)).toBe(true);
    expect(verifySignature(signedWith, message, SPEC_APIKEY)).toBe(true);
  });

  /** §2.4 rule 6: optional fields do not participate — but accept either reading. */
  it("accepts optional merchantNo and platBillNo whether or not the sender signed them", () => {
    const message = { ...SPEC_MESSAGE, merchantNo: "M-100", platBillNo: "8ac7a4a1" };

    const signedWithout = signFields(message, SPEC_APIKEY, { exclude: ["merchantNo", "platBillNo"] });
    const signedWith = signFields(message, SPEC_APIKEY);

    expect(signedWithout).not.toBe(signedWith);
    expect(verifySignature(signedWithout, message, SPEC_APIKEY)).toBe(true);
    expect(verifySignature(signedWith, message, SPEC_APIKEY)).toBe(true);
  });

  it("still rejects a forgery that varies the ambiguous fields", () => {
    const message = { ...SPEC_MESSAGE, payType: "1001", attach: "x" };
    expect(verifySignature("F".repeat(32), message, SPEC_APIKEY)).toBe(false);
  });
});

describe("Jetinno timestamp", () => {
  it("formats as yyyyMMddHHmmss", () => {
    expect(jetinnoTimestamp(new Date("2021-02-03T16:31:38Z"))).toBe("20210203163138");
  });

  it("zero-pads every component", () => {
    expect(jetinnoTimestamp(new Date("2025-01-02T03:04:05Z"))).toBe("20250102030405");
  });
});
