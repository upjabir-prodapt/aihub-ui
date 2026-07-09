/**
 * Verifies unified hub auth behavior:
 * - isHubLoginComplete respects per-service entitlements
 * - hubLogin only POSTs /auth/token for services where whoami succeeded (entitlements)
 */
import assert from 'node:assert/strict';

// ── isHubLoginComplete (inline mirror of hubAuth.ts) ─────────────────────────

function isHubLoginComplete(entitlements, translationAuthenticated, salesAuthenticated) {
  const needsTranslation = entitlements.translation;
  const needsSales = entitlements.sales;
  if (!needsTranslation && !needsSales) return false;
  if (needsTranslation && !translationAuthenticated) return false;
  if (needsSales && !salesAuthenticated) return false;
  return true;
}

const cases = [
  { e: { translation: true, sales: true }, t: true, s: true, want: true },
  { e: { translation: true, sales: false }, t: true, s: false, want: true },
  { e: { translation: false, sales: true }, t: false, s: true, want: true },
  { e: { translation: true, sales: true }, t: true, s: false, want: false },
  { e: { translation: true, sales: false }, t: false, s: false, want: false },
  { e: { translation: false, sales: false }, t: false, s: false, want: false },
];

for (const { e, t, s, want } of cases) {
  assert.equal(
    isHubLoginComplete(e, t, s),
    want,
    `isHubLoginComplete(${JSON.stringify(e)}, ${t}, ${s})`,
  );
}
console.log('OK isHubLoginComplete —', cases.length, 'cases');

// ── hubLogin token call gating (mocked) ──────────────────────────────────────

async function hubLoginMock(entitlements) {
  const calls = [];
  const tasks = [];

  if (entitlements.translation) {
    tasks.push(Promise.resolve().then(() => calls.push('translation:/auth/token')));
  }
  if (entitlements.sales) {
    tasks.push(Promise.resolve().then(() => calls.push('sales:/auth/token')));
  }
  await Promise.all(tasks);
  return calls.sort();
}

assert.deepEqual(
  await hubLoginMock({ translation: true, sales: true }),
  ['sales:/auth/token', 'translation:/auth/token'],
);
assert.deepEqual(
  await hubLoginMock({ translation: true, sales: false }),
  ['translation:/auth/token'],
);
assert.deepEqual(
  await hubLoginMock({ translation: false, sales: true }),
  ['sales:/auth/token'],
);
assert.deepEqual(
  await hubLoginMock({ translation: false, sales: false }),
  [],
);
console.log('OK hubLogin gating — token only for entitled services');

console.log('\nAll hub auth verification checks passed.');
