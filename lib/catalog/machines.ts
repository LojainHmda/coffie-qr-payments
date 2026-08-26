import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Machine registry.
 *
 * A machine is an ACTOR in this system, not a destination. The customer chooses
 * their drinks on the machine itself; the machine then asks this server to
 * create the order and prints a QR that carries only that order's pay token.
 * There is no per-machine QR any more, because a QR is now per-order.
 *
 * That makes the machine an authenticated API client, so each machine holds an
 * API key rather than a public token. The key identifies which machine an order
 * belongs to — a machine cannot create an order attributed to another machine,
 * because the key IS the claim of identity.
 *
 * ---------------------------------------------------------------------------
 * THE KEYS BELOW ARE DEMO KEYS. THEY ARE IN GIT AND ARE NOT SECRET.
 *
 * `MACHINE_API_KEYS` overrides them, in the form:
 *
 *     MACHINE_API_KEYS=MACHINE-001:xxxx,MACHINE-002:yyyy
 *
 * Set it before this is exposed to anything but a laptop. `demoKeysInUse()`
 * reports whether any machine is still on its committed key, so a deployment
 * can say so out loud instead of quietly shipping a known credential.
 * ---------------------------------------------------------------------------
 */

export interface Machine {
  id: string;
  /** Human-facing code shown on the machine and in the dashboard. */
  code: string;
  name: string;
  location: string;
  /**
   * Committed fallback credential, used only when MACHINE_API_KEYS does not
   * carry an entry for this machine. Never treat it as a secret.
   */
  demoApiKey: string;
  active: boolean;
}

const MACHINES: readonly Machine[] = [
  {
    id: "mch_001",
    code: "MACHINE-001",
    name: "Coffee Machine 001",
    location: "Ground Floor Lobby",
    demoApiKey: "demo_m1Qk7YbTfWc4Rn2xDpLs9A",
    active: true,
  },
  {
    id: "mch_002",
    code: "MACHINE-002",
    name: "Coffee Machine 002",
    location: "Second Floor Break Room",
    demoApiKey: "demo_h8VtZr3JmEy6Ns1wCqXu5B",
    active: true,
  },
  {
    id: "mch_003",
    code: "MACHINE-003",
    name: "Coffee Machine 003",
    location: "Warehouse Entrance",
    demoApiKey: "demo_p4GdKj9LzAv7Bs2eTnFh6C",
    active: true,
  },
];

export type MachineEnv = Record<string, string | undefined>;

/** Parse MACHINE_API_KEYS into { MACHINE-001: "key" }. Malformed pairs are skipped. */
function configuredKeys(env: MachineEnv): Map<string, string> {
  const map = new Map<string, string>();
  const raw = env.MACHINE_API_KEYS?.trim();
  if (!raw) return map;

  for (const entry of raw.split(",")) {
    const separator = entry.indexOf(":");
    if (separator < 1) continue;
    const code = entry.slice(0, separator).trim().toUpperCase();
    const key = entry.slice(separator + 1).trim();
    if (code && key) map.set(code, key);
  }
  return map;
}

export function listMachines(): Machine[] {
  return [...MACHINES];
}

export function getMachineById(machineId: string): Machine | undefined {
  return MACHINES.find((entry) => entry.id === machineId);
}

/** Resolve a human machine code. Inactive machines do not resolve. */
export function getMachineByCode(code: string): Machine | undefined {
  const machine = MACHINES.find((entry) => entry.code.toUpperCase() === code.trim().toUpperCase());
  return machine?.active ? machine : undefined;
}

/** The key this machine authenticates with right now. */
export function machineApiKey(machine: Machine, env: MachineEnv = process.env): string {
  return configuredKeys(env).get(machine.code) ?? machine.demoApiKey;
}

/**
 * Constant-time comparison over SHA-256 digests.
 *
 * Digests rather than the raw strings because `timingSafeEqual` throws on
 * length mismatch, and throwing on the first wrong byte-length would itself
 * leak the key length. Hashing makes every comparison the same size.
 */
function secretsMatch(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

/**
 * Resolve an API key to the machine that owns it. Unknown key or inactive
 * machine -> undefined, with no hint about which of the two it was.
 */
export function getMachineByApiKey(key: string, env: MachineEnv = process.env): Machine | undefined {
  const candidate = key.trim();
  if (candidate.length === 0) return undefined;

  // Every machine is checked even after a match, so the time taken does not
  // reveal the position of the matching machine in the registry.
  let found: Machine | undefined;
  for (const machine of MACHINES) {
    if (secretsMatch(candidate, machineApiKey(machine, env)) && machine.active) {
      found = machine;
    }
  }
  return found;
}

/** Machines still authenticating with the key committed to this repository. */
export function demoKeysInUse(env: MachineEnv = process.env): string[] {
  const configured = configuredKeys(env);
  return MACHINES.filter((machine) => !configured.has(machine.code)).map((machine) => machine.code);
}
