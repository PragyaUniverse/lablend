import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store, save, loadExisting, checkPassword, uid } from './db.js';
import { now, setClockOffset, clockOffset, zoned, wallToMs, dateAdd, minutesOf, TZ, DAY, H, MIN } from './time.js';
import { verify as verifyAudit } from './audit.js';
import { aiStatus, matchResources } from './ai.js';
import { seed, DEMO_ACCOUNTS, DEMO_PASSWORD } from './seed.js';
import * as L from './logic.js';

const { HttpError } = L;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const DEMO = process.env.DEMO_MODE !== 'false';
const SESSION_HOURS = 12;
const D = () => store.db;

// ---------- Boot ----------
async function boot() {
  const loaded = loadExisting();
  const staleHours = Number(process.env.AUTO_RESEED_HOURS || 24);
  if (!loaded || (DEMO && staleHours > 0 && Date.now() - (D().settings.seededAt || 0) > staleHours * H)) {
    store.db = await seed();
    save(true);
    console.log('Seeded fresh demo data.');
  }
  setClockOffset(D().settings.clockOffset || 0);
}
await boot();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  });
  next();
});
app.use(express.json({ limit: '6mb' }));

// ---------- Sessions & CSRF ----------
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function startSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  D().sessions[tokenHash(token)] = { userId: user.id, exp: Date.now() + SESSION_HOURS * H };
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `ll_sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
  save();
}
app.use((req, res, next) => {
  const token = readCookie(req, 'll_sid');
  if (token) {
    const s = D().sessions[tokenHash(token)];
    if (s && s.exp > Date.now()) req.user = L.getUser(s.userId);
  }
  if (req.path.startsWith('/api') && !['GET', 'HEAD'].includes(req.method)) {
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON requests only' });
    const origin = req.headers.origin;
    let sameSite = true;
    try { sameSite = !origin || new URL(origin).host === req.headers.host; } catch { sameSite = false; }
    if (!sameSite) return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please sign in' }));
const role = (...roles) => (req, res, next) => (req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission for this' }));
const staff = role('owner', 'manager', 'admin');

// Lazy scheduler: run time-based rules before each API call (plus a background timer).
app.use('/api', wrap(async (req, res, next) => { await L.tick(); next(); }));
setInterval(() => L.tick().catch((e) => console.error(e)), 30_000).unref();

// ---------- Views (privacy-scoped serialisers) ----------
const pubUser = (u) => u && { id: u.id, name: u.name, role: u.role, affiliation: u.affiliation, department: u.department };
function meView(u) {
  const { password, ...rest } = u;
  return { ...rest, credentials: u.credentials.map((c) => ({ ...c, typeName: L.CRED_TYPES[c.type]?.name })) };
}
function orgView(o) { return o && { id: o.id, name: o.name, short: o.short, type: o.type, verified: o.verified, verifiedBy: o.verifiedBy }; }

// Is it free right now, and when is the next free hour? (privacy-safe: no names)
function liveAvailability(r, viewer) {
  const t = now();
  const openNow = r.status === 'active' && L.hoursCheck(r, t, t + 30 * MIN).ok;
  const freeNow = openNow && !L.conflicts(r, t, t + 30 * MIN).held.length;
  const next = r.status === 'active' && viewer ? L.suggestSlots(viewer, r, t, t + H)[0] : null;
  return { openNow, freeNow, nextFree: next ? next.start : null };
}

function resView(r, viewer) {
  const t = now();
  const bs = D().bookings.filter((b) => b.resourceId === r.id);
  const el = viewer ? L.eligibility(viewer, r) : null;
  return {
    ...r,
    org: orgView(L.getOrg(r.orgId)),
    eligibility: el && { summary: el.summary, checks: el.checks },
    demand: {
      upcoming: bs.filter((b) => L.HOLD.includes(b.status) && b.end > t).length,
      pending: bs.filter((b) => b.status === 'pending').length,
      waitlist: bs.filter((b) => b.status === 'waitlisted').length,
    },
    live: liveAvailability(r, viewer),
    canManage: viewer ? L.canManage(viewer, r) : false,
    canEdit: viewer ? L.canEditListing(viewer, r) : false,
    managers: L.managersOf(r).map((m) => ({ name: m.name, role: m.role })),
  };
}

function actionsFor(b, viewer) {
  const res = L.getRes(b.resourceId);
  const mine = b.userId === viewer.id;
  const mgr = L.canManage(viewer, res);
  const t = now();
  const a = [];
  if (mgr && ['pending', 'waitlisted'].includes(b.status)) a.push('approve', 'reject');
  if (mgr && b.status === 'pending') a.push('waitlist');
  if ((mine || mgr) && ['pending', 'approved', 'waitlisted'].includes(b.status)) a.push('cancel');
  if (mine && b.status === 'approved' && t >= b.start - L.POLICY.checkInEarlyMin * MIN && t <= b.end) a.push('checkin');
  if (mine && b.status === 'checked_in') a.push('checkout');
  if (mine && ['approved', 'checked_in'].includes(b.status) && !b.extensions.some((e) => e.status === 'pending')) a.push('extend');
  if (mgr && b.status === 'checked_in' && b.checkIn?.supervisorRequired && !b.checkIn.supervisorSignoff) a.push('signoff');
  if (mgr && b.status === 'returned') a.push('inspect');
  if (mgr && b.extensions.some((e) => e.status === 'pending')) a.push('decide_extension');
  if ((mine || mgr) && ['checked_in', 'returned', 'completed', 'no_show', 'approved'].includes(b.status)) a.push('report');
  return a;
}

const stripPhotos = (x) => x && { ...x, photos: undefined, photoCount: x.photos?.length || 0 };
function bookingView(b, viewer, full = false) {
  const res = L.getRes(b.resourceId);
  const u = L.getUser(b.userId);
  const mgr = L.canManage(viewer, res);
  const mine = b.userId === viewer.id;
  if (!mine && !mgr) return null;
  const live = mgr && ['pending', 'waitlisted'].includes(b.status);
  return {
    ...b,
    checkIn: full ? b.checkIn : stripPhotos(b.checkIn),
    checkOut: full ? b.checkOut : stripPhotos(b.checkOut),
    resource: { id: res.id, name: res.name, icon: res.icon, location: res.location, checklist: res.checklist, rules: res.rules, approvalMode: res.approvalMode, loan: res.loan, requirements: res.requirements, orgShort: L.getOrg(res.orgId)?.short },
    user: { ...pubUser(u), ...(mgr ? { email: u.email, strikes: u.strikes || 0, verified: u.verified } : {}) },
    waitlistPosition: b.status === 'waitlisted' ? L.waitlistPosition(b) : null,
    overdue: b.status === 'checked_in' && now() > b.end,
    actions: actionsFor(b, viewer),
    livePriority: live ? L.priority(u, res, b.purposeCategory) : null,
    liveEligibility: live ? L.eligibility(u, res) : null,
    incidents: D().incidents.filter((i) => i.bookingId === b.id).map((i) => ({ id: i.id, ref: i.ref, type: i.type, status: i.status, severity: i.severity })),
  };
}

function incidentView(inc, viewer) {
  const res = L.getRes(inc.resourceId);
  const mgr = L.canManage(viewer, res);
  const involved = viewer.id === inc.subjectUserId || viewer.id === inc.reportedBy;
  if (!mgr && !involved) return null;
  const b = inc.bookingId ? L.getBooking(inc.bookingId) : null;
  return {
    ...inc,
    resource: { id: res.id, name: res.name, icon: res.icon, value: res.value, status: res.status },
    booking: b ? { id: b.id, ref: b.ref, start: b.start, end: b.end, deposit: b.deposit, checkIn: b.checkIn, checkOut: b.checkOut, inspection: b.inspection } : null,
    subject: inc.subjectUserId ? pubUser(L.getUser(inc.subjectUserId)) : null,
    canResolve: mgr && (inc.status === 'open' || (inc.status === 'disputed' && viewer.role === 'admin')),
    canDispute: viewer.id === inc.subjectUserId && inc.status === 'resolved' && !inc.resolution?.reviewOfDispute,
  };
}

// ---------- Meta, auth & demo ----------
app.get('/api/meta', (req, res) => res.json({
  tz: TZ, now: now(), clockOffset: clockOffset(), demo: DEMO, ai: aiStatus(), policy: L.POLICY,
  credTypes: L.credTypesPublic(), purposes: L.PURPOSES, affiliations: L.AFFILIATIONS,
  incidentTypes: L.INCIDENT_TYPES, resolutions: L.RESOLUTIONS, seededAt: D().settings.seededAt,
}));

// Public, privacy-safe overview for the landing page (no personal data).
app.get('/api/public/overview', (req, res) => {
  const active = D().resources.filter((r) => r.status !== 'archived');
  const stats = active.map((r) => L.resourceStats(r));
  res.json({
    resources: active.map((r) => ({ id: r.id, name: r.name, icon: r.icon, tags: r.tags, category: r.category, org: L.getOrg(r.orgId)?.short, building: r.building, approvalMode: r.approvalMode, highDemand: r.highDemand })),
    totals: {
      resources: active.length,
      orgs: D().orgs.filter((o) => o.verified).length,
      hoursUsed: Math.round(stats.reduce((s, x) => s + x.bookedHours, 0)),
      idleHours: Math.round(stats.reduce((s, x) => s + x.idleHours, 0)),
      communityHours: Math.round(stats.reduce((s, x) => s + x.communityHours, 0)),
      auditEntries: D().audit.length,
    },
  });
});

const attempts = new Map();
app.post('/api/auth/login', wrap(async (req, res) => {
  const key = req.ip;
  const a = attempts.get(key) || { n: 0, since: Date.now() };
  if (Date.now() - a.since > 10 * MIN) { a.n = 0; a.since = Date.now(); }
  if (a.n >= 20) throw new HttpError(429, 'Too many sign-in attempts. Try again in a few minutes.');
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = D().users.find((u) => u.email === email);
  if (!user || !checkPassword(String(req.body.password || ''), user.password)) {
    a.n += 1; attempts.set(key, a);
    throw new HttpError(401, 'Email or password is incorrect');
  }
  attempts.delete(key);
  startSession(req, res, user);
  res.json({ user: meView(user) });
}));

app.post('/api/auth/logout', (req, res) => {
  const token = readCookie(req, 'll_sid');
  if (token) delete D().sessions[tokenHash(token)];
  res.set('Set-Cookie', 'll_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  save();
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: meView(req.user), orgs: req.user.orgIds.map((id) => orgView(L.getOrg(id))) }));

app.get('/api/demo/accounts', (req, res) => {
  if (!DEMO) return res.json({ accounts: [] });
  res.json({ password: DEMO_PASSWORD, accounts: DEMO_ACCOUNTS.map((a) => ({ ...a, name: D().users.find((u) => u.email === a.email)?.name })) });
});

app.post('/api/demo/clock', auth, (req, res) => {
  if (!DEMO) throw new HttpError(403, 'Demo controls are disabled');
  let off = clockOffset();
  if (req.body.reset) off = 0;
  else if (req.body.to) off = Number(req.body.to) - Date.now();
  else off += Math.max(-7 * 24 * 60, Math.min(7 * 24 * 60, Number(req.body.minutes) || 0)) * MIN;
  off = Math.max(0, off); // never travel before the real present: keeps the audit chain chronological
  setClockOffset(off);
  D().settings.clockOffset = off;
  L.log(req.user, 'demo.clock_changed', 'system', 'clock', `${req.user.name} set the demo clock to ${new Date(now()).toISOString()}`, { offsetMinutes: Math.round(off / MIN) });
  save();
  L.tick().then(() => res.json({ now: now(), clockOffset: off }));
});

let lastReset = 0;
app.post('/api/demo/reset', wrap(async (req, res) => {
  if (!DEMO) throw new HttpError(403, 'Demo controls are disabled');
  if (Date.now() - lastReset < 15_000) throw new HttpError(429, 'Demo data was just regenerated — try again in a few seconds');
  lastReset = Date.now();
  const sessions = D().sessions;
  store.db = await seed();
  D().sessions = sessions;
  setClockOffset(0);
  save(true);
  res.json({ ok: true });
}));

// ---------- Resources & discovery ----------
app.get('/api/orgs', auth, (req, res) => res.json({ orgs: D().orgs.map(orgView) }));

app.get('/api/resources', auth, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  let list = D().resources.filter((r) => r.status !== 'archived');
  if (req.query.category) list = list.filter((r) => r.category === req.query.category);
  if (req.query.building) list = list.filter((r) => r.building === req.query.building);
  if (req.query.org) list = list.filter((r) => r.orgId === req.query.org);
  if (q) list = list.filter((r) => `${r.name} ${r.description} ${r.tags.join(' ')} ${r.location}`.toLowerCase().includes(q));
  let out = list.map((r) => resView(r, req.user));
  if (req.query.eligible === '1') out = out.filter((r) => r.eligibility.summary !== 'not_eligible');
  if (req.query.mine === '1') out = out.filter((r) => r.canManage);
  if (req.query.free === '1') out = out.filter((r) => r.live.freeNow);
  const rank = { eligible: 0, conditional: 1, not_eligible: 2 };
  const sorters = {
    recommended: (a, b) => rank[a.eligibility.summary] - rank[b.eligibility.summary] || Number(b.live.freeNow) - Number(a.live.freeNow) || a.name.localeCompare(b.name),
    soonest: (a, b) => (a.live.nextFree ?? Infinity) - (b.live.nextFree ?? Infinity),
    demand: (a, b) => (b.demand.upcoming + b.demand.pending + b.demand.waitlist) - (a.demand.upcoming + a.demand.pending + a.demand.waitlist),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  out.sort(sorters[req.query.sort] || sorters.recommended);
  res.json({ resources: out, buildings: [...new Set(D().resources.map((r) => r.building))] });
});

app.get('/api/resources/:id', auth, (req, res) => {
  const r = L.getRes(req.params.id);
  if (!r) throw new HttpError(404, 'Resource not found');
  res.json({ resource: resView(r, req.user), stats: L.canManage(req.user, r) ? L.resourceStats(r) : null });
});

app.get('/api/resources/:id/calendar', auth, (req, res) => {
  const r = L.getRes(req.params.id);
  if (!r) throw new HttpError(404, 'Resource not found');
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : zoned(now()).date;
  const days = [];
  const mgr = L.canManage(req.user, r);
  for (let i = 0; i < 7; i++) {
    const date = dateAdd(from, i);
    const s = wallToMs(date, '00:00');
    const e = s + DAY;
    const dow = zoned(s + 12 * H).dow;
    const blocks = D().bookings
      .filter((b) => b.resourceId === r.id && ['pending', 'approved', 'checked_in', 'returned', 'completed'].includes(b.status) && b.start < e && b.end > s)
      .map((b) => ({
        start: Math.max(b.start, s), end: Math.min(b.end, e),
        kind: b.userId === req.user.id ? 'mine' : b.status === 'pending' ? 'pending' : 'booked',
        label: b.userId === req.user.id || mgr ? `${b.ref}${mgr ? ` · ${L.getUser(b.userId).name}` : ''}` : (b.status === 'pending' ? 'Requested' : 'Booked'),
      }));
    days.push({ date, dow, open: r.availability.days.includes(dow), openAt: r.availability.open, closeAt: r.availability.close, dayStart: s, blocks });
  }
  res.json({ days, now: now() });
});

function validateResource(body, actor, existing = null) {
  const s = (v, max = 200) => String(v ?? '').trim().slice(0, max);
  const name = s(body.name, 120);
  if (name.length < 3) throw new HttpError(400, 'Give the resource a name');
  const orgId = existing ? existing.orgId : body.orgId;
  if (!actor.orgIds.includes(orgId) && actor.role !== 'admin') throw new HttpError(403, 'You can only list resources for your own organisation');
  if (!L.getOrg(orgId)?.verified) throw new HttpError(403, 'Only verified organisations can list resources');
  const rq = body.requirements || {};
  const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d; };
  const days = (Array.isArray(body.availability?.days) ? body.availability.days : []).map(Number).filter((d) => d >= 0 && d <= 6);
  const open = /^\d{2}:\d{2}$/.test(body.availability?.open) ? body.availability.open : '09:00';
  const close = /^(\d{2}:\d{2})$/.test(body.availability?.close) ? body.availability.close : '17:00';
  if (!days.length) throw new HttpError(400, 'Choose at least one available day');
  if (minutesOf(close) <= minutesOf(open)) throw new HttpError(400, 'Closing time must be after opening time');
  const list = (v, max = 10) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => s(x, 160)).filter(Boolean).slice(0, max);
  const checklist = list(body.checklist, 12);
  if (!checklist.length) throw new HttpError(400, 'Add at least one condition checklist item');
  const affiliations = (rq.affiliations || []).filter((a) => L.AFFILIATIONS[a]);
  if (!affiliations.length) throw new HttpError(400, 'Choose at least one eligible user group');
  return {
    name, orgId, icon: s(body.icon, 4) || '📦', category: ['equipment', 'space', 'computing'].includes(body.category) ? body.category : 'equipment',
    description: s(body.description, 800), location: s(body.location, 160), building: s(body.building, 80) || 'Other',
    capacity: body.capacity ? num(body.capacity, 1, 500, null) : null, value: num(body.value, 0, 1e9, 0),
    loan: !!body.loan, riskLevel: ['low', 'medium', 'high'].includes(body.riskLevel) ? body.riskLevel : 'low',
    approvalMode: body.approvalMode === 'auto' ? 'auto' : 'manual', highDemand: !!body.highDemand,
    tags: list(body.tags, 10).map((t) => t.toLowerCase()),
    requirements: {
      credentials: (rq.credentials || []).filter((c) => L.CRED_TYPES[c]), affiliations,
      supervision: !!rq.supervision, deposit: num(rq.deposit, 0, 100000, 0),
      minLeadHours: num(rq.minLeadHours, 0, 168, 0), maxHours: num(rq.maxHours, 0.5, 168, 4),
      weeklyCapHours: num(rq.weeklyCapHours, 0.5, 168, 8), maxAdvanceDays: num(rq.maxAdvanceDays, 1, 90, 14),
      reviewAffiliations: (rq.reviewAffiliations || []).filter((a) => L.AFFILIATIONS[a]),
    },
    availability: { days, open, close }, rules: list(body.rules, 10), checklist,
  };
}

app.post('/api/resources', auth, role('owner', 'admin'), (req, res) => {
  const data = validateResource(req.body, req.user);
  const r = { id: uid('r'), ...data, status: 'active', createdAt: now(), createdBy: req.user.id };
  D().resources.push(r);
  L.log(req.user, 'resource.listed', 'resource', r.id, `${req.user.name} listed ${r.name}`, { approvalMode: r.approvalMode, credentials: r.requirements.credentials, supervision: r.requirements.supervision, deposit: r.requirements.deposit });
  save();
  res.json({ resource: resView(r, req.user) });
});

app.put('/api/resources/:id', auth, (req, res) => {
  const r = L.getRes(req.params.id);
  if (!r) throw new HttpError(404, 'Resource not found');
  if (!L.canEditListing(req.user, r)) throw new HttpError(403, 'Only the resource owner can change the listing');
  const data = validateResource(req.body, req.user, r);
  const changed = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(r[k]));
  Object.assign(r, data);
  L.log(req.user, 'resource.updated', 'resource', r.id, `${req.user.name} updated ${r.name} (${changed.join(', ') || 'no changes'})`, { changed });
  save();
  res.json({ resource: resView(r, req.user) });
});

app.post('/api/resources/:id/status', auth, (req, res) => {
  const r = L.getRes(req.params.id);
  if (!r) throw new HttpError(404, 'Resource not found');
  if (!L.canManage(req.user, r)) throw new HttpError(403, 'Not allowed');
  const status = req.body.status;
  if (!['active', 'paused', 'maintenance'].includes(status)) throw new HttpError(400, 'Unknown status');
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 5) throw new HttpError(400, 'Please give a reason');
  const from = r.status;
  r.status = status;
  L.log(req.user, 'resource.status_changed', 'resource', r.id, `${req.user.name} changed ${r.name} from ${from} to ${status}`, { from, to: status, reason });
  save();
  res.json({ resource: resView(r, req.user) });
});

app.post('/api/match', auth, wrap(async (req, res) => {
  const query = String(req.body.query || '').trim().slice(0, 400);
  if (query.length < 3) throw new HttpError(400, 'Describe what you need');
  const catalog = D().resources.filter((r) => r.status === 'active');
  const result = await matchResources(query, catalog);
  res.json({
    source: result.source,
    matches: result.matches.map((m) => ({ ...m, resource: resView(L.getRes(m.resourceId), req.user) })),
  });
}));

// ---------- Bookings ----------
app.post('/api/bookings/precheck', auth, (req, res) => {
  const r = L.getRes(req.body.resourceId);
  if (!r) throw new HttpError(404, 'Resource not found');
  const { start, end } = L.parseSlot(req.body);
  res.json({ evaluation: L.evaluate(req.user, r, { start, end, purposeCategory: req.body.purposeCategory }) });
});

app.post('/api/bookings', auth, (req, res) => {
  const b = L.createBooking(req.user, req.body);
  res.json({ booking: bookingView(b, req.user) });
});

app.get('/api/bookings', auth, (req, res) => {
  const scope = req.query.scope || 'mine';
  let list;
  if (scope === 'mine') list = D().bookings.filter((b) => b.userId === req.user.id);
  else list = D().bookings.filter((b) => L.canManage(req.user, L.getRes(b.resourceId)));
  list = list.slice().sort((a, b) => b.start - a.start).map((b) => bookingView(b, req.user)).filter(Boolean);
  res.json({ bookings: list });
});

function loadBooking(req) {
  const b = L.getBooking(req.params.id);
  if (!b) throw new HttpError(404, 'Booking not found');
  const view = bookingView(b, req.user, true);
  if (!view) throw new HttpError(403, 'You do not have access to this booking');
  return b;
}

app.get('/api/bookings/:id', auth, (req, res) => {
  const b = loadBooking(req);
  const incIds = D().incidents.filter((i) => i.bookingId === b.id).map((i) => i.id);
  const timeline = D().audit.filter((e) => e.entityId === b.id || incIds.includes(e.entityId));
  res.json({ booking: bookingView(b, req.user, true), timeline });
});

app.post('/api/bookings/:id/decision', auth, (req, res) => { const b = L.decide(req.user, loadBooking(req), req.body); res.json({ booking: bookingView(b, req.user, true) }); });
app.post('/api/bookings/:id/cancel', auth, (req, res) => { const b = L.cancel(req.user, loadBooking(req), req.body); res.json({ booking: bookingView(b, req.user, true) }); });
app.post('/api/bookings/:id/checkin', auth, (req, res) => { const b = L.checkIn(req.user, loadBooking(req), req.body); res.json({ booking: bookingView(b, req.user, true) }); });
app.post('/api/bookings/:id/signoff', auth, (req, res) => { const b = L.signoff(req.user, loadBooking(req)); res.json({ booking: bookingView(b, req.user, true) }); });
app.post('/api/bookings/:id/checkout', auth, wrap(async (req, res) => { const b = await L.checkOut(req.user, loadBooking(req), req.body); res.json({ booking: bookingView(b, req.user, true) }); }));
app.post('/api/bookings/:id/inspect', auth, wrap(async (req, res) => { const b = await L.inspect(req.user, loadBooking(req), req.body); res.json({ booking: bookingView(b, req.user, true) }); }));
app.post('/api/bookings/:id/extend', auth, (req, res) => { const b = L.requestExtension(req.user, loadBooking(req), req.body); res.json({ booking: bookingView(b, req.user, true) }); });
app.post('/api/bookings/:id/extension', auth, (req, res) => { const b = L.decideExtension(req.user, loadBooking(req), req.body); res.json({ booking: bookingView(b, req.user, true) }); });

// ---------- Manager workspace ----------
app.get('/api/manage/queue', auth, staff, (req, res) => {
  const t = now();
  const mine = D().bookings.filter((b) => ['pending', 'waitlisted'].includes(b.status) && b.end > t && L.canManage(req.user, L.getRes(b.resourceId)));
  const groups = [];
  for (const b of mine.sort((a, b) => a.start - b.start)) {
    const g = groups.find((x) => x.resourceId === b.resourceId && x.start < b.end && b.start < x.end);
    if (g) { g.items.push(b); g.end = Math.max(g.end, b.end); } else groups.push({ resourceId: b.resourceId, start: b.start, end: b.end, items: [b] });
  }
  res.json({
    groups: groups.map((g) => {
      const items = g.items.map((b) => bookingView(b, req.user)).sort((a, b) => (b.livePriority?.score ?? 0) - (a.livePriority?.score ?? 0) || a.createdAt - b.createdAt);
      return { resource: { id: g.resourceId, name: L.getRes(g.resourceId).name, icon: L.getRes(g.resourceId).icon }, start: g.start, end: g.end, contested: items.length > 1, items };
    }),
  });
});

app.get('/api/manage/active', auth, staff, (req, res) => {
  const t = now();
  const list = D().bookings.filter((b) => L.canManage(req.user, L.getRes(b.resourceId)));
  const v = (arr) => arr.map((b) => bookingView(b, req.user));
  res.json({
    inUse: v(list.filter((b) => b.status === 'checked_in').sort((a, b) => a.end - b.end)),
    returns: v(list.filter((b) => b.status === 'returned')),
    upcoming: v(list.filter((b) => b.status === 'approved' && b.start < t + 2 * DAY).sort((a, b) => a.start - b.start)),
    extensions: v(list.filter((b) => b.extensions.some((e) => e.status === 'pending'))),
  });
});

app.get('/api/manage/overview', auth, staff, (req, res) => {
  const resources = D().resources.filter((r) => L.canManage(req.user, r));
  res.json({ stats: resources.map((r) => ({ ...L.resourceStats(r), icon: r.icon, status: r.status, highDemand: r.highDemand })) });
});

app.get('/api/manage/verifications', auth, staff, wrap(async (req, res) => {
  const items = [];
  for (const u of D().users) {
    for (const c of u.credentials.filter((x) => x.status === 'pending' && L.canVerify(req.user, x.type))) {
      items.push({ user: { ...pubUser(u), email: u.email }, credential: { ...c, typeName: L.CRED_TYPES[c.type].name, expectedIssuer: L.CRED_TYPES[c.type].issuer }, assessment: await L.credentialAssessment(u, c) });
    }
  }
  res.json({ items });
}));

app.post('/api/credentials/:userId/:credId/review', auth, staff, (req, res) => {
  const u = L.getUser(req.params.userId);
  const c = u?.credentials.find((x) => x.id === req.params.credId);
  if (!c) throw new HttpError(404, 'Record not found');
  L.reviewCredentialDecision(req.user, u, c, { approve: !!req.body.approve, note: req.body.note });
  res.json({ ok: true });
});

app.post('/api/credentials', auth, (req, res) => {
  const c = L.submitCredential(req.user, req.body);
  res.json({ credential: c });
});

// ---------- Incidents ----------
app.post('/api/incidents', auth, wrap(async (req, res) => {
  const inc = await L.createIncident(req.user, req.body, L.isStaff(req.user) || req.user.role === 'admin' ? 'staff' : 'user');
  res.json({ incident: incidentView(inc, req.user) });
}));

app.get('/api/incidents', auth, (req, res) => {
  const list = D().incidents.map((i) => incidentView(i, req.user)).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)
    .map((i) => ({ ...i, photos: undefined, booking: i.booking && { id: i.booking.id, ref: i.booking.ref } }));
  res.json({ incidents: list });
});

function loadIncident(req) {
  const inc = L.getIncident(req.params.id);
  if (!inc) throw new HttpError(404, 'Incident not found');
  if (!incidentView(inc, req.user)) throw new HttpError(403, 'You do not have access to this incident');
  return inc;
}
app.get('/api/incidents/:id', auth, (req, res) => {
  const inc = loadIncident(req);
  res.json({ incident: incidentView(inc, req.user), timeline: D().audit.filter((e) => e.entityId === inc.id) });
});
app.post('/api/incidents/:id/resolve', auth, (req, res) => { const inc = L.resolveIncident(req.user, loadIncident(req), req.body); res.json({ incident: incidentView(inc, req.user) }); });
app.post('/api/incidents/:id/respond', auth, (req, res) => { const inc = L.respondIncident(req.user, loadIncident(req), req.body); res.json({ incident: incidentView(inc, req.user) }); });

// ---------- Sidebar counts ----------
app.get('/api/summary', auth, (req, res) => {
  const u = req.user;
  const t = now();
  const mine = D().bookings.filter((b) => b.userId === u.id);
  const managed = L.isStaff(u) || u.role === 'admin' ? D().bookings.filter((b) => L.canManage(u, L.getRes(b.resourceId))) : [];
  res.json({
    unread: D().notifications.filter((n) => n.userId === u.id && !n.read).length,
    myActive: mine.filter((b) => ['approved', 'checked_in', 'returned'].includes(b.status)).length,
    myRequests: mine.filter((b) => ['pending', 'waitlisted'].includes(b.status)).length,
    queue: managed.filter((b) => b.status === 'pending' && b.end > t).length,
    operations: managed.filter((b) => b.status === 'returned' || (b.status === 'checked_in' && (t > b.end || (b.checkIn?.supervisorRequired && !b.checkIn.supervisorSignoff)))).length,
    verifications: D().users.reduce((n, x) => n + x.credentials.filter((c) => c.status === 'pending' && L.canVerify(u, c.type)).length, 0),
    incidents: D().incidents.filter((i) => ['open', 'disputed'].includes(i.status) && (L.canManage(u, L.getRes(i.resourceId)) || i.subjectUserId === u.id)).length,
    unverifiedUsers: u.role === 'admin' ? D().users.filter((x) => !x.verified).length : 0,
  });
});

// ---------- Notifications ----------
app.get('/api/notifications', auth, (req, res) => {
  const list = D().notifications.filter((n) => n.userId === req.user.id).sort((a, b) => b.at - a.at).slice(0, 60);
  res.json({ notifications: list, unread: list.filter((n) => !n.read).length });
});
app.post('/api/notifications/read', auth, (req, res) => {
  for (const n of D().notifications) if (n.userId === req.user.id && (req.body.all || req.body.ids?.includes(n.id))) n.read = true;
  save();
  res.json({ ok: true });
});

// ---------- Audit, fairness, flags, admin ----------
function auditScope(user) {
  if (user.role === 'admin') return () => true;
  const ids = new Set([user.id]);
  for (const b of D().bookings) if (b.userId === user.id || L.canManage(user, L.getRes(b.resourceId))) ids.add(b.id);
  for (const i of D().incidents) if (i.subjectUserId === user.id || i.reportedBy === user.id || L.canManage(user, L.getRes(i.resourceId))) ids.add(i.id);
  for (const r of D().resources) if (L.canManage(user, r)) ids.add(r.id);
  return (e) => ids.has(e.entityId);
}

app.get('/api/audit', auth, (req, res) => {
  const inScope = auditScope(req.user);
  const q = String(req.query.q || '').toLowerCase();
  let list = D().audit.filter(inScope);
  if (req.query.action) list = list.filter((e) => e.action.startsWith(req.query.action));
  if (q) list = list.filter((e) => `${e.summary} ${e.actorName} ${e.action}`.toLowerCase().includes(q));
  res.json({ total: list.length, entries: list.slice(-300).reverse() });
});

app.get('/api/audit/verify', auth, (req, res) => res.json(verifyAudit(D().audit)));

app.get('/api/audit/export.csv', auth, role('admin'), (req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['seq', 'at', 'actor', 'role', 'action', 'entityType', 'entityId', 'summary', 'prevHash', 'hash'].join(',')];
  for (const e of D().audit) rows.push([e.seq, new Date(e.at).toISOString(), e.actorName, e.actorRole, e.action, e.entityType, e.entityId, e.summary, e.prevHash, e.hash].map(esc).join(','));
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="lablend-audit.csv"' });
  res.send(rows.join('\n'));
});

app.get('/api/flags', auth, staff, (req, res) => res.json({ flags: L.usageFlags(req.user.role === 'admin' ? null : req.user.orgIds) }));

app.get('/api/fairness', auth, (req, res) => {
  const high = D().resources.filter((r) => r.highDemand).map((r) => {
    const s = L.resourceStats(r);
    return { id: r.id, name: r.name, icon: r.icon, weeklyCapHours: r.requirements.weeklyCapHours, utilisation: s.utilisation, uniqueUsers: s.uniqueUsers, topUserShare: s.topUserShare, waitlisted: s.waitlisted, requests: s.requests };
  });
  const all = D().resources.map((r) => L.resourceStats(r));
  res.json({
    policy: L.POLICY, purposes: L.PURPOSES, highDemand: high,
    totals: {
      idleHoursUnlocked: Math.round(all.reduce((s, x) => s + x.bookedHours, 0)),
      communityHours: Math.round(all.reduce((s, x) => s + x.communityHours, 0)),
      uniqueUsers: new Set(D().bookings.filter((b) => ['completed', 'returned', 'checked_in'].includes(b.status)).map((b) => b.userId)).size,
    },
  });
});

app.get('/api/me/export', auth, (req, res) => {
  const u = req.user;
  const data = {
    exportedAt: new Date().toISOString(), profile: meView(u),
    bookings: D().bookings.filter((b) => b.userId === u.id),
    incidents: D().incidents.filter((i) => i.subjectUserId === u.id || i.reportedBy === u.id),
    notifications: D().notifications.filter((n) => n.userId === u.id),
    activity: D().audit.filter((e) => e.actorId === u.id || e.entityId === u.id),
  };
  res.set({ 'Content-Disposition': 'attachment; filename="my-lablend-data.json"' });
  res.json(data);
});

app.get('/api/admin/users', auth, role('admin'), (req, res) => {
  res.json({
    users: D().users.map((u) => ({
      ...pubUser(u), email: u.email, verified: u.verified, verifiedVia: u.verifiedVia, status: u.status, strikes: u.strikes || 0, orgIds: u.orgIds,
      credentials: u.credentials.map((c) => ({ type: c.type, typeName: L.CRED_TYPES[c.type].name, status: c.status })),
      bookings: D().bookings.filter((b) => b.userId === u.id).length,
    })),
    orgs: D().orgs.map(orgView),
  });
});

app.post('/api/admin/users/:id', auth, role('admin'), (req, res) => {
  const u = L.getUser(req.params.id);
  if (!u) throw new HttpError(404, 'User not found');
  const reason = String(req.body.reason || '').trim();
  const a = req.body.action;
  if (a !== 'verify' && reason.length < 5) throw new HttpError(400, 'Please record a reason for this change');
  if (u.id === req.user.id && ['restrict', 'role'].includes(a)) throw new HttpError(400, 'You cannot change your own access');
  if (a === 'verify') {
    if (u.verified) throw new HttpError(409, 'Already verified');
    u.verified = true; u.verifiedVia = `${req.body.method || 'Photo ID'} checked by ${req.user.name} (admin)`;
    L.log(req.user, 'user.identity_verified', 'user', u.id, `${req.user.name} verified the identity of ${u.name}`, { method: req.body.method || 'Photo ID' });
    L.notify(u.id, 'Identity verified', 'You can now request resources that match your training and user group.', '#/discover', 'success');
  } else if (a === 'restrict' || a === 'unrestrict') {
    u.status = a === 'restrict' ? 'restricted' : 'active';
    L.log(req.user, `user.${a}ed`, 'user', u.id, `${req.user.name} ${a === 'restrict' ? 'restricted' : 'restored'} booking access for ${u.name}`, { reason });
    L.notify(u.id, a === 'restrict' ? 'Booking access restricted' : 'Booking access restored', reason, '#/profile', a === 'restrict' ? 'danger' : 'success');
  } else if (a === 'role') {
    if (!['member', 'manager', 'owner', 'admin'].includes(req.body.role)) throw new HttpError(400, 'Unknown role');
    const orgIds = (req.body.orgIds || []).filter((id) => L.getOrg(id));
    const from = u.role;
    u.role = req.body.role; u.orgIds = ['manager', 'owner'].includes(u.role) ? orgIds : [];
    L.log(req.user, 'user.role_changed', 'user', u.id, `${req.user.name} changed ${u.name}'s role from ${from} to ${u.role}`, { from, to: u.role, orgIds: u.orgIds, reason });
  } else if (a === 'clear_strike') {
    u.strikes = Math.max(0, (u.strikes || 0) - 1);
    L.log(req.user, 'user.strike_cleared', 'user', u.id, `${req.user.name} cleared a strike for ${u.name}`, { reason, strikes: u.strikes });
  } else throw new HttpError(400, 'Unknown action');
  save();
  res.json({ ok: true });
});

// ---------- Static app ----------
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: 0 }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Upload too large — use fewer or smaller photos' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

app.listen(PORT, () => console.log(`LabLend running on http://localhost:${PORT} (timezone ${TZ}, AI ${aiStatus().enabled ? 'on' : 'rules-only'})`));
