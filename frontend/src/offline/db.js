import { openDB } from 'idb';

const DB_NAME = 'delyver-offline';
const DB_VERSION = 1;
const STORE = 'queue';

// crypto.randomUUID() needs a secure context (HTTPS, or localhost) — true for
// every real deployment, but CRA's dev server can be plain http:// on a LAN
// IP when testing from a phone, so this falls back to a non-cryptographic
// UUID-shaped id in that case. It only needs to be unique per device queue,
// never security-sensitive.
export function generateClientRefId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: 'client_ref_id' });
        store.createIndex('status', 'status');
        store.createIndex('created_at', 'created_at');
      },
    });
  }
  return dbPromise;
}

// item: { kind: 'delivery' | 'skip', payload: {...} }
// Queued items always go in as 'pending' — syncManager is the only thing
// that ever moves them to 'synced' / 'conflict' / 'error'.
export async function enqueueItem(item) {
  const db = await getDb();
  const record = {
    client_ref_id: generateClientRefId(),
    kind: item.kind,
    payload: item.payload,
    status: 'pending',
    created_at: new Date().toISOString(),
    result: null,
    error_message: null,
  };
  await db.put(STORE, record);
  return record;
}

export async function getAllItems() {
  const db = await getDb();
  const items = await db.getAll(STORE);
  return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getItemsByStatus(statuses) {
  const items = await getAllItems();
  return items.filter((i) => statuses.includes(i.status));
}

export async function updateItem(clientRefId, patch) {
  const db = await getDb();
  const existing = await db.get(STORE, clientRefId);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  await db.put(STORE, updated);
  return updated;
}

// Synced items are kept briefly (for the "recently synced" confirmation
// list) rather than deleted immediately — callers prune with clearSynced()
// once they've shown that confirmation.
export async function clearSynced() {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const items = await tx.store.index('status').getAll('synced');
  await Promise.all(items.map((i) => tx.store.delete(i.client_ref_id)));
  await tx.done;
}

// Used when staff dismisses a conflict card after reviewing it — there's
// nothing left to sync for that queued action, it was superseded by
// whatever the server already had.
export async function deleteItem(clientRefId) {
  const db = await getDb();
  await db.delete(STORE, clientRefId);
}
