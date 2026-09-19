// Shared look for every chart, so bar / line / pie charts on different pages
// read as one family and follow the light / dark theme.
export const AXIS_TICK = { fontSize: 11, fill: 'var(--color-text-muted)' };
export const GRID_STROKE = 'var(--color-border)';
export const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: 12,
};

// Series colours that must stay distinguishable from each other regardless of the
// primary colour (which is black, and would otherwise turn every slice black).
// They are the --chart-* tokens in variables.css — indigo and mint lead, then ink,
// periwinkle, amber, teal, and a grey that callers use for an "other" slice — so
// dark mode swaps in lighter shades without any chart needing to know about it.
export const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)'];
export const STATUS_COLORS = { paid: 'var(--chart-2)', partial: 'var(--chart-5)', pending: 'var(--color-danger)' };
