// Shared by customer.controller.js (customer detail) and pendingDues.controller.js
// (the org-wide/staff pending dues report) so the two never disagree on what a
// customer actually owes: their opening balance (pre-Delyver debt) plus unpaid
// deliveries, minus credit notes issued against them and any credit balance
// they're carrying (from a prior overpayment), floored at 0.
function computeTotalDue({ openingBalance = 0, deliveryDue = 0, creditNotesTotal = 0, creditBalance = 0 }) {
  const raw = parseFloat(openingBalance) + parseFloat(deliveryDue) - parseFloat(creditNotesTotal) - parseFloat(creditBalance);
  return Math.round(Math.max(raw, 0) * 100) / 100;
}

module.exports = { computeTotalDue };
