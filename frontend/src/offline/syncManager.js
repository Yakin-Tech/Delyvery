import { syncDeliveryBatch } from '../api/deliveries.api';
import { enqueueItem, getAllItems, getItemsByStatus, updateItem, deleteItem } from './db';

// Module-level singleton: one queue, one in-flight flush, shared by every
// component that imports this file (there's only ever one Daily Run Sheet on
// screen, but this also survives that page unmounting/remounting).
let syncing = false;
const listeners = new Set();

const LAST_SYNCED_KEY = 'delyver.lastSyncedAt';

function readLastSyncedAt() {
  try {
    return localStorage.getItem(LAST_SYNCED_KEY);
  } catch {
    return null;
  }
}

// Persisted (not just in-memory) so a staff member reopening the app after
// being fully offline still sees "synced 20 minutes ago" instead of nothing —
// the trust signal should survive a reload, the same way the queue itself does.
let lastSyncedAt = readLastSyncedAt();

function markSynced() {
  lastSyncedAt = new Date().toISOString();
  try {
    localStorage.setItem(LAST_SYNCED_KEY, lastSyncedAt);
  } catch {
    // Private mode, storage full, etc. — the in-memory value still works for this session.
  }
}

async function notify() {
  const items = await getAllItems();
  const pendingCount = items.filter((i) => i.status === 'pending' || i.status === 'error').length;
  const conflicts = items.filter((i) => i.status === 'conflict');
  listeners.forEach((cb) => cb({ pendingCount, conflicts, syncing, lastSyncedAt }));
}

// Subscribes to queue/sync-status changes; fires once immediately with the
// current state, then again on every change. Returns an unsubscribe fn.
export function subscribeSyncStatus(callback) {
  listeners.add(callback);
  notify();
  return () => listeners.delete(callback);
}

// Sends every not-yet-synced item to POST /deliveries/sync-batch in one call
// and resolves each by the per-item status the server returned (see
// delivery.controller.js's syncBatch): created/already_synced -> synced,
// conflict -> surfaced for manual review, error -> left for the next retry.
// A network-level failure (no response at all) leaves every item as-is so
// the next 'online' event or periodic tick just tries again.
export async function flush() {
  if (syncing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const itemsToSync = await getItemsByStatus(['pending', 'error']);
  if (itemsToSync.length === 0) return;

  syncing = true;
  await notify();
  try {
    const payloadItems = itemsToSync.map((i) => ({ ...i.payload, kind: i.kind, client_ref_id: i.client_ref_id }));
    const { results } = await syncDeliveryBatch(payloadItems);
    markSynced();
    const byRefId = new Map(results.map((r) => [r.client_ref_id, r]));

    await Promise.all(itemsToSync.map(async (item) => {
      const result = byRefId.get(item.client_ref_id);
      if (!result) return;
      if (result.status === 'created' || result.status === 'already_synced') {
        await updateItem(item.client_ref_id, { status: 'synced', result });
      } else if (result.status === 'conflict') {
        await updateItem(item.client_ref_id, { status: 'conflict', result });
      } else {
        await updateItem(item.client_ref_id, { status: 'error', error_message: result.message || 'Sync failed' });
      }
    }));
  } catch {
    // Whole-request failure (offline, timeout, 5xx) — items stay pending.
  } finally {
    syncing = false;
    await notify();
  }
}

export async function enqueueDelivery(payload) {
  const record = await enqueueItem({ kind: 'delivery', payload });
  await notify();
  flush();
  return record;
}

export async function enqueueSkip(payload) {
  const record = await enqueueItem({ kind: 'skip', payload });
  await notify();
  flush();
  return record;
}

// Staff acknowledging a conflict card ("ok, I saw admin already handled
// this") — there's nothing left to sync for it.
export async function dismissConflict(clientRefId) {
  await deleteItem(clientRefId);
  await notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flush());
  // Backstop for connections that never fire a clean 'online' event (some
  // flaky mobile networks don't) — cheap no-op via the itemsToSync.length
  // check above when the queue is empty.
  setInterval(() => flush(), 45000);
}
