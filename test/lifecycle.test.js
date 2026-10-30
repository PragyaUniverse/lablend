// End-to-end tests of the resource-sharing lifecycle against a real server and a throwaway database.
// Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const PORT = 3600 + Math.floor(Math.random() * 300);
const B = `http://localhost:${PORT}/api`;
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lablend-')), 'db.json');
let server;

before(async () => {
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DB_FILE, ANTHROPIC_API_KEY: '' }, stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${B}/meta`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => server?.kill());

async function as(email) {
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'demo1234' }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (method, p, body) => {
    const res = await fetch(B + p, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  };
}
const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

test('full journey: request → contested review → check-in → return → inspection → history', async () => {
  const aisha = await as('aisha@northfield.edu');
  const sam = await as('sameer@northfield.edu');
  const slot = { resourceId: 'r_laser', startDate: day(1), startTime: '14:00', endTime: '16:00', purposeCategory: 'coursework' };

  const pre = await aisha('POST', '/bookings/precheck', slot);
  assert.equal(pre.evaluation.outcome, 'review');
  assert.ok(pre.evaluation.contested >= 1, 'seeded rivals compete for this slot');

  const { booking } = await aisha('POST', '/bookings', { ...slot, purpose: 'Cutting diffuser panels for my thesis lamp', acceptRules: true });
  assert.equal(booking.status, 'pending');

  const q = await sam('GET', '/manage/queue');
  const group = q.groups.find((g) => g.items.some((b) => b.id === booking.id));
  assert.ok(group.contested);
  const scores = group.items.map((b) => b.livePriority.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'queue is ranked by priority score');

  const approved = await sam('POST', `/bookings/${booking.id}/decision`, { decision: 'approve', reason: 'Free slot' });
  assert.equal(approved.booking.status, 'approved');
  const after = await sam('GET', '/manage/queue');
  const rivals = after.groups.flatMap((g) => g.items).filter((b) => b.resource.id === 'r_laser');
  assert.ok(rivals.every((b) => b.status === 'waitlisted' && /was approved/.test(b.decision.reason)), 'rivals waitlisted with an explanation');

  // Too early to check in
  const early = await aisha('POST', `/bookings/${booking.id}/checkin`, { condition: {} });
  assert.equal(early.status, 409);

  // Jump the demo clock to the start, then check in / return
  await aisha('POST', '/demo/clock', { to: booking.start + 60_000 });
  const all = (ok) => Object.fromEntries([0, 1, 2, 3, 4].map((i) => [i, { ok, note: ok ? '' : 'scratch' }]));
  const ci = await aisha('POST', `/bookings/${booking.id}/checkin`, { condition: all(true) });
  assert.equal(ci.booking.status, 'checked_in');
  const cond = all(true); cond[1] = { ok: false, note: 'Honeycomb bed bent in one corner' };
  const co = await aisha('POST', `/bookings/${booking.id}/checkout`, { condition: cond });
  assert.equal(co.booking.status, 'returned');
  assert.equal(co.booking.checkOut.newIssues.length, 1);
  assert.ok(co.booking.incidents.some((i) => i.type === 'damage'), 'damage incident opened automatically');

  const insp = await sam('POST', `/bookings/${booking.id}/inspect`, { outcome: 'issue', notes: 'Confirmed the bent corner' });
  assert.equal(insp.booking.status, 'completed');

  const detail = await aisha('GET', `/bookings/${booking.id}`);
  const actions = detail.timeline.map((e) => e.action);
  for (const a of ['booking.requested', 'booking.approved', 'booking.checked_in', 'booking.returned', 'booking.inspected']) assert.ok(actions.includes(a), `timeline has ${a}`);
  await aisha('POST', '/demo/clock', { reset: true });
});

test('eligibility: missing training and unverified identity are blocked with a fix', async () => {
  const aisha = await as('aisha@northfield.edu');
  const r = await aisha('POST', '/bookings/precheck', { resourceId: 'r_cnc', startDate: day(3), startTime: '10:00', endTime: '11:00' });
  const cred = r.evaluation.checks.find((c) => c.key === 'cred:cnc-l2');
  assert.equal(cred.status, 'fail');
  assert.match(cred.fix, /CNC Machining Level 2/);
  const jordan = await as('ishaan@gmail.example');
  const j = await jordan('POST', '/bookings', { resourceId: 'r_bench', startDate: day(2), startTime: '11:00', endTime: '12:00', purpose: 'Repairing a chair leg', acceptRules: true });
  assert.equal(j.status, 422);
});

test('approval is blocked until a pending training record is verified by a person', async () => {
  const leo = await as('arjun@northfield.edu');
  const sam = await as('sameer@northfield.edu');
  const r = await leo('POST', '/bookings', { resourceId: 'r_laser', startDate: day(3), startTime: '10:00', endTime: '11:00', purpose: 'Cutting a stencil for the club', purposeCategory: 'coursework', acceptRules: true });
  assert.equal(r.booking.status, 'pending');
  const d = await sam('POST', `/bookings/${r.booking.id}/decision`, { decision: 'approve' });
  assert.equal(d.status, 409);
  const v = await sam('GET', '/manage/verifications');
  const leoCred = v.items.find((x) => x.user.id === 'u_leo');
  assert.equal(leoCred.assessment.recommendation, 'likely_invalid', 'duplicate certificate ID is flagged');
});

test('fair use: high-demand resources allow one upcoming booking per person', async () => {
  // Aisha holds an upcoming Podcast Studio booking in the seed data, so a second one is refused.
  const aisha = await as('aisha@northfield.edu');
  const r = await aisha('POST', '/bookings/precheck', { resourceId: 'r_studio', startDate: day(5), startTime: '10:00', endTime: '11:00' });
  assert.equal(r.evaluation.checks.find((c) => c.key === 'highdemand').status, 'fail');
});

test('privacy and role-based access', async () => {
  const aisha = await as('aisha@northfield.edu');
  assert.equal((await aisha('GET', '/manage/queue')).status, 403);
  assert.equal((await aisha('GET', '/admin/users')).status, 403);
  const cal = await aisha('GET', '/resources/r_laser/calendar');
  assert.ok(!JSON.stringify(cal).includes('Rohan'), 'other users are anonymised on the calendar');
  const sam = await as('sameer@northfield.edu');
  assert.equal((await sam('POST', '/resources', { name: 'x' })).status, 403, 'managers cannot create listings');
  const r = await fetch(`${B}/bookings`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415, 'non-JSON writes rejected (CSRF hardening)');
});

test('disputes escalate to an admin, who can reverse a penalty', async () => {
  const grace = await as('kavya@northfield.edu');
  const sam = await as('sameer@northfield.edu');
  const priya = await as('priya@northfield.edu');
  const inc = (await sam('GET', '/incidents')).incidents.find((i) => i.subjectUserId === 'u_grace' && i.status === 'open');
  const res = await sam('POST', `/incidents/${inc.id}/resolve`, { action: 'deposit_deduction', amount: 500, notes: 'Collet replacement cost' });
  assert.equal(res.incident.status, 'resolved');
  const d = await grace('POST', `/incidents/${inc.id}/respond`, { message: 'It was already worn', dispute: true });
  assert.equal(d.incident.status, 'disputed');
  assert.equal((await sam('POST', `/incidents/${inc.id}/resolve`, { action: 'no_action', notes: 'manager override attempt' })).status, 403);
  const final = await priya('POST', `/incidents/${inc.id}/resolve`, { action: 'no_action', notes: 'Maintenance log shows wear; deduction reversed.' });
  assert.ok(final.incident.resolution.applied.some((x) => /reversed/.test(x)));
});

test('time rules: no-shows propose (not apply) a strike; audit chain stays intact', async () => {
  const aisha = await as('aisha@northfield.edu');
  const daniel = await as('anand@northfield.edu');
  const before = (await aisha('GET', '/me')).user.strikes;
  await aisha('POST', '/demo/clock', { minutes: 60 * 48 });
  const inc = (await daniel('GET', '/incidents')).incidents.find((i) => i.type === 'no_show' && i.subjectUserId === 'u_aisha');
  assert.ok(inc, 'no-show incident created');
  assert.equal(inc.proposedAction, 'strike');
  assert.equal((await aisha('GET', '/me')).user.strikes, before, 'no strike until a person confirms');
  await aisha('POST', '/demo/clock', { reset: true });
  const priya = await as('priya@northfield.edu');
  const v = await priya('GET', '/audit/verify');
  assert.ok(v.ok && v.count > 50);
});
