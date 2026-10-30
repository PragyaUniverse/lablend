// Append-only, hash-chained activity history. Each entry stores the SHA-256 of the
// previous entry, so editing or deleting any past record breaks the chain and is
// detected by verify(). This makes approvals, rejections and penalties tamper-evident.
import crypto from 'node:crypto';

export function hashEntry(entry) {
  const { hash, ...rest } = entry;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

export function record(db, { actor, action, entityType, entityId, summary, details = {}, at }) {
  const prev = db.audit[db.audit.length - 1];
  const entry = {
    seq: (prev?.seq || 0) + 1,
    at,
    actorId: actor?.id || 'system',
    actorName: actor?.name || 'LabLend rules engine',
    actorRole: actor?.role || 'system',
    action,
    entityType,
    entityId,
    summary,
    details,
    prevHash: prev?.hash || 'GENESIS',
  };
  entry.hash = hashEntry(entry);
  db.audit.push(entry);
  return entry;
}

export function verify(audit) {
  let prev = 'GENESIS';
  for (const e of audit) {
    if (e.prevHash !== prev) return { ok: false, count: audit.length, brokenAt: e.seq, reason: 'Link to previous entry does not match' };
    if (hashEntry(e) !== e.hash) return { ok: false, count: audit.length, brokenAt: e.seq, reason: 'Entry content was modified after it was written' };
    prev = e.hash;
  }
  return { ok: true, count: audit.length, head: prev };
}
