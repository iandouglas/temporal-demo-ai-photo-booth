/** Format an amount in galactic credits, the ship-wide currency: "12,500.00 GC". */
export function formatGC(amount: number): string {
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GC`
}
