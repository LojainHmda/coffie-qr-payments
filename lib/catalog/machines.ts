/**
 * Machine registry.
 *
 * A machine is identified publicly by an opaque `publicToken`, never by its
 * internal id or its human code. The token is what the QR encodes and the only
 * thing the customer's browser ever sends back, so a customer cannot move an
 * order to a different machine by editing the URL — an unknown token simply
 * does not resolve.
 *
 * The tokens are hard-coded rather than generated at boot on purpose: a printed
 * QR has to keep working across a server restart.
 */

export interface Machine {
  id: string;
  /** Human-facing code shown on the machine and in the dashboard. */
  code: string;
  name: string;
  location: string;
  /** Opaque, unguessable, url-safe. This is what the QR carries. */
  publicToken: string;
  active: boolean;
}

const MACHINES: readonly Machine[] = [
  {
    id: "mch_001",
    code: "MACHINE-001",
    name: "Coffee Machine 001",
    location: "Ground Floor Lobby",
    publicToken: "m1Qk7YbTfWc4Rn2xDpLs9A",
    active: true,
  },
  {
    id: "mch_002",
    code: "MACHINE-002",
    name: "Coffee Machine 002",
    location: "Second Floor Break Room",
    publicToken: "h8VtZr3JmEy6Ns1wCqXu5B",
    active: true,
  },
  {
    id: "mch_003",
    code: "MACHINE-003",
    name: "Coffee Machine 003",
    location: "Warehouse Entrance",
    publicToken: "p4GdKj9LzAv7Bs2eTnFh6C",
    active: true,
  },
];

export function listMachines(): Machine[] {
  return [...MACHINES];
}

/** Resolve a QR token to a machine. Unknown or inactive -> undefined. */
export function getMachineByPublicToken(token: string): Machine | undefined {
  const machine = MACHINES.find((entry) => entry.publicToken === token);
  return machine?.active ? machine : undefined;
}

export function getMachineById(machineId: string): Machine | undefined {
  return MACHINES.find((entry) => entry.id === machineId);
}
