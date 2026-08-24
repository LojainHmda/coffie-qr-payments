/**
 * Product catalogue.
 *
 * In-memory and read-only for this POC — a table replaces `PRODUCTS` later
 * without changing the two lookup functions below.
 *
 * The price here is the ONLY authority on what a customer is charged. The
 * browser sends a productId and nothing else; the server reads the price from
 * this module when it builds the order.
 */

export interface Product {
  id: string;
  sku: string;
  name: string;
  /** Minor-unit-free decimal string, matching what AFS expects on the wire. */
  price: string;
  currency: string;
  active: boolean;
  sortOrder: number;
}

const PRODUCTS: readonly Product[] = [
  { id: "prd_coffee", sku: "COFFEE", name: "Coffee", price: "3.00", currency: "AED", active: true, sortOrder: 1 },
  { id: "prd_latte", sku: "LATTE", name: "Latte", price: "5.00", currency: "AED", active: true, sortOrder: 2 },
  { id: "prd_cappuccino", sku: "CAPPUCCINO", name: "Cappuccino", price: "6.00", currency: "AED", active: true, sortOrder: 3 },
  // Kept inactive on purpose: proves the "active" filter is honoured and gives
  // the manipulation tests something real to aim at.
  { id: "prd_hot_chocolate", sku: "HOT_CHOCOLATE", name: "Hot Chocolate", price: "7.00", currency: "AED", active: false, sortOrder: 4 },
];

export function listActiveProducts(): Product[] {
  return PRODUCTS.filter((product) => product.active).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Returns undefined for an unknown id AND for a deactivated product. */
export function getActiveProduct(productId: string): Product | undefined {
  const product = PRODUCTS.find((entry) => entry.id === productId);
  return product?.active ? product : undefined;
}
