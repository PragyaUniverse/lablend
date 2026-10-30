// Tiny persistent document store: the whole state lives in memory and is written
// atomically (write temp file + rename) to data/db.json after every change.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'db.json');

export const store = { db: null };

// Returns true if an existing database was loaded; otherwise the caller seeds one.
export function loadExisting() {
  if (!fs.existsSync(FILE) || process.env.RESET_ON_START) return false;
  try {
    store.db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return true;
  } catch (e) {
    console.warn('Could not read database, reseeding:', e.message);
    return false;
  }
}

let timer = null;
function write() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store.db));
  fs.renameSync(tmp, FILE);
}

export function save(immediate = false) {
  if (immediate) { clearTimeout(timer); return write(); }
  clearTimeout(timer);
  timer = setTimeout(write, 150);
}

export const uid = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;

export function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
