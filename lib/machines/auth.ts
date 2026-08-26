import { getMachineByApiKey, type Machine, type MachineEnv } from "@/lib/catalog/machines";

/**
 * Machine API authentication.
 *
 * The machine identifies itself with `Authorization: Bearer <machine api key>`.
 * The key is the machine's whole claim of identity: the request body says what
 * was ordered, never which machine ordered it. That is what stops one machine
 * (or anyone holding one machine's key) from writing orders against another.
 */

export class MachineAuthError extends Error {
  readonly httpStatus: number;
  readonly publicMessage: string;

  constructor(message: string, httpStatus = 401) {
    super(message);
    this.name = "MachineAuthError";
    this.httpStatus = httpStatus;
    // Deliberately identical for "no header", "malformed header" and "wrong
    // key": a caller probing the endpoint learns nothing from the difference.
    this.publicMessage = "Machine authentication failed.";
  }
}

const BEARER = /^Bearer\s+(.+)$/i;

/** Extract the presented key, or null when the header is absent or malformed. */
export function bearerToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Resolve the calling machine, or throw MachineAuthError.
 *
 * Takes a plain `Headers` rather than a NextRequest so it can be unit-tested
 * without constructing a request.
 */
export function authenticateMachine(headers: Headers, env: MachineEnv = process.env): Machine {
  const key = bearerToken(headers);
  if (!key) {
    throw new MachineAuthError("Missing or malformed Authorization header");
  }

  const machine = getMachineByApiKey(key, env);
  if (!machine) {
    throw new MachineAuthError("No active machine holds this API key");
  }

  return machine;
}
