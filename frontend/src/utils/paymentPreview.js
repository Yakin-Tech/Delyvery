// What a payment is about to do to a customer's account, worked out in the
// browser before anything is sent, so the person recording it sees the effect
// (and catches a mistyped amount) while it can still be fixed. Every rule here
// mirrors the settlement functions in backend/supabase/schema.sql — keep the
// two in step:
//
//   FIFO (apply_payment_fifo): the opening balance is cleared first, then open
//   deliveries oldest-first, each up to what's still owed on it; anything left
//   over is kept as credit against the customer's next delivery.
//
//   Manual (apply_payment_manual): only the deliveries the person picked are
//   paid, each capped at what's owed on it; the opening balance is untouched and
//   whatever isn't allocated is kept as credit.

const round2 = (n) => Math.round(n * 100) / 100;
const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

// deliveries: [{ id, pending_amount, ... }] oldest first, as customerDues returns them.
export function simulateFifo({ openingBalance, deliveries, amount }) {
  let remaining = Math.max(toNumber(amount), 0);

  const toOpening = round2(Math.min(Math.max(toNumber(openingBalance), 0), remaining));
  remaining = round2(remaining - toOpening);

  const lines = deliveries.map((delivery) => {
    const owed = toNumber(delivery.pending_amount);
    const applied = round2(Math.min(owed, remaining));
    remaining = round2(remaining - applied);
    return { delivery, applied, settled: applied > 0 && applied >= owed - 0.005 };
  });

  return { toOpening, lines, surplus: Math.max(remaining, 0) };
}

// allocations: { [deliveryId]: amount }
export function simulateManual({ deliveries, allocations, amount }) {
  let allocatedTotal = 0;
  const lines = deliveries.map((delivery) => {
    const owed = toNumber(delivery.pending_amount);
    const applied = round2(Math.min(Math.max(toNumber(allocations[delivery.id]), 0), owed));
    allocatedTotal += applied;
    return { delivery, applied, settled: applied > 0 && applied >= owed - 0.005 };
  });
  return {
    toOpening: 0,
    lines,
    surplus: Math.max(round2(toNumber(amount) - allocatedTotal), 0),
  };
}

// The customer's total due after the payment, by the same rule the server uses
// everywhere (opening + open deliveries - credit notes - credit, never below 0).
export function dueAfterPayment(dues, simulation) {
  const opening = Math.max(dues.breakdown.opening_balance - simulation.toOpening, 0);
  const deliveryDue = simulation.lines.reduce((sum, line) => sum + Math.max(toNumber(line.delivery.pending_amount) - line.applied, 0), 0);
  const credit = dues.breakdown.credit_balance + simulation.surplus;
  return round2(Math.max(opening + deliveryDue - dues.breakdown.credit_notes_total - credit, 0));
}

// "Oldest first" split of an amount across the deliveries, for the manual form's
// auto-fill button. Returns { [deliveryId]: amount }.
export function autoAllocate(deliveries, amount) {
  let remaining = Math.max(toNumber(amount), 0);
  const allocations = {};
  for (const delivery of deliveries) {
    if (remaining <= 0) break;
    const applied = round2(Math.min(toNumber(delivery.pending_amount), remaining));
    if (applied > 0) allocations[delivery.id] = applied;
    remaining = round2(remaining - applied);
  }
  return allocations;
}
