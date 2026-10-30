// LabLend rules engine and resource-sharing lifecycle.
// Principle: the system checks, explains and proposes; authorised people decide anything
// that affects access, safety or penalties. Every state change is written to the audit chain.
import { store, save, uid } from './db.js';
import { now, zoned, wallToMs, minutesOf, fmt, fmtH, MIN, H, DAY } from './time.js';
import { record } from './audit.js';
import { summariseIncident, reviewCredential } from './ai.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

const D = () => store.db;
export const SYSTEM = { id: 'system', name: 'LabLend rules engine', role: 'system' };

export const POLICY = {
  maxActiveBookings: 4,          // open requests + upcoming bookings per person, platform-wide
  checkInEarlyMin: 15,           // check-in opens 15 min before start
  noShowGraceMin: 30,            // not checked in 30 min after start => no-show
  lateCancelHours: 2,            // cancelling an approved slot within 2 h is a "late cancellation"
  lateReturnGraceMin: 15,        // returns more than 15 min late open a delay review
  strikeReviewThreshold: 3,      // 3+ confirmed strikes => every request needs human review
  reminderMin: 60,               // reminder sent 60 min before start
  usagePenaltyPerHour: 3,        // priority points removed per hour used recently
  usagePenaltyCap: 30,
  firstTimeBonus: 10,
  strikePenalty: 10,
};

export const PURPOSES = {
  coursework: { label: 'Coursework or assessment', points: 15 },
  research: { label: 'Research', points: 10 },
  community: { label: 'Community or non-profit project', points: 8 },
  startup: { label: 'Early-stage venture', points: 6 },
  personal: { label: 'Personal learning', points: 4 },
};

export const AFFILIATIONS = { student: 'Student', researcher: 'Researcher', staff: 'Staff', community: 'Community member' };

export const CRED_TYPES = {
  'laser-safety': { name: 'Laser Cutter Safety Induction', issuer: 'Northfield FabLab', pattern: /^FAB-LS-\d{4}$/, example: 'FAB-LS-1234', validityMonths: 12 },
  '3dp-basics': { name: '3D Printing Basics', issuer: 'Northfield FabLab', pattern: /^FAB-3D-\d{4}$/, example: 'FAB-3D-1234', validityMonths: 24 },
  'cnc-l2': { name: 'CNC Machining Level 2', issuer: 'Northfield FabLab', pattern: /^FAB-CNC-\d{4}$/, example: 'FAB-CNC-1234', validityMonths: 12 },
  'media-handling': { name: 'Media Equipment Handling', issuer: 'School of Media', pattern: /^MED-EQ-\d{4}$/, example: 'MED-EQ-1234', validityMonths: 24 },
  'electrical-safety': { name: 'Electrical Safety Basics', issuer: 'Northfield EHS Office', pattern: /^EHS-EL-\d{4}$/, example: 'EHS-EL-1234', validityMonths: 24 },
};
export const credTypesPublic = () => Object.fromEntries(Object.entries(CRED_TYPES).map(([k, v]) => [k, { name: v.name, issuer: v.issuer, example: v.example, validityMonths: v.validityMonths }]));

export const HOLD = ['approved', 'checked_in'];
const OPEN = ['pending', 'approved', 'waitlisted'];
const USED = ['approved', 'checked_in', 'returned', 'completed'];
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
const hoursOf = (b) => (b.end - b.start) / H;

export const getUser = (id) => D().users.find((u) => u.id === id);
export const getRes = (id) => D().resources.find((r) => r.id === id);
export const getOrg = (id) => D().orgs.find((o) => o.id === id);
export const getBooking = (id) => D().bookings.find((b) => b.id === id);
export const getIncident = (id) => D().incidents.find((i) => i.id === id);

export const isStaff = (u) => u.role === 'owner' || u.role === 'manager';
export const canManage = (u, res) => u.role === 'admin' || (isStaff(u) && u.orgIds?.includes(res.orgId));
export const canEditListing = (u, res) => u.role === 'admin' || (u.role === 'owner' && u.orgIds?.includes(res.orgId));
export const managersOf = (res) => D().users.filter((u) => isStaff(u) && u.orgIds?.includes(res.orgId));
export const admins = () => D().users.filter((u) => u.role === 'admin');

export function log(actor, action, entityType, entityId, summary, details = {}) {
  return record(D(), { actor, action, entityType, entityId, summary, details, at: now() });
}

export function notify(userId, title, body, link = '', kind = 'info') {
  D().notifications.push({ id: uid('n'), userId, title, body, link, kind, at: now(), read: false });
}
const notifyMany = (users, ...args) => { for (const u of users) notify(u.id, ...args); };

function nextRef(prefix, list) {
  return `${prefix}-${1001 + list.length}`;
}

// ---------- Eligibility (person vs resource) ----------

export function credStatus(user, type) {
  const list = (user.credentials || []).filter((c) => c.type === type);
  const t = now();
  if (list.some((c) => c.status === 'verified' && (!c.expiresAt || c.expiresAt > t))) return 'verified';
  if (list.some((c) => c.status === 'pending')) return 'pending';
  if (list.some((c) => c.status === 'verified')) return 'expired';
  if (list.some((c) => c.status === 'rejected')) return 'rejected';
  return 'missing';
}

export function eligibility(user, res) {
  const checks = [];
  const r = res.requirements;
  const add = (key, label, status, detail, fix = null) => checks.push({ key, label, status, detail, fix });

  add('listing', 'Resource is open for booking', res.status === 'active' ? 'pass' : 'fail',
    res.status === 'active' ? 'Listed and active' : 'Temporarily unavailable (maintenance or paused by the owner)');

  if (user.status !== 'active') {
    add('account', 'Account in good standing', 'fail', 'Booking privileges are currently restricted', 'Contact the platform administrator to review your account');
  } else if ((user.strikes || 0) >= POLICY.strikeReviewThreshold) {
    add('account', 'Account in good standing', 'warn', `${user.strikes} confirmed strikes — every request will be reviewed by staff`);
  } else {
    add('account', 'Account in good standing', 'pass', `${user.strikes || 0} confirmed strike(s)`);
  }

  add('identity', 'Identity verified', user.verified ? 'pass' : 'fail',
    user.verified ? `Verified via ${user.verifiedVia}` : 'Your identity has not been verified yet',
    user.verified ? null : 'An administrator must verify your ID before you can book (Profile → Verification)');

  const affOk = r.affiliations.includes(user.affiliation);
  add('affiliation', 'Eligible user group', affOk ? 'pass' : 'fail',
    affOk ? `Open to ${r.affiliations.map((a) => AFFILIATIONS[a]).join(', ')}` : `Only open to: ${r.affiliations.map((a) => AFFILIATIONS[a]).join(', ')}`);

  for (const t of r.credentials) {
    const st = credStatus(user, t);
    const ct = CRED_TYPES[t];
    const map = {
      verified: ['pass', 'Verified training record on file'],
      pending: ['warn', 'Submitted and awaiting staff verification. You can request now; approval waits for verification.'],
      expired: ['fail', 'Your training has expired'],
      rejected: ['fail', 'Your last submission was rejected by staff'],
      missing: ['fail', 'No training record on file'],
    };
    add(`cred:${t}`, `Training: ${ct.name}`, map[st][0], map[st][1],
      ['verified', 'pending'].includes(st) ? null : `Complete "${ct.name}" with ${ct.issuer}, then add the certificate in Profile → Training records`);
  }
  if (r.supervision) add('supervision', 'Staff supervision on site', 'info', 'A staff member must sign off your check-in before you operate the equipment');
  if (r.deposit) add('deposit', 'Refundable deposit', 'info', `₹${r.deposit.toLocaleString('en-IN')} is held on your institutional account and released after the return inspection`);

  const fails = checks.filter((c) => c.status === 'fail');
  return {
    checks,
    eligible: fails.length === 0,
    pendingCredential: checks.some((c) => c.key.startsWith('cred:') && c.status === 'warn'),
    summary: fails.length ? 'not_eligible' : checks.some((c) => c.status === 'warn') ? 'conditional' : 'eligible',
  };
}

// ---------- Slot rules (time, duration, fair use) ----------

const is247 = (a) => a.days.length === 7 && a.open === '00:00' && a.close === '24:00';

function pointOpen(res, ms) {
  const a = res.availability;
  const z = zoned(ms);
  const m = z.hh * 60 + z.mm;
  return a.days.includes(z.dow) && m >= minutesOf(a.open) && m <= minutesOf(a.close);
}

export function hoursCheck(res, start, end) {
  const a = res.availability;
  if (is247(a)) return { ok: true, detail: 'Available 24/7' };
  if (res.loan) {
    const ok = pointOpen(res, start) && pointOpen(res, end);
    return { ok, detail: ok ? 'Pick-up and return fall within desk hours' : `Pick-up and return must both be within desk hours (${a.open}–${a.close})` };
  }
  const s = zoned(start);
  const e = zoned(end - 1);
  if (s.date !== e.date) return { ok: false, detail: 'Bookings must start and end on the same day' };
  if (!a.days.includes(s.dow)) return { ok: false, detail: 'The resource is closed on that day' };
  const sm = s.hh * 60 + s.mm;
  const em = sm + (end - start) / MIN;
  const ok = sm >= minutesOf(a.open) && em <= minutesOf(a.close);
  return { ok, detail: ok ? `Within opening hours (${a.open}–${a.close})` : `Outside opening hours (${a.open}–${a.close})` };
}

export function weekStart(ms) {
  const z = zoned(ms);
  return wallToMs(z.date, '00:00') - ((z.dow + 6) % 7) * DAY;
}

export function slotChecks(user, res, start, end, excludeId = null) {
  const r = res.requirements;
  const t = now();
  if (!(end > start)) return [{ key: 'range', label: 'Valid time range', status: 'fail', detail: 'End time must be after start time' }];
  const checks = [];
  const add = (key, label, ok, detail, fix = null) => checks.push({ key, label, status: ok ? 'pass' : 'fail', detail, fix: ok ? null : fix });
  const dur = (end - start) / H;

  const hc = hoursCheck(res, start, end);
  add('hours', 'Within availability', hc.ok, hc.detail, 'Choose a time inside the opening hours shown on the calendar');
  add('duration', `Duration up to ${r.maxHours} h`, dur <= r.maxHours, `${fmtH(dur)} requested`, `Shorten the booking to ${r.maxHours} h or less`);
  if (start < t - 5 * MIN) {
    add('lead', 'Start time in the future', false, 'The start time has already passed', 'Pick a later start time');
  } else {
    const lead = (start - t) / H;
    add('lead', r.minLeadHours ? `At least ${r.minLeadHours} h notice` : 'Notice period', lead >= r.minLeadHours,
      r.minLeadHours ? `${fmtH(Math.max(0, lead))} notice given (staff need time to arrange supervision)` : 'No minimum notice required',
      `Book at least ${r.minLeadHours} h ahead`);
  }
  add('advance', `Within the ${r.maxAdvanceDays}-day booking window`, start <= t + r.maxAdvanceDays * DAY,
    'Prevents block-booking far into the future', `Pick a date within ${r.maxAdvanceDays} days`);

  const ws = weekStart(start);
  const used = D().bookings
    .filter((b) => b.userId === user.id && b.resourceId === res.id && b.id !== excludeId
      && ['pending', ...USED].includes(b.status) && b.start >= ws && b.start < ws + 7 * DAY)
    .reduce((s, b) => s + hoursOf(b), 0);
  add('weekly', `Weekly fair-use cap: ${r.weeklyCapHours} h per person`, used + dur <= r.weeklyCapHours,
    `${fmtH(used)} already booked or requested this week + ${fmtH(dur)} now`, 'Pick a slot in another week or shorten your booking');

  const active = D().bookings.filter((b) => b.userId === user.id && b.id !== excludeId && OPEN.includes(b.status) && b.end > t).length;
  add('active', `At most ${POLICY.maxActiveBookings} open requests per person`, active < POLICY.maxActiveBookings,
    `You have ${active} open request(s) or upcoming booking(s) across LabLend`, 'Cancel a request you no longer need');

  if (res.highDemand) {
    const up = D().bookings.filter((b) => b.userId === user.id && b.resourceId === res.id && b.id !== excludeId
      && ['pending', 'approved'].includes(b.status) && b.end > t);
    add('highdemand', 'High-demand: one upcoming booking at a time', up.length === 0,
      up.length ? `You already hold ${up[0].ref} for this resource` : 'No other upcoming booking for this resource',
      'Use or cancel your existing booking before requesting another');
  }
  return checks;
}

export function conflicts(res, start, end, excludeId = null) {
  const list = D().bookings.filter((b) => b.resourceId === res.id && b.id !== excludeId && overlaps(start, end, b.start, b.end));
  return { held: list.filter((b) => HOLD.includes(b.status)), pending: list.filter((b) => b.status === 'pending') };
}

// ---------- Transparent priority score for competing requests ----------

export function priority(user, res, purposeCategory) {
  const t = now();
  const recent = D().bookings
    .filter((b) => b.userId === user.id && b.resourceId === res.id && USED.includes(b.status) && b.start > t - 30 * DAY && b.start < t + 30 * DAY)
    .reduce((s, b) => s + hoursOf(b), 0);
  const breakdown = [{ label: 'Base score', points: 50 }];
  breakdown.push({ label: `Recent use of this resource (${fmtH(recent)} in the last/next 30 days)`, points: -Math.min(POLICY.usagePenaltyCap, Math.round(recent * POLICY.usagePenaltyPerHour)) });
  const ever = D().bookings.some((b) => b.userId === user.id && b.resourceId === res.id && ['returned', 'completed'].includes(b.status));
  if (!ever) breakdown.push({ label: 'First time using this resource', points: POLICY.firstTimeBonus });
  const p = PURPOSES[purposeCategory] || PURPOSES.personal;
  breakdown.push({ label: `Purpose: ${p.label}`, points: p.points });
  if (user.strikes) breakdown.push({ label: `Confirmed strikes (${user.strikes})`, points: -POLICY.strikePenalty * user.strikes });
  return { score: breakdown.reduce((s, b) => s + b.points, 0), breakdown };
}

function waitlistQueue(res, start, end, excludeId = null) {
  return D().bookings
    .filter((b) => b.resourceId === res.id && b.status === 'waitlisted' && b.id !== excludeId && overlaps(start, end, b.start, b.end))
    .sort((a, b) => b.evaluation.priority.score - a.evaluation.priority.score || a.createdAt - b.createdAt);
}

export function waitlistPosition(b) {
  const res = getRes(b.resourceId);
  const q = waitlistQueue(res, b.start, b.end);
  const i = q.findIndex((x) => x.id === b.id);
  return i < 0 ? null : i + 1;
}

export function suggestSlots(user, res, start, end, excludeId = null) {
  const dur = Math.max(30 * MIN, Math.min(end - start, res.requirements.maxHours * H));
  const t = now();
  const step = 30 * MIN;
  let cursor = Math.max(t + res.requirements.minLeadHours * H, start - 6 * H);
  cursor = Math.ceil(cursor / step) * step;
  const limit = Math.min(cursor + 8 * DAY, t + res.requirements.maxAdvanceDays * DAY);
  const out = [];
  for (; cursor < limit && out.length < 4; cursor += step) {
    const s = cursor; const e = cursor + dur;
    if (!hoursCheck(res, s, e).ok) continue;
    const c = conflicts(res, s, e, excludeId);
    if (c.held.length || c.pending.length) continue;
    if (out.some((o) => overlaps(o.start, o.end, s, e))) continue;
    out.push({ start: s, end: e, label: `${fmt(s)} – ${zoned(e).time}` });
  }
  return out;
}

// ---------- Pre-check: what will happen if I request this slot, and why ----------

export function evaluate(user, res, { start, end, purposeCategory = 'personal', excludeId = null }) {
  const el = eligibility(user, res);
  const slot = slotChecks(user, res, start, end, excludeId);
  const checks = [...el.checks, ...slot];
  const { held, pending } = conflicts(res, start, end, excludeId);
  const pr = priority(user, res, purposeCategory);
  const blocked = checks.some((c) => c.status === 'fail');
  let outcome; let explanation;

  if (blocked) {
    outcome = 'blocked';
    explanation = 'Some requirements are not met yet. Each failed check below says how to fix it.';
  } else if (held.length) {
    outcome = 'waitlist';
    explanation = 'This time overlaps a confirmed booking. You can join the waitlist: if that booking is cancelled or becomes a no-show, the waiting request with the highest priority score is promoted automatically. Or pick one of the free slots below.';
  } else {
    const reasons = [];
    if (res.approvalMode === 'manual') reasons.push('the owner reviews every request for this resource');
    if (el.pendingCredential) reasons.push('your training record is still being verified');
    if (res.requirements.reviewAffiliations?.includes(user.affiliation)) reasons.push(`requests from ${AFFILIATIONS[user.affiliation].toLowerCase()}s need institutional approval`);
    if ((user.strikes || 0) >= POLICY.strikeReviewThreshold) reasons.push('your account has strikes that need a staff review');
    if (pending.length) reasons.push(`${pending.length} other request(s) want an overlapping time, so staff compare priority scores`);
    if (reasons.length) {
      outcome = 'review';
      explanation = `This request goes to staff review because ${reasons.join('; ')}.`;
    } else {
      outcome = 'auto_approve';
      explanation = 'All checks pass and the owner allows instant approval for this resource, so the booking is confirmed immediately.';
    }
  }
  const slotOnlyFail = blocked && el.eligible;
  return {
    start, end, checks, outcome, explanation, priority: pr,
    conflicts: held.map((b) => ({ start: b.start, end: b.end })),
    contested: pending.length,
    waitlistPosition: outcome === 'waitlist' ? waitlistQueue(res, start, end).filter((b) => b.evaluation.priority.score >= pr.score).length + 1 : null,
    alternatives: outcome === 'waitlist' || slotOnlyFail ? suggestSlots(user, res, start, end, excludeId) : [],
  };
}

export function parseSlot(body) {
  const start = wallToMs(body.startDate, body.startTime);
  const end = wallToMs(body.endDate || body.startDate, body.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new HttpError(400, 'Please choose a valid date and time');
  return { start, end };
}

// ---------- Booking lifecycle ----------

export function createBooking(user, body) {
  const res = getRes(body.resourceId);
  if (!res) throw new HttpError(404, 'Resource not found');
  const { start, end } = parseSlot(body);
  const purpose = String(body.purpose || '').trim();
  if (purpose.length < 10) throw new HttpError(400, 'Please describe what you will use the resource for (at least 10 characters)');
  if (purpose.length > 600) throw new HttpError(400, 'Purpose is too long (600 characters max)');
  const purposeCategory = PURPOSES[body.purposeCategory] ? body.purposeCategory : 'personal';
  const attendees = Math.max(1, Math.min(500, parseInt(body.attendees, 10) || 1));
  if (res.capacity && attendees > res.capacity) throw new HttpError(400, `This resource fits at most ${res.capacity} people`);
  if (!body.acceptRules) throw new HttpError(400, 'Please confirm you have read the usage rules');

  const ev = evaluate(user, res, { start, end, purposeCategory });
  if (ev.outcome === 'blocked') throw new HttpError(422, 'This request does not meet the requirements yet', { evaluation: ev });
  if (ev.outcome === 'waitlist' && !body.joinWaitlist) throw new HttpError(409, 'That slot is already booked', { evaluation: ev });

  const t = now();
  const b = {
    id: uid('bk'), ref: nextRef('LL', D().bookings), resourceId: res.id, userId: user.id,
    start, end, purpose, purposeCategory, attendees, createdAt: t,
    status: 'pending',
    evaluation: { checks: ev.checks, outcome: ev.outcome, explanation: ev.explanation, priority: ev.priority, contested: ev.contested },
    decision: null,
    deposit: res.requirements.deposit ? { amount: res.requirements.deposit, status: 'not_held' } : null,
    extensions: [], checkIn: null, checkOut: null, inspection: null, flags: {},
  };
  D().bookings.push(b);
  const when = `${fmt(start)}–${zoned(end).time}`;
  log(user, 'booking.requested', 'booking', b.id, `${user.name} requested ${res.name} for ${when}`,
    { ref: b.ref, resourceId: res.id, outcome: ev.outcome, priorityScore: ev.priority.score, purposeCategory });

  if (ev.outcome === 'auto_approve') {
    b.status = 'approved';
    b.decision = { action: 'approved', by: SYSTEM.id, byName: 'Instant-approval policy', at: t, reason: 'All eligibility and fair-use checks passed and the owner allows instant approval for this resource.' };
    if (b.deposit) b.deposit.status = 'held';
    log(SYSTEM, 'booking.auto_approved', 'booking', b.id, `${b.ref} auto-approved under the owner's instant-approval policy`, { ref: b.ref, checksPassed: ev.checks.filter((c) => c.status === 'pass').length });
    notify(user.id, `Confirmed: ${res.name}`, `${when}. Check in from ${POLICY.checkInEarlyMin} min before the start.`, `#/booking/${b.id}`, 'success');
  } else if (ev.outcome === 'waitlist') {
    b.status = 'waitlisted';
    b.decision = { action: 'waitlisted', by: SYSTEM.id, byName: 'Waitlist rules', at: t, reason: `The slot overlaps a confirmed booking. You are #${ev.waitlistPosition} for this time and will be promoted automatically if it frees up.` };
    log(SYSTEM, 'booking.waitlisted', 'booking', b.id, `${b.ref} placed on the waitlist (position ${ev.waitlistPosition})`, { ref: b.ref, position: ev.waitlistPosition });
    notify(user.id, `Waitlisted: ${res.name}`, `You are #${ev.waitlistPosition} for ${when}. We'll tell you if the slot opens up.`, `#/booking/${b.id}`, 'warn');
  } else {
    notify(user.id, `Request sent: ${res.name}`, `${when}. ${ev.explanation}`, `#/booking/${b.id}`);
    notifyMany(managersOf(res), `New request to review: ${res.name}`, `${user.name} · ${when}${ev.contested ? ` · competes with ${ev.contested} other request(s)` : ''}`, `#/booking/${b.id}`);
  }
  save();
  return b;
}

export function decide(actor, b, { decision, reason }) {
  const res = getRes(b.resourceId);
  if (!canManage(actor, res)) throw new HttpError(403, 'Only the owner or an authorised manager of this resource can decide');
  reason = String(reason || '').trim();
  const t = now();
  const user = getUser(b.userId);
  const when = `${fmt(b.start)}–${zoned(b.end).time}`;
  if (decision !== 'approve' && reason.length < 5) throw new HttpError(400, 'Please give the requester a clear reason (at least 5 characters)');

  if (decision === 'approve') {
    if (!['pending', 'waitlisted'].includes(b.status)) throw new HttpError(409, `Cannot approve a booking that is ${b.status}`);
    if (b.end < t) throw new HttpError(409, 'This slot has already passed');
    const el = eligibility(user, res);
    if (el.pendingCredential) throw new HttpError(409, 'Verify the requester\'s training record first (Manage → Verifications). Approval stays blocked until it is verified.');
    if (!el.eligible) throw new HttpError(409, `The requester no longer meets: ${el.checks.filter((c) => c.status === 'fail').map((c) => c.label).join(', ')}`);
    const { held } = conflicts(res, b.start, b.end, b.id);
    if (held.length) throw new HttpError(409, `Overlaps confirmed booking ${held[0].ref}. Keep it on the waitlist or ask the requester to pick another time.`);
    b.status = 'approved';
    b.decision = { action: 'approved', by: actor.id, byName: actor.name, at: t, reason: reason || 'Meets all requirements.' };
    if (b.deposit) b.deposit.status = 'held';
    log(actor, 'booking.approved', 'booking', b.id, `${actor.name} approved ${b.ref} for ${user.name}`, { ref: b.ref, reason: b.decision.reason, priorityScore: b.evaluation.priority.score });
    notify(user.id, `Approved: ${res.name}`, `${when}. ${b.decision.reason}`, `#/booking/${b.id}`, 'success');
    const rivals = D().bookings.filter((x) => x.resourceId === res.id && x.id !== b.id && x.status === 'pending' && overlaps(x.start, x.end, b.start, b.end));
    for (const o of rivals) {
      o.status = 'waitlisted';
      o.decision = {
        action: 'waitlisted', by: SYSTEM.id, byName: 'Allocation rules', at: t,
        reason: `An overlapping request (${b.ref}, priority score ${b.evaluation.priority.score}) was approved by ${actor.name}. Your request (score ${o.evaluation.priority.score}) is on the waitlist and will be promoted automatically if the slot frees up.`,
      };
      log(SYSTEM, 'booking.waitlisted', 'booking', o.id, `${o.ref} moved to waitlist after ${b.ref} was approved for the same time`, { ref: o.ref, displacedBy: b.ref });
      notify(o.userId, `Waitlisted: ${res.name}`, o.decision.reason, `#/booking/${o.id}`, 'warn');
    }
  } else if (decision === 'reject') {
    if (!['pending', 'waitlisted'].includes(b.status)) throw new HttpError(409, `Cannot reject a booking that is ${b.status}`);
    b.status = 'rejected';
    b.decision = { action: 'rejected', by: actor.id, byName: actor.name, at: t, reason };
    log(actor, 'booking.rejected', 'booking', b.id, `${actor.name} rejected ${b.ref}`, { ref: b.ref, reason });
    notify(user.id, `Not approved: ${res.name}`, reason, `#/booking/${b.id}`, 'danger');
  } else if (decision === 'waitlist') {
    if (b.status !== 'pending') throw new HttpError(409, 'Only pending requests can be moved to the waitlist');
    b.status = 'waitlisted';
    b.decision = { action: 'waitlisted', by: actor.id, byName: actor.name, at: t, reason };
    log(actor, 'booking.waitlisted', 'booking', b.id, `${actor.name} placed ${b.ref} on the waitlist`, { ref: b.ref, reason });
    notify(user.id, `Waitlisted: ${res.name}`, reason, `#/booking/${b.id}`, 'warn');
  } else {
    throw new HttpError(400, 'Unknown decision');
  }
  save();
  return b;
}

export function promoteWaitlist(res, start, end) {
  const t = now();
  for (const w of waitlistQueue(res, start, end)) {
    if (w.start <= t) continue;
    if (conflicts(res, w.start, w.end, w.id).held.length) continue;
    const user = getUser(w.userId);
    const el = eligibility(user, res);
    const auto = res.approvalMode === 'auto' && el.eligible && !el.pendingCredential
      && !res.requirements.reviewAffiliations?.includes(user.affiliation) && (user.strikes || 0) < POLICY.strikeReviewThreshold;
    w.status = auto ? 'approved' : 'pending';
    w.decision = auto
      ? { action: 'approved', by: SYSTEM.id, byName: 'Waitlist rules', at: t, reason: 'The slot freed up and you were the highest-priority waiting request, so you were promoted and confirmed automatically.' }
      : null;
    if (auto && w.deposit) w.deposit.status = 'held';
    w.flags.promotedAt = t;
    log(SYSTEM, 'booking.promoted', 'booking', w.id, `${w.ref} promoted from the waitlist${auto ? ' and auto-approved' : ' to staff review'}`, { ref: w.ref, priorityScore: w.evaluation.priority.score });
    notify(w.userId, `A slot opened up: ${res.name}`, auto ? `You're confirmed for ${fmt(w.start)}.` : `Your request for ${fmt(w.start)} is now with staff for review.`, `#/booking/${w.id}`, 'success');
    if (!auto) notifyMany(managersOf(res), `Promoted from waitlist: ${res.name}`, `${user.name} · ${fmt(w.start)} needs review`, `#/booking/${w.id}`);
  }
}

export function cancel(actor, b, { reason }) {
  const res = getRes(b.resourceId);
  const mine = actor.id === b.userId;
  if (!mine && !canManage(actor, res)) throw new HttpError(403, 'You cannot cancel this booking');
  if (!OPEN.includes(b.status)) throw new HttpError(409, `A ${b.status} booking cannot be cancelled`);
  reason = String(reason || '').trim();
  if (!mine && reason.length < 5) throw new HttpError(400, 'Staff cancellations need a reason for the user');
  const t = now();
  const wasHeld = b.status === 'approved';
  const late = mine && wasHeld && b.start - t < POLICY.lateCancelHours * H;
  b.status = 'cancelled';
  b.decision = { action: 'cancelled', by: actor.id, byName: actor.name, at: t, reason: reason || 'Cancelled by the requester' };
  if (b.deposit && b.deposit.status === 'held') b.deposit.status = 'released';
  if (late) b.flags.lateCancel = true;
  log(actor, 'booking.cancelled', 'booking', b.id, `${actor.name} cancelled ${b.ref}${late ? ' (late cancellation)' : ''}`, { ref: b.ref, reason: b.decision.reason, late });
  if (!mine) notify(b.userId, `Cancelled by staff: ${res.name}`, reason, `#/booking/${b.id}`, 'danger');
  else notifyMany(managersOf(res), `Cancelled: ${res.name}`, `${actor.name} cancelled ${b.ref} (${fmt(b.start)})`, `#/booking/${b.id}`);
  if (wasHeld) promoteWaitlist(res, b.start, b.end);
  save();
  return b;
}

function validateCondition(res, condition, photos) {
  if (!condition || typeof condition !== 'object') throw new HttpError(400, 'Please record the condition of every checklist item');
  const items = res.checklist.map((label, i) => {
    const c = condition[i] || condition[String(i)];
    if (!c || typeof c.ok !== 'boolean') throw new HttpError(400, `Please mark "${label}" as OK or as an issue`);
    const note = String(c.note || '').trim().slice(0, 300);
    if (!c.ok && note.length < 3) throw new HttpError(400, `Please describe the issue with "${label}"`);
    return { label, ok: c.ok, note };
  });
  const pics = (Array.isArray(photos) ? photos : []).slice(0, 3).filter((p) => typeof p === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p) && p.length < 900_000);
  return { items, photos: pics };
}

export function checkIn(actor, b, { condition, notes, photos }) {
  const res = getRes(b.resourceId);
  if (actor.id !== b.userId) throw new HttpError(403, 'Only the person who booked can check in');
  if (b.status !== 'approved') throw new HttpError(409, `You can only check in to an approved booking (this one is ${b.status})`);
  const t = now();
  if (t < b.start - POLICY.checkInEarlyMin * MIN) throw new HttpError(409, `Check-in opens ${POLICY.checkInEarlyMin} minutes before the start (${fmt(b.start)})`);
  if (t > b.end) throw new HttpError(409, 'This booking has already ended');
  const { items, photos: pics } = validateCondition(res, condition, photos);
  b.status = 'checked_in';
  b.checkIn = {
    at: t, by: actor.id, items, notes: String(notes || '').trim().slice(0, 600), photos: pics,
    supervisorRequired: !!res.requirements.supervision, supervisorSignoff: null,
  };
  const issues = items.filter((i) => !i.ok);
  log(actor, 'booking.checked_in', 'booking', b.id, `${actor.name} checked in to ${b.ref}${issues.length ? ` and reported ${issues.length} pre-existing issue(s)` : ' — all items OK'}`,
    { ref: b.ref, issues: issues.map((i) => `${i.label}: ${i.note}`), photos: pics.length });
  if (issues.length || res.requirements.supervision) {
    notifyMany(managersOf(res), res.requirements.supervision ? `Supervisor sign-off needed: ${res.name}` : `Pre-existing issues reported: ${res.name}`,
      `${actor.name} checked in to ${b.ref}.${issues.length ? ` Issues: ${issues.map((i) => i.label).join(', ')}` : ''}`, `#/booking/${b.id}`, issues.length ? 'warn' : 'info');
  }
  save();
  return b;
}

export function signoff(actor, b) {
  const res = getRes(b.resourceId);
  if (!canManage(actor, res)) throw new HttpError(403, 'Only staff for this resource can sign off supervision');
  if (b.status !== 'checked_in' || !b.checkIn?.supervisorRequired) throw new HttpError(409, 'No supervision sign-off is needed');
  if (b.checkIn.supervisorSignoff) throw new HttpError(409, 'Already signed off');
  b.checkIn.supervisorSignoff = { by: actor.id, byName: actor.name, at: now() };
  log(actor, 'booking.supervisor_signed', 'booking', b.id, `${actor.name} confirmed on-site supervision for ${b.ref}`, { ref: b.ref });
  notify(b.userId, `Supervisor confirmed: ${res.name}`, `${actor.name} signed off your session. You may operate the equipment.`, `#/booking/${b.id}`, 'success');
  save();
  return b;
}

export async function checkOut(actor, b, { condition, notes, photos }) {
  const res = getRes(b.resourceId);
  if (actor.id !== b.userId) throw new HttpError(403, 'Only the person who booked can record the return');
  if (b.status !== 'checked_in') throw new HttpError(409, 'This booking is not checked in');
  const { items, photos: pics } = validateCondition(res, condition, photos);
  const t = now();
  const lateMinutes = Math.max(0, Math.round((t - b.end) / MIN));
  const before = b.checkIn.items;
  const newIssues = items.filter((it, i) => !it.ok && before[i]?.ok).map((it) => `${it.label}: ${it.note}`);
  b.status = 'returned';
  b.checkOut = { at: t, by: actor.id, items, notes: String(notes || '').trim().slice(0, 600), photos: pics, lateMinutes, newIssues };
  log(actor, 'booking.returned', 'booking', b.id,
    `${actor.name} returned ${b.ref}${lateMinutes > 0 ? `, ${lateMinutes} min late` : ' on time'}${newIssues.length ? `, declaring ${newIssues.length} new issue(s)` : ''}`,
    { ref: b.ref, lateMinutes, newIssues });
  notifyMany(managersOf(res), `Return to inspect: ${res.name}`, `${actor.name} returned ${b.ref}${newIssues.length ? ` with ${newIssues.length} new issue(s)` : ''}.`, `#/booking/${b.id}`, newIssues.length ? 'warn' : 'info');
  if (newIssues.length) {
    await createIncident(actor, { bookingId: b.id, type: 'damage', severity: 'medium', description: `Declared at return: ${newIssues.join('; ')}. ${b.checkOut.notes}`.trim() }, 'user');
  }
  if (lateMinutes > POLICY.lateReturnGraceMin) {
    await createIncident(SYSTEM, { bookingId: b.id, type: 'delay', severity: lateMinutes > 120 ? 'medium' : 'low', description: `Returned ${lateMinutes} minutes after the booked end time (${fmt(b.end)}).` }, 'system');
  }
  save();
  return b;
}

export async function inspect(actor, b, { outcome, notes }) {
  const res = getRes(b.resourceId);
  if (!canManage(actor, res)) throw new HttpError(403, 'Only staff for this resource can inspect returns');
  if (b.status !== 'returned') throw new HttpError(409, 'There is no return waiting for inspection');
  notes = String(notes || '').trim().slice(0, 600);
  if (!['ok', 'issue'].includes(outcome)) throw new HttpError(400, 'Choose whether the item is OK or has an issue');
  if (outcome === 'issue' && notes.length < 5) throw new HttpError(400, 'Please describe the issue you found');
  const t = now();
  b.status = 'completed';
  b.inspection = { at: t, by: actor.id, byName: actor.name, outcome, notes };
  const openInc = D().incidents.find((i) => i.bookingId === b.id && i.type === 'damage' && !['resolved', 'closed'].includes(i.status));
  if (b.deposit) b.deposit.status = outcome === 'ok' && !openInc ? 'released' : 'held_pending_review';
  log(actor, 'booking.inspected', 'booking', b.id, `${actor.name} inspected the return of ${b.ref}: ${outcome === 'ok' ? 'accepted in good condition' : 'issue found'}`, { ref: b.ref, outcome, notes });
  notify(b.userId, outcome === 'ok' ? `Return accepted: ${res.name}` : `Issue found at inspection: ${res.name}`,
    outcome === 'ok' ? `Thanks! ${b.deposit ? (b.deposit.status === 'released' ? 'Your deposit has been released.' : 'Your deposit is held until the open incident is resolved.') : ''}` : `${notes} An incident has been opened; you can respond to it.`,
    `#/booking/${b.id}`, outcome === 'ok' ? 'success' : 'warn');
  if (outcome === 'issue' && !openInc) {
    await createIncident(actor, { bookingId: b.id, type: 'damage', severity: 'medium', description: `Found at return inspection: ${notes}` }, 'staff');
  }
  save();
  return b;
}

export function requestExtension(actor, b, { minutes, reason }) {
  const res = getRes(b.resourceId);
  if (actor.id !== b.userId) throw new HttpError(403, 'Only the booker can request an extension');
  if (!['approved', 'checked_in'].includes(b.status)) throw new HttpError(409, 'Only active bookings can be extended');
  if (b.extensions.some((e) => e.status === 'pending')) throw new HttpError(409, 'An extension request is already waiting for a decision');
  minutes = parseInt(minutes, 10);
  if (![15, 30, 60, 120].includes(minutes)) throw new HttpError(400, 'Choose 15, 30, 60 or 120 minutes');
  const newEnd = b.end + minutes * MIN;
  const user = getUser(b.userId);
  const checks = slotChecks(user, res, b.start, newEnd, b.id).filter((c) => ['hours', 'duration', 'weekly'].includes(c.key));
  const { held } = conflicts(res, b.end, newEnd, b.id);
  const ext = { id: uid('ext'), minutes, reason: String(reason || '').trim().slice(0, 300), requestedAt: now(), status: 'pending', decidedBy: null, note: '' };
  const fail = checks.find((c) => c.status === 'fail');
  if (held.length || fail) {
    ext.status = 'declined';
    ext.decidedBy = 'Rules engine';
    ext.note = held.length ? `Someone else has the resource from ${fmt(held[0].start)}, so the time cannot be extended.` : `${fail.label}: ${fail.detail}`;
  } else if (res.approvalMode === 'auto') {
    ext.status = 'approved';
    ext.decidedBy = 'Instant-approval policy';
    ext.note = 'No conflicts and within limits.';
    b.end = newEnd;
  }
  b.extensions.push(ext);
  log(actor, 'booking.extension_requested', 'booking', b.id, `${actor.name} asked to extend ${b.ref} by ${minutes} min — ${ext.status}`, { ref: b.ref, minutes, status: ext.status, note: ext.note });
  if (ext.status === 'pending') notifyMany(managersOf(res), `Extension request: ${res.name}`, `${actor.name} wants ${minutes} more minutes on ${b.ref}`, `#/booking/${b.id}`);
  else notify(b.userId, `Extension ${ext.status}: ${res.name}`, ext.note, `#/booking/${b.id}`, ext.status === 'approved' ? 'success' : 'warn');
  save();
  return b;
}

export function decideExtension(actor, b, { extId, approve, note }) {
  const res = getRes(b.resourceId);
  if (!canManage(actor, res)) throw new HttpError(403, 'Only staff can decide extensions');
  const ext = b.extensions.find((e) => e.id === extId && e.status === 'pending');
  if (!ext) throw new HttpError(404, 'No pending extension');
  note = String(note || '').trim();
  if (!approve && note.length < 5) throw new HttpError(400, 'Please give a reason');
  if (approve) {
    const newEnd = b.end + ext.minutes * MIN;
    if (conflicts(res, b.end, newEnd, b.id).held.length) throw new HttpError(409, 'Another confirmed booking now overlaps the extended time');
    b.end = newEnd;
  }
  ext.status = approve ? 'approved' : 'declined';
  ext.decidedBy = actor.name;
  ext.note = note || 'Approved';
  log(actor, 'booking.extension_decided', 'booking', b.id, `${actor.name} ${ext.status} a ${ext.minutes}-min extension for ${b.ref}`, { ref: b.ref, note: ext.note });
  notify(b.userId, `Extension ${ext.status}: ${res.name}`, ext.note, `#/booking/${b.id}`, approve ? 'success' : 'warn');
  save();
  return b;
}

// ---------- Incidents (damage, delay, no-show, safety, conflict) ----------

export const INCIDENT_TYPES = { damage: 'Damage', delay: 'Late return', no_show: 'No-show', safety: 'Safety concern', conflict: 'Scheduling conflict', other: 'Other' };
export const RESOLUTIONS = {
  no_action: 'No action needed',
  warning: 'Written warning',
  strike: 'Confirm a strike',
  deposit_deduction: 'Deduct from deposit',
  maintenance: 'Send resource for repair (pause bookings)',
};

export async function createIncident(actor, { bookingId, resourceId, type, severity, description, photos }, source = 'user') {
  const b = bookingId ? getBooking(bookingId) : null;
  const res = getRes(b ? b.resourceId : resourceId);
  if (!res) throw new HttpError(404, 'Resource not found');
  if (source === 'user' && actor.id !== SYSTEM.id) {
    const involved = b && b.userId === actor.id;
    if (!involved && !canManage(actor, res)) throw new HttpError(403, 'You can only report incidents for your own bookings or resources you manage');
  }
  if (!INCIDENT_TYPES[type]) throw new HttpError(400, 'Unknown incident type');
  description = String(description || '').trim();
  if (description.length < 10) throw new HttpError(400, 'Please describe what happened (at least 10 characters)');
  const inc = {
    id: uid('inc'), ref: nextRef('INC', D().incidents), bookingId: b?.id || null, resourceId: res.id,
    subjectUserId: b?.userId || null, reportedBy: actor.id, reportedByName: actor.name, source,
    type, severity: ['low', 'medium', 'high', 'critical'].includes(severity) ? severity : 'medium',
    description: description.slice(0, 1500),
    photos: (Array.isArray(photos) ? photos : []).filter((p) => typeof p === 'string' && p.startsWith('data:image/') && p.length < 900_000).slice(0, 3),
    createdAt: now(), status: 'open', thread: [], resolution: null,
    proposedAction: type === 'no_show' ? 'strike' : type === 'delay' ? 'warning' : null,
  };
  const ctx = {
    resourceName: res.name, resourceValue: res.value, bookingRef: b?.ref,
    preExisting: b?.checkIn?.items.filter((i) => !i.ok).map((i) => `${i.label}: ${i.note}`) || [],
    newIssues: b?.checkOut?.newIssues || [], lateMinutes: b?.checkOut?.lateMinutes || 0,
  };
  inc.ai = await summariseIncident(inc, ctx);
  D().incidents.push(inc);
  log(actor, 'incident.reported', 'incident', inc.id, `${INCIDENT_TYPES[type]} reported on ${res.name}${b ? ` (${b.ref})` : ''}`, { ref: inc.ref, bookingRef: b?.ref, type, severity: inc.severity, source });
  if (b) log(actor, 'booking.incident_linked', 'booking', b.id, `${inc.ref} (${INCIDENT_TYPES[type]}) linked to ${b.ref}`, { incident: inc.ref });
  notifyMany([...managersOf(res), ...(inc.severity === 'critical' || type === 'safety' ? admins() : [])], `${INCIDENT_TYPES[type]} reported: ${res.name}`, inc.ai.summary, `#/incident/${inc.id}`, 'warn');
  if (inc.subjectUserId && inc.subjectUserId !== actor.id) {
    notify(inc.subjectUserId, `Incident opened on your booking: ${res.name}`, `${INCIDENT_TYPES[type]} — you can add your side of the story.`, `#/incident/${inc.id}`, 'warn');
  }
  save();
  return inc;
}

export function resolveIncident(actor, inc, { action, notes, amount }) {
  const res = getRes(inc.resourceId);
  if (!canManage(actor, res)) throw new HttpError(403, 'Only staff for this resource or an admin can resolve incidents');
  if (!['open', 'disputed'].includes(inc.status)) throw new HttpError(409, 'This incident is already resolved');
  if (inc.status === 'disputed' && actor.role !== 'admin') throw new HttpError(403, 'A disputed decision must be reviewed by a platform administrator');
  if (!RESOLUTIONS[action]) throw new HttpError(400, 'Choose a resolution');
  notes = String(notes || '').trim();
  if (notes.length < 10) throw new HttpError(400, 'Explain the decision to the people involved (at least 10 characters)');
  const user = inc.subjectUserId ? getUser(inc.subjectUserId) : null;
  const b = inc.bookingId ? getBooking(inc.bookingId) : null;
  if (['strike', 'warning', 'deposit_deduction'].includes(action) && !user) throw new HttpError(400, 'This action needs a person linked to the incident');
  const t = now();
  const applied = [];
  // If an earlier decision is being revised (dispute), undo its penalty first.
  if (inc.resolution?.action === 'strike' && user) { user.strikes = Math.max(0, (user.strikes || 1) - 1); applied.push('Previous strike reversed'); }
  if (inc.resolution?.action === 'deposit_deduction' && b?.deposit) { b.deposit.status = 'released'; b.deposit.deducted = 0; applied.push('Previous deduction reversed'); }
  if (action === 'strike') { user.strikes = (user.strikes || 0) + 1; applied.push(`Strike recorded (${user.name} now has ${user.strikes})`); }
  if (action === 'deposit_deduction') {
    if (!b?.deposit) throw new HttpError(400, 'This booking had no deposit');
    const amt = Math.max(0, Math.min(b.deposit.amount, parseInt(amount, 10) || 0));
    if (!amt) throw new HttpError(400, 'Enter the amount to deduct');
    b.deposit.status = amt >= b.deposit.amount ? 'forfeited' : 'partially_released';
    b.deposit.deducted = amt;
    applied.push(`₹${amt} deducted from deposit`);
  } else if (b?.deposit && b.deposit.status === 'held_pending_review') {
    b.deposit.status = 'released'; applied.push('Deposit released');
  }
  if (action === 'maintenance') { res.status = 'maintenance'; applied.push(`${res.name} paused for repair`); }
  const wasDisputed = inc.status === 'disputed';
  inc.status = 'resolved';
  inc.resolution = { action, notes, by: actor.id, byName: actor.name, at: t, applied, reviewOfDispute: wasDisputed };
  log(actor, wasDisputed ? 'incident.dispute_reviewed' : 'incident.resolved', 'incident', inc.id, `${actor.name} resolved ${inc.ref}: ${RESOLUTIONS[action]}`, { ref: inc.ref, action, notes, applied });
  if (action === 'strike') log(actor, 'user.strike_added', 'user', user.id, `Strike confirmed for ${user.name} (${inc.ref})`, { incident: inc.ref, strikes: user.strikes });
  if (action === 'maintenance') log(actor, 'resource.paused', 'resource', res.id, `${res.name} paused for repair after ${inc.ref}`, { incident: inc.ref });
  if (user) notify(user.id, `Incident ${inc.ref} resolved: ${RESOLUTIONS[action]}`, `${notes}${wasDisputed ? '' : ' If you disagree you can dispute this decision; an administrator will review it.'}`, `#/incident/${inc.id}`, action === 'no_action' ? 'success' : 'warn');
  save();
  return inc;
}

export function respondIncident(actor, inc, { message, dispute }) {
  const res = getRes(inc.resourceId);
  const involved = actor.id === inc.subjectUserId || actor.id === inc.reportedBy;
  if (!involved && !canManage(actor, res)) throw new HttpError(403, 'You are not part of this incident');
  message = String(message || '').trim();
  if (message.length < 5) throw new HttpError(400, 'Please write a message');
  inc.thread.push({ by: actor.id, byName: actor.name, role: actor.role, at: now(), text: message.slice(0, 1000), dispute: !!dispute });
  if (dispute) {
    if (actor.id !== inc.subjectUserId) throw new HttpError(403, 'Only the affected person can dispute');
    if (inc.status !== 'resolved' || inc.resolution?.reviewOfDispute) throw new HttpError(409, 'Only a first decision can be disputed');
    inc.status = 'disputed';
    log(actor, 'incident.disputed', 'incident', inc.id, `${actor.name} disputed the decision on ${inc.ref}`, { ref: inc.ref });
    notifyMany(admins(), `Dispute to review: ${inc.ref}`, `${actor.name} disputes "${RESOLUTIONS[inc.resolution.action]}"`, `#/incident/${inc.id}`, 'warn');
  } else {
    log(actor, 'incident.commented', 'incident', inc.id, `${actor.name} added a statement to ${inc.ref}`, { ref: inc.ref });
  }
  save();
  return inc;
}

// ---------- Training records ----------

export function submitCredential(user, { type, certificateId, issuer, issuedDate, expiresDate, evidence }) {
  const ct = CRED_TYPES[type];
  if (!ct) throw new HttpError(400, 'Unknown training type');
  certificateId = String(certificateId || '').trim().toUpperCase();
  if (certificateId.length < 4) throw new HttpError(400, 'Enter the certificate ID');
  if (user.credentials.some((c) => c.type === type && c.status === 'pending')) throw new HttpError(409, 'You already have a submission waiting for review');
  const cred = {
    id: uid('cr'), type, certificateId, issuer: String(issuer || '').trim().slice(0, 80),
    issuedAt: issuedDate ? wallToMs(issuedDate, '12:00') : null,
    expiresAt: expiresDate ? wallToMs(expiresDate, '23:59') : null,
    evidence: String(evidence || '').trim().slice(0, 1000), submittedAt: now(), status: 'pending', review: null,
  };
  user.credentials.push(cred);
  log(user, 'credential.submitted', 'user', user.id, `${user.name} submitted "${ct.name}" for verification`, { credentialId: cred.id, type });
  const verifiers = D().users.filter((u) => u.role === 'admin' || (isStaff(u) && D().resources.some((r) => u.orgIds?.includes(r.orgId) && r.requirements.credentials.includes(type))));
  notifyMany(verifiers, `Training record to verify`, `${user.name} · ${ct.name}`, '#/manage/verifications');
  save();
  return cred;
}

export function canVerify(actor, type) {
  return actor.role === 'admin' || (isStaff(actor) && D().resources.some((r) => actor.orgIds?.includes(r.orgId) && r.requirements.credentials.includes(type)));
}

export async function credentialAssessment(user, cred) {
  const dup = D().users.find((u) => u.id !== user.id && u.credentials.some((c) => c.certificateId === cred.certificateId && c.status !== 'rejected'));
  return reviewCredential(cred, CRED_TYPES[cred.type], { now: now(), duplicateOf: dup ? dup.name : null });
}

export function reviewCredentialDecision(actor, user, cred, { approve, note }) {
  if (!canVerify(actor, cred.type)) throw new HttpError(403, 'You are not authorised to verify this training');
  if (cred.status !== 'pending') throw new HttpError(409, 'Already reviewed');
  note = String(note || '').trim();
  if (!approve && note.length < 5) throw new HttpError(400, 'Tell the person why it was rejected');
  const ct = CRED_TYPES[cred.type];
  cred.status = approve ? 'verified' : 'rejected';
  if (approve && !cred.expiresAt) cred.expiresAt = now() + ct.validityMonths * 30 * DAY;
  cred.review = { by: actor.id, byName: actor.name, at: now(), note: note || 'Verified against training register' };
  log(actor, approve ? 'credential.verified' : 'credential.rejected', 'user', user.id, `${actor.name} ${approve ? 'verified' : 'rejected'} "${ct.name}" for ${user.name}`, { credentialId: cred.id, note: cred.review.note });
  notify(user.id, `Training ${approve ? 'verified' : 'not accepted'}: ${ct.name}`, cred.review.note, '#/profile', approve ? 'success' : 'danger');
  save();
  return cred;
}

// ---------- Scheduler: reminders, no-shows, overdue returns, expiry ----------

export async function tick() {
  const t = now();
  let changed = false;
  for (const b of D().bookings) {
    const res = getRes(b.resourceId);
    if (b.status === 'approved' && !b.flags.reminded && b.start > t && b.start - t <= POLICY.reminderMin * MIN) {
      b.flags.reminded = true; changed = true;
      notify(b.userId, `Starting soon: ${res.name}`, `${fmt(b.start)} at ${res.location}. Remember to record the condition at check-in.`, `#/booking/${b.id}`);
    }
    if (b.status === 'approved' && t > b.start + POLICY.noShowGraceMin * MIN) {
      b.status = 'no_show'; changed = true;
      if (b.deposit?.status === 'held') b.deposit.status = 'released';
      log(SYSTEM, 'booking.no_show_detected', 'booking', b.id, `${b.ref} marked as a no-show (no check-in within ${POLICY.noShowGraceMin} min)`, { ref: b.ref });
      notify(b.userId, `Missed booking: ${res.name}`, 'You did not check in. Staff will review whether a strike applies — you can explain what happened.', `#/booking/${b.id}`, 'danger');
      promoteWaitlist(res, b.start, b.end);
      await createIncident(SYSTEM, { bookingId: b.id, type: 'no_show', severity: 'low', description: `No check-in recorded within ${POLICY.noShowGraceMin} minutes of the ${fmt(b.start)} start. The slot was released to the waitlist.` }, 'system');
    }
    if (b.status === 'checked_in' && t > b.end && !b.flags.overdueNotified) {
      b.flags.overdueNotified = true; changed = true;
      log(SYSTEM, 'booking.overdue_detected', 'booking', b.id, `${b.ref} is overdue — not returned by ${fmt(b.end)}`, { ref: b.ref });
      notify(b.userId, `Overdue: please return ${res.name}`, `It was due back at ${fmt(b.end)}. Record the return as soon as possible.`, `#/booking/${b.id}`, 'danger');
      notifyMany(managersOf(res), `Overdue return: ${res.name}`, `${getUser(b.userId).name} has not returned ${b.ref} (due ${fmt(b.end)})`, `#/booking/${b.id}`, 'warn');
    }
    if (['pending', 'waitlisted'].includes(b.status) && t > b.start) {
      const was = b.status;
      b.status = 'expired'; changed = true;
      b.decision = { action: 'expired', by: SYSTEM.id, byName: 'Rules engine', at: t, reason: was === 'pending' ? 'The start time passed before staff reviewed the request.' : 'The slot did not free up before the start time.' };
      log(SYSTEM, 'booking.expired', 'booking', b.id, `${b.ref} expired (${was} when the start time passed)`, { ref: b.ref, was });
      notify(b.userId, `Request expired: ${res.name}`, b.decision.reason, `#/booking/${b.id}`);
    }
  }
  if (changed) save();
}

// ---------- Insights: utilisation, fairness, anomaly flags ----------

export function resourceStats(res, days = 30) {
  const t = now();
  const from = t - days * DAY;
  const a = res.availability;
  let available = 0;
  for (let d = 0; d < days; d++) {
    const z = zoned(from + d * DAY);
    if (a.days.includes(z.dow)) available += (minutesOf(a.close) - minutesOf(a.open)) / 60;
  }
  const bs = D().bookings.filter((b) => b.resourceId === res.id);
  const used = bs.filter((b) => [...USED, 'no_show'].includes(b.status) && b.end > from && b.start < t);
  const booked = used.filter((b) => b.status !== 'no_show').reduce((s, b) => s + (Math.min(b.end, t) - Math.max(b.start, from)) / H, 0);
  const community = used.filter((b) => b.status !== 'no_show' && getUser(b.userId)?.affiliation === 'community').reduce((s, b) => s + (Math.min(b.end, t) - Math.max(b.start, from)) / H, 0);
  const requests = bs.filter((b) => b.createdAt > from);
  const decided = requests.filter((b) => b.decision && b.decision.by !== SYSTEM.id && ['approved', 'rejected'].includes(b.decision.action));
  const avgDecisionH = decided.length ? decided.reduce((s, b) => s + (b.decision.at - b.createdAt) / H, 0) / decided.length : null;
  const users = new Set(used.map((b) => b.userId));
  const byUser = {};
  for (const b of used) byUser[b.userId] = (byUser[b.userId] || 0) + hoursOf(b);
  const topShare = booked ? Math.max(0, ...Object.values(byUser)) / Object.values(byUser).reduce((s, x) => s + x, 0) : 0;
  return {
    resourceId: res.id, name: res.name, availableHours: Math.round(available), bookedHours: Math.round(booked * 10) / 10,
    utilisation: available ? Math.round((booked / available) * 100) : 0,
    idleHours: Math.max(0, Math.round(available - booked)),
    communityHours: Math.round(community * 10) / 10,
    requests: requests.length,
    approved: requests.filter((b) => USED.includes(b.status) || b.decision?.action === 'approved').length,
    rejected: requests.filter((b) => b.status === 'rejected').length,
    waitlisted: bs.filter((b) => b.status === 'waitlisted').length,
    noShows: bs.filter((b) => b.status === 'no_show' && b.start > from).length,
    uniqueUsers: users.size,
    topUserShare: Math.round(topShare * 100),
    avgDecisionHours: avgDecisionH == null ? null : Math.round(avgDecisionH * 10) / 10,
  };
}

export function usageFlags(scopeOrgIds = null) {
  const t = now();
  const from = t - 30 * DAY;
  const flags = [];
  const inScope = (b) => !scopeOrgIds || scopeOrgIds.includes(getRes(b.resourceId)?.orgId);
  for (const u of D().users.filter((x) => x.role === 'member')) {
    const mine = D().bookings.filter((b) => b.userId === u.id && inScope(b));
    const add = (kind, severity, evidence, suggestion) => flags.push({ userId: u.id, userName: u.name, kind, severity, evidence, suggestion });
    const lateCancels = mine.filter((b) => b.flags.lateCancel && b.createdAt > from);
    if (lateCancels.length >= 2) add('Repeated late cancellations', 'medium', `${lateCancels.length} cancellations within ${POLICY.lateCancelHours} h of the start in 30 days (${lateCancels.map((b) => b.ref).join(', ')})`, 'Talk to the user; consider a warning if slots are being held speculatively');
    const late = mine.filter((b) => b.checkOut?.lateMinutes > POLICY.lateReturnGraceMin && b.start > from);
    if (late.length >= 2) add('Repeated late returns', 'medium', `${late.length} late returns in 30 days (${late.map((b) => `${b.ref}: ${b.checkOut.lateMinutes} min`).join(', ')})`, 'Review the linked delay incidents together');
    const noShows = mine.filter((b) => b.status === 'no_show' && b.start > from);
    if (noShows.length) add('No-shows', noShows.length > 1 ? 'medium' : 'low', `${noShows.length} missed booking(s): ${noShows.map((b) => b.ref).join(', ')}`, 'Confirm or waive the proposed strikes in Incidents');
    const open = mine.filter((b) => ['pending', 'waitlisted'].includes(b.status));
    if (open.length >= 3) add('Many simultaneous requests', 'low', `${open.length} pending or waitlisted requests at once`, 'Possible speculative booking; the platform cap is ' + POLICY.maxActiveBookings);
    for (const c of u.credentials.filter((x) => x.status !== 'rejected')) {
      const other = D().users.find((o) => o.id !== u.id && o.credentials.some((x) => x.certificateId === c.certificateId && x.status !== 'rejected'));
      if (other && !scopeOrgIds) add('Shared certificate ID', 'high', `Certificate ${c.certificateId} (${CRED_TYPES[c.type].name}) is also on file for ${other.name}`, 'Check the training register before verifying either record');
    }
    if (!u.verified && mine.length) add('Unverified identity with requests', 'low', 'Has requests on file but identity is not verified', 'Verify identity in Admin → People');
  }
  for (const res of D().resources.filter((r) => r.highDemand && (!scopeOrgIds || scopeOrgIds.includes(r.orgId)))) {
    const used = D().bookings.filter((b) => b.resourceId === res.id && [...USED].includes(b.status) && b.start > t - 14 * DAY && b.start < t + 14 * DAY);
    const total = used.reduce((s, b) => s + hoursOf(b), 0);
    const byUser = {};
    for (const b of used) byUser[b.userId] = (byUser[b.userId] || 0) + hoursOf(b);
    for (const [uidv, h] of Object.entries(byUser)) {
      if (total >= 4 && h / total >= 0.5) {
        const u = getUser(uidv);
        flags.push({ userId: uidv, userName: u.name, kind: 'Dominant share of a high-demand resource', severity: 'medium', evidence: `${Math.round((h / total) * 100)}% of ${res.name} hours (${fmtH(h)} of ${fmtH(total)}) in a 4-week window`, suggestion: 'The priority score already lowers this user in contested slots; consider tightening the weekly cap' });
      }
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}
