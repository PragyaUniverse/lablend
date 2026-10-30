// Fictional demo data for "Northfield University" and a partner community makerspace.
// History is produced by running the real lifecycle functions at simulated past times,
// so every booking, incident, notification and audit entry is internally consistent.
import { store, hashPassword } from './db.js';
import { setClockOffset, zoned, wallToMs, dateAdd, now, DAY, H, MIN } from './time.js';
import { suspendAi } from './ai.js';
import * as L from './logic.js';

export const DEMO_PASSWORD = 'demo1234';

export const DEMO_ACCOUNTS = [
  { email: 'aisha@northfield.edu', role: 'member', persona: 'Student', blurb: 'Final-year design student. Laser + 3D printing trained; media training awaiting verification.' },
  { email: 'sameer@northfield.edu', role: 'manager', persona: 'Lab manager', blurb: 'FabLab & Physics technician. Reviews requests, signs off supervision, inspects returns.' },
  { email: 'meera@northfield.edu', role: 'owner', persona: 'Resource owner', blurb: 'Head of the FabLab. Lists equipment and sets the conditions for using it.' },
  { email: 'priya@northfield.edu', role: 'admin', persona: 'Platform admin', blurb: 'Verifies identities and organisations, reviews disputes, audits the activity chain.' },
  { email: 'anand@northfield.edu', role: 'owner', persona: 'Media & Library owner', blurb: 'Owns the Media Lab kit, podcast studio and library seminar rooms.' },
  { email: 'rohan@makers.community', role: 'member', persona: 'Community maker', blurb: 'Local maker from the partner collective. Heavy laser user; has a camera kit out (overdue).' },
  { email: 'kavya@northfield.edu', role: 'member', persona: 'Researcher', blurb: 'PhD researcher. CNC-trained; her last CNC session ended with a damage report.' },
  { email: 'arjun@northfield.edu', role: 'member', persona: 'Student (1 strike)', blurb: 'Missed a booking; submitted a laser certificate that duplicates another user\'s ID.' },
  { email: 'ishaan@gmail.example', role: 'member', persona: 'New community member', blurb: 'Just signed up — identity not yet verified, so cannot book.' },
  { email: 'farhan@makers.community', role: 'owner', persona: 'Makerspace owner', blurb: 'Runs the Northfield Makers Collective benches shared with students.' },
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

function resources(t0) {
  const base = { status: 'active', createdAt: t0 - 40 * DAY, highDemand: false, loan: false, capacity: null };
  const req = (o) => ({ credentials: [], affiliations: ['student', 'researcher', 'staff', 'community'], supervision: false, deposit: 0, minLeadHours: 0, maxHours: 4, weeklyCapHours: 8, maxAdvanceDays: 14, reviewAffiliations: [], ...o });
  return [
    {
      ...base, id: 'r_laser', orgId: 'org_fablab', createdBy: 'u_meera', name: 'Laser Cutter — Epilog Fusion 60W', icon: '🔆', category: 'equipment',
      description: 'CO₂ laser for cutting and engraving acrylic, plywood, MDF, card and leather up to 6 mm. Bed 600 × 400 mm. Fume extraction included.',
      location: 'Engineering Block A, FabLab (Room A-012)', building: 'Engineering Block A', value: 1800000, riskLevel: 'medium', approvalMode: 'manual', highDemand: true,
      tags: ['laser', 'engrave', 'acrylic', 'plywood', 'signage', 'prototype'],
      requirements: req({ credentials: ['laser-safety'], maxHours: 3, weeklyCapHours: 4 }),
      availability: { days: ALL_DAYS, open: '08:00', close: '22:00' },
      rules: ['Never leave the laser unattended while it is cutting', 'Only approved materials — no PVC, vinyl or polycarbonate', 'Run fume extraction during and for 5 minutes after every job', 'Clean the honeycomb bed and remove offcuts when you finish'],
      checklist: ['Lens and mirrors clean', 'Honeycomb bed clear and undamaged', 'Fume extractor running', 'Emergency stop tested', 'Air assist working'],
    },
    {
      ...base, id: 'r_printer', orgId: 'org_fablab', createdBy: 'u_meera', name: '3D Printer — Prusa MK4 (Print Farm #2)', icon: '🧊', category: 'equipment',
      description: 'FDM printer, 250 × 210 × 220 mm build volume, PLA/PETG. In the card-access print farm, available around the clock for long prints.',
      location: 'Engineering Block A, Print Farm (Room A-014)', building: 'Engineering Block A', value: 120000, riskLevel: 'low', approvalMode: 'auto',
      tags: ['print', '3d', 'prototype', 'pla', 'petg', 'enclosure'],
      requirements: req({ credentials: ['3dp-basics'], maxHours: 12, weeklyCapHours: 24, maxAdvanceDays: 7 }),
      availability: { days: ALL_DAYS, open: '00:00', close: '24:00' },
      rules: ['Use only filament from the farm shelf or labelled personal spools', 'Remove your print and purge waste within 1 hour of completion', 'Report clogs instead of disassembling the hot-end'],
      checklist: ['Build plate clean', 'Nozzle not clogged', 'Filament loaded and dry', 'No loose belts or parts'],
    },
    {
      ...base, id: 'r_cnc', orgId: 'org_fablab', createdBy: 'u_meera', name: 'CNC Router — ShopBot PRSalpha 4×8', icon: '🪚', category: 'equipment',
      description: 'Full-sheet CNC router for wood, plastics and soft aluminium. High-risk machine: always operated with a technician on site.',
      location: 'Engineering Block A, Heavy Workshop (A-020)', building: 'Engineering Block A', value: 2400000, riskLevel: 'high', approvalMode: 'manual',
      tags: ['cnc', 'mill', 'wood', 'furniture', 'aluminium'],
      requirements: req({ credentials: ['cnc-l2'], affiliations: ['student', 'researcher', 'staff'], supervision: true, deposit: 2000, minLeadHours: 24, maxHours: 4, weeklyCapHours: 6 }),
      availability: { days: WEEKDAYS, open: '09:00', close: '17:00' },
      rules: ['A technician must sign off before the spindle starts', 'Safety glasses and ear defenders at all times', 'Secure stock with clamps or screws — never by hand', 'Vacuum the bed and dust collector after use'],
      checklist: ['Spindle and collet', 'Bit inventory', 'Dust collector', 'Spoilboard surface', 'E-stop and guards'],
    },
    {
      ...base, id: 'r_camera', orgId: 'org_media', createdBy: 'u_daniel', name: 'Sony A7 IV Cinema Kit', icon: '🎥', category: 'equipment', loan: true,
      description: 'Full-frame mirrorless camera with 24–70 mm f/2.8 lens, 2 batteries, 2 SD cards, Rode shotgun mic and hard case. Borrow and take away.',
      location: 'School of Media, Equipment Desk (M-101)', building: 'School of Media', value: 350000, riskLevel: 'medium', approvalMode: 'manual',
      tags: ['camera', 'video', 'film', 'photo', 'documentary', 'interview'],
      requirements: req({ credentials: ['media-handling'], deposit: 5000, maxHours: 72, weeklyCapHours: 72, maxAdvanceDays: 21 }),
      availability: { days: ALL_DAYS, open: '09:00', close: '19:00' },
      rules: ['Pick-up and return in person at the equipment desk', 'Keep the kit in its case when travelling', 'Do not lend the kit to anyone else', 'Report any drop or water exposure immediately'],
      checklist: ['Body and sensor clean', 'Two batteries, charged', '24–70 mm lens free of scratches', 'Two SD cards present', 'Rode mic and cables', 'Case and strap intact'],
    },
    {
      ...base, id: 'r_studio', orgId: 'org_media', createdBy: 'u_daniel', name: 'Podcast Studio', icon: '🎙️', category: 'space', capacity: 4,
      description: 'Acoustically treated room with 4 broadcast mics, a Rodecaster mixer and headphones. Ideal for podcasts, interviews and voice-overs.',
      location: 'School of Media, Studio 3 (M-210)', building: 'School of Media', value: 400000, riskLevel: 'low', approvalMode: 'auto', highDemand: true,
      tags: ['podcast', 'audio', 'recording', 'interview', 'voice'],
      requirements: req({ maxHours: 2, weeklyCapHours: 4 }),
      availability: { days: [1, 2, 3, 4, 5, 6], open: '09:00', close: '21:00' },
      rules: ['No food or drink in the studio', 'Take your recordings with you — local files are wiped nightly', 'Leave the mixer on its default scene'],
      checklist: ['Four microphones and arms', 'Mixer powers on', 'Four headphones', 'Acoustic panels intact', 'Room tidy'],
    },
    {
      ...base, id: 'r_seminar', orgId: 'org_library', createdBy: 'u_daniel', name: 'Seminar Room B204', icon: '🏫', category: 'space', capacity: 30,
      description: 'Flexible room for 30 with projector, whiteboards and video-conferencing. Often empty in the evenings and on Saturdays.',
      location: 'Central Library, Level 2 (B204)', building: 'Central Library', value: 0, riskLevel: 'low', approvalMode: 'auto',
      tags: ['room', 'meeting', 'seminar', 'workshop', 'class', 'presentation'],
      requirements: req({ maxHours: 3, weeklyCapHours: 6, reviewAffiliations: ['community'] }),
      availability: { days: [1, 2, 3, 4, 5, 6], open: '08:00', close: '21:00' },
      rules: ['Community bookings need institutional approval and must be free to attend', 'Restore the furniture layout shown on the door', 'Leave the room by the booked end time'],
      checklist: ['Projector and HDMI working', 'Whiteboards clean', 'Furniture in standard layout', 'No damage to walls or tables'],
    },
    {
      ...base, id: 'r_scope', orgId: 'org_physics', createdBy: 'u_sam', name: 'Oscilloscope & Signal Generator Bench', icon: '📈', category: 'equipment',
      description: 'Keysight 4-channel 200 MHz oscilloscope, function generator, bench PSU and DMM. For electronics debugging and measurement.',
      location: 'Science Building, Teaching Lab 2 (S-118)', building: 'Science Building', value: 650000, riskLevel: 'medium', approvalMode: 'auto',
      tags: ['electronics', 'oscilloscope', 'signal', 'measure', 'circuit'],
      requirements: req({ credentials: ['electrical-safety'], maxHours: 4, weeklyCapHours: 8 }),
      availability: { days: WEEKDAYS, open: '09:00', close: '18:00' },
      rules: ['No mains-voltage experiments without a supervisor', 'Return probes to the rack', 'Switch off the PSU when you leave'],
      checklist: ['Four probes present', 'Scope powers on and self-test passes', 'Function generator output working', 'PSU leads intact'],
    },
    {
      ...base, id: 'r_gpu', orgId: 'org_physics', createdBy: 'u_sam', name: 'GPU Workstation — RTX 6000 (remote)', icon: '🖥️', category: 'computing',
      description: '48 GB GPU, 128 GB RAM workstation accessible remotely over the campus VPN. For model training, rendering and simulations.',
      location: 'Remote access (Science Building server room)', building: 'Remote', value: 900000, riskLevel: 'low', approvalMode: 'auto',
      tags: ['compute', 'gpu', 'training', 'render', 'simulation', 'ml'],
      requirements: req({ affiliations: ['student', 'researcher', 'staff'], maxHours: 12, weeklyCapHours: 24, maxAdvanceDays: 7 }),
      availability: { days: ALL_DAYS, open: '00:00', close: '24:00' },
      rules: ['Use your own scratch folder; it is wiped after each session', 'No cryptocurrency mining or non-academic workloads', 'Do not store personal data of others on the machine'],
      checklist: ['Scratch disk cleared of previous data', 'No unauthorised software installed', 'GPU temperature normal at idle'],
    },
    {
      ...base, id: 'r_bench', orgId: 'org_makers', createdBy: 'u_kwame', name: 'Woodworking Hand-Tool Bench', icon: '🔨', category: 'equipment',
      description: 'Workbench with vice, saws, chisels, planes, clamps and a cordless drill. Great for repairs and small furniture.',
      location: 'Northfield Makers Collective, 14 Mill Lane', building: 'Makers Collective', value: 60000, riskLevel: 'low', approvalMode: 'auto',
      tags: ['hand', 'woodwork', 'repair', 'tools', 'bench'],
      requirements: req({ maxHours: 3, weeklyCapHours: 6 }),
      availability: { days: [0, 2, 3, 4, 5, 6], open: '10:00', close: '20:00' },
      rules: ['Sharp tools go back in the rack', 'Sweep the bench and floor after use'],
      checklist: ['Saws and chisels complete', 'Vice working', 'Drill and two batteries present'],
    },
    {
      ...base, id: 'r_solder', orgId: 'org_makers', createdBy: 'u_kwame', name: 'Soldering Station — Hakko FX-951', icon: '🔌', category: 'equipment',
      description: 'Temperature-controlled soldering station with fume extractor, helping hands and a stock of common components.',
      location: 'Northfield Makers Collective, 14 Mill Lane', building: 'Makers Collective', value: 35000, riskLevel: 'medium', approvalMode: 'auto',
      tags: ['electronics', 'solder', 'pcb', 'circuit', 'arduino'],
      requirements: req({ credentials: ['electrical-safety'], maxHours: 3, weeklyCapHours: 6 }),
      availability: { days: [0, 2, 3, 4, 5, 6], open: '10:00', close: '20:00' },
      rules: ['Use the fume extractor at all times', 'Switch the iron off and place it in the stand when you leave'],
      checklist: ['Iron tip tinned and undamaged', 'Fume extractor working', 'Stand and sponge present'],
    },
  ];
}

export async function seed() {
  suspendAi(true);
  const realNow = Date.now();
  setClockOffset(0);
  const t0 = realNow;
  const today = zoned(t0).date;
  const at = (dayOff, time) => wallToMs(dateAdd(today, dayOff), time);
  const dayFor = (res, off, dir = -1) => { let d = off; while (!res.availability.days.includes(zoned(at(d, '12:00')).dow)) d += dir; return d; };

  const cred = (type, certificateId, daysAgo, verifier = 'Sameer Patel') => ({
    id: `cr_${type}_${certificateId}`, type, certificateId, issuer: L.CRED_TYPES[type].issuer,
    issuedAt: t0 - daysAgo * DAY, expiresAt: t0 - daysAgo * DAY + L.CRED_TYPES[type].validityMonths * 30 * DAY,
    evidence: '', submittedAt: t0 - daysAgo * DAY, status: 'verified',
    review: { by: 'u_sam', byName: verifier, at: t0 - daysAgo * DAY + H, note: 'Matched against training register' },
  });
  const pw = hashPassword(DEMO_PASSWORD);
  const user = (o) => ({ status: 'active', strikes: 0, verified: true, verifiedVia: 'University single sign-on', credentials: [], orgIds: [], createdAt: t0 - 60 * DAY, password: pw, ...o });

  store.db = {
    version: 1,
    settings: { clockOffset: 0, seededAt: t0 },
    orgs: [
      { id: 'org_fablab', name: 'FabLab — Dept. of Mechanical Engineering', short: 'FabLab', type: 'department', verified: true, verifiedBy: 'Priya Nair' },
      { id: 'org_media', name: 'School of Media — Media Lab', short: 'Media Lab', type: 'department', verified: true, verifiedBy: 'Priya Nair' },
      { id: 'org_library', name: 'Central Library — Learning Spaces', short: 'Library', type: 'department', verified: true, verifiedBy: 'Priya Nair' },
      { id: 'org_physics', name: 'Faculty of Science — Physics Teaching Labs', short: 'Physics Labs', type: 'department', verified: true, verifiedBy: 'Priya Nair' },
      { id: 'org_makers', name: 'Northfield Makers Collective (community partner)', short: 'Makers Collective', type: 'community', verified: true, verifiedBy: 'Priya Nair' },
    ],
    users: [
      user({ id: 'u_aisha', name: 'Aisha Khan', email: 'aisha@northfield.edu', role: 'member', affiliation: 'student', department: 'B.Des Product Design, Year 4',
        credentials: [cred('laser-safety', 'FAB-LS-1042', 120), cred('3dp-basics', 'FAB-3D-2210', 200), cred('electrical-safety', 'EHS-EL-5531', 90)] }),
      user({ id: 'u_rohan', name: 'Rohan Mehta', email: 'rohan@makers.community', role: 'member', affiliation: 'community', department: 'Northfield Makers Collective', verifiedVia: 'Photo ID checked by Priya Nair (admin)',
        credentials: [cred('laser-safety', 'FAB-LS-0877', 150), cred('3dp-basics', 'FAB-3D-1907', 300), cred('media-handling', 'MED-EQ-4410', 100, 'Anand Kulkarni')] }),
      user({ id: 'u_grace', name: 'Kavya Reddy', email: 'kavya@northfield.edu', role: 'member', affiliation: 'researcher', department: 'PhD, Materials Science',
        credentials: [cred('laser-safety', 'FAB-LS-1120', 60), cred('cnc-l2', 'FAB-CNC-0311', 80), cred('electrical-safety', 'EHS-EL-4002', 200)] }),
      user({ id: 'u_leo', name: 'Arjun Fernandes', email: 'arjun@northfield.edu', role: 'member', affiliation: 'student', department: 'B.Tech Electronics, Year 2',
        credentials: [cred('3dp-basics', 'FAB-3D-2555', 40)] }),
      user({ id: 'u_jordan', name: 'Ishaan Malhotra', email: 'ishaan@gmail.example', role: 'member', affiliation: 'community', department: 'Independent creator', verified: false, verifiedVia: null, createdAt: t0 - 1 * DAY }),
      user({ id: 'u_meera', name: 'Dr. Meera Iyer', email: 'meera@northfield.edu', role: 'owner', affiliation: 'staff', department: 'Head of FabLab', orgIds: ['org_fablab'] }),
      user({ id: 'u_sam', name: 'Sameer Patel', email: 'sameer@northfield.edu', role: 'manager', affiliation: 'staff', department: 'Senior Lab Technician', orgIds: ['org_fablab', 'org_physics'] }),
      user({ id: 'u_daniel', name: 'Anand Kulkarni', email: 'anand@northfield.edu', role: 'owner', affiliation: 'staff', department: 'Media Lab & Library Spaces Coordinator', orgIds: ['org_media', 'org_library'] }),
      user({ id: 'u_kwame', name: 'Farhan Qureshi', email: 'farhan@makers.community', role: 'owner', affiliation: 'community', department: 'Founder, Makers Collective', orgIds: ['org_makers'], verifiedVia: 'Partner agreement verified by Priya Nair (admin)' }),
      user({ id: 'u_priya', name: 'Priya Nair', email: 'priya@northfield.edu', role: 'admin', affiliation: 'staff', department: 'Research Infrastructure Office' }),
    ],
    resources: resources(t0),
    bookings: [],
    incidents: [],
    notifications: [],
    audit: [],
    sessions: {},
  };
  const db = store.db;
  const U = (id) => L.getUser(id);
  const R = (id) => L.getRes(id);
  const slot = (start, end) => ({ startDate: zoned(start).date, startTime: zoned(start).time, endDate: zoned(end).date, endTime: zoned(end).time });

  const steps = [];
  const step = (time, fn) => steps.push({ time, fn });

  // Platform set-up
  step(t0 - 40 * DAY, () => {
    for (const o of db.orgs) L.log(U('u_priya'), 'org.verified', 'org', o.id, `Priya Nair verified ${o.name}`, { type: o.type });
    for (const r of db.resources) L.log(U(r.createdBy), 'resource.listed', 'resource', r.id, `${U(r.createdBy).name} listed ${r.name}`, { approvalMode: r.approvalMode, credentials: r.requirements.credentials });
  });

  const fullCycle = (userId, resId, start, end, purpose, purposeCategory, managerId, { requestAt, issues = [], late = 0 } = {}) => {
    let b;
    step(requestAt ?? start - 20 * H, () => { b = L.createBooking(U(userId), { resourceId: resId, ...slot(start, end), purpose, purposeCategory, attendees: 1, acceptRules: true }); });
    if (R(resId).approvalMode === 'manual') step((requestAt ?? start - 20 * H) + 50 * MIN, () => L.decide(U(managerId), b, { decision: 'approve', reason: 'Meets all requirements; slot is free.' }));
    const ok = (res) => Object.fromEntries(res.checklist.map((_, i) => [i, { ok: true, note: '' }]));
    step(start + 2 * MIN, () => L.checkIn(U(userId), b, { condition: ok(R(resId)), notes: '' }));
    if (R(resId).requirements.supervision) step(start + 6 * MIN, () => L.signoff(U(managerId), b));
    step(end - 5 * MIN + late * MIN, async () => {
      const cond = ok(R(resId));
      for (const [i, note] of issues) cond[i] = { ok: false, note };
      await L.checkOut(U(userId), b, { condition: cond, notes: issues.length ? 'Noticed during the final pass.' : 'All good.' });
    });
    step(end + 40 * MIN + late * MIN, async () => { await L.inspect(U(managerId), b, issues.length ? { outcome: 'issue', notes: 'Confirmed the damage described by the user.' } : { outcome: 'ok', notes: 'Checked — all fine.' }); });
    return () => b;
  };

  // Rohan: heavy laser user over the last few weeks
  for (const d of [-20, -16, -9, -5]) fullCycle('u_rohan', 'r_laser', at(d, '10:00'), at(d, '12:00'), 'Cutting acrylic signage for maker market stall', 'personal', 'u_sam', { requestAt: at(d, '08:15') });
  // Aisha: past print and studio session
  fullCycle('u_aisha', 'r_printer', at(-2, '09:00'), at(-2, '13:00'), 'Printing enclosure prototype for thesis lamp project', 'coursework', 'u_sam', { requestAt: at(-3, '19:00') });
  const dStudio = dayFor(R('r_studio'), -6);
  fullCycle('u_aisha', 'r_studio', at(dStudio, '15:00'), at(dStudio, '16:00'), 'Recording user interviews for thesis research', 'coursework', 'u_daniel', { requestAt: at(dStudio - 1, '10:00') });
  // Kavya: GPU sessions and a laser session
  fullCycle('u_grace', 'r_gpu', at(-8, '20:00'), at(-8, '23:30'), 'Training a defect-detection model on micrograph images', 'research', 'u_sam', { requestAt: at(-8, '18:00') });
  fullCycle('u_grace', 'r_gpu', at(-4, '09:00'), at(-4, '17:00'), 'Hyper-parameter sweep for micrograph defect model', 'research', 'u_sam', { requestAt: at(-5, '21:00') });
  // Arjun: one completed print, returned late
  fullCycle('u_leo', 'r_printer', at(-7, '14:00'), at(-7, '18:00'), 'Printing a phone stand to learn the slicer settings', 'personal', 'u_sam', { requestAt: at(-7, '12:00'), late: 50 });

  // Kavya: CNC session ending in a damage report (left open for review)
  const dCnc = dayFor(R('r_cnc'), -3);
  let cncB;
  step(at(dCnc, '10:00') - 2 * DAY, () => { cncB = L.createBooking(U('u_grace'), { resourceId: 'r_cnc', ...slot(at(dCnc, '10:00'), at(dCnc, '13:00')), purpose: 'Milling aluminium sample holders for tensile testing rig', purposeCategory: 'research', attendees: 1, acceptRules: true }); });
  step(at(dCnc, '10:00') - 2 * DAY + 2 * H, () => L.decide(U('u_sam'), cncB, { decision: 'approve', reason: 'Approved — I will supervise on the day.' }));
  step(at(dCnc, '10:02'), () => L.checkIn(U('u_grace'), cncB, { condition: { 0: { ok: true }, 1: { ok: true }, 2: { ok: true }, 3: { ok: false, note: 'Shallow gouge near the front-left corner' }, 4: { ok: true } }, notes: 'Spoilboard already had a gouge — photographed.' }));
  step(at(dCnc, '10:06'), () => L.signoff(U('u_sam'), cncB));
  step(at(dCnc, '12:55'), async () => {
    await L.checkOut(U('u_grace'), cncB, { condition: { 0: { ok: false, note: 'Collet nut chipped after a tool change; bit slipped once' }, 1: { ok: true }, 2: { ok: true }, 3: { ok: false, note: 'Same gouge as at check-in' }, 4: { ok: true } }, notes: 'The 6 mm bit slipped during the second pass. I stopped the job immediately with the E-stop. Nobody was hurt.' });
  });

  // Arjun: no-show on the podcast studio -> system proposes a strike -> Anand confirms it
  const dNoShow = dayFor(R('r_studio'), -5);
  let leoNoShow;
  step(at(dNoShow, '09:30'), () => { leoNoShow = L.createBooking(U('u_leo'), { resourceId: 'r_studio', ...slot(at(dNoShow, '14:00'), at(dNoShow, '15:00')), purpose: 'Recording a podcast episode for the electronics club', purposeCategory: 'community', attendees: 2, acceptRules: true }); });
  step(at(dNoShow, '14:35'), async () => { await L.tick(); });
  step(at(dNoShow + 1, '10:00'), () => {
    const inc = db.incidents.find((i) => i.bookingId === leoNoShow.id && i.type === 'no_show');
    L.respondIncident(U('u_leo'), inc, { message: 'Sorry — I forgot the booking and had a lab test that afternoon.' });
  });
  step(at(dNoShow + 1, '11:30'), () => {
    const inc = db.incidents.find((i) => i.bookingId === leoNoShow.id && i.type === 'no_show');
    L.resolveIncident(U('u_daniel'), inc, { action: 'strike', notes: 'No cancellation and a peak-time slot was wasted while two people were waiting. Strike confirmed; it lowers priority in contested slots for 30 days.' });
  });
  // Arjun's late-return delay incident gets a warning
  step(at(-6, '10:00'), () => {
    const inc = db.incidents.find((i) => i.subjectUserId === 'u_leo' && i.type === 'delay');
    if (inc) L.resolveIncident(U('u_sam'), inc, { action: 'warning', notes: 'First late return and nobody was waiting for the printer. Friendly warning only — please extend the booking next time.' });
  });

  // Rohan: camera kit out, now overdue
  let camB;
  step(at(-3, '12:00'), () => { camB = L.createBooking(U('u_rohan'), { resourceId: 'r_camera', ...slot(at(-2, '10:00'), at(-1, '17:00')), purpose: 'Filming a short documentary on local repair cafés', purposeCategory: 'community', attendees: 1, acceptRules: true }); });
  step(at(-3, '13:00'), () => L.decide(U('u_daniel'), camB, { decision: 'approve', reason: 'Approved. Deposit held; please return by 17:00.' }));
  step(at(-2, '10:05'), () => L.checkIn(U('u_rohan'), camB, { condition: Object.fromEntries(R('r_camera').checklist.map((_, i) => [i, { ok: true }])), notes: 'Kit complete.' }));

  // Training records waiting for verification
  step(at(-1, '18:00'), () => L.submitCredential(U('u_aisha'), { type: 'media-handling', certificateId: 'MED-EQ-3307', issuer: 'School of Media', issuedDate: dateAdd(today, -12), expiresDate: dateAdd(today, 700), evidence: 'Completed the 2-hour Media Equipment Handling workshop with Anand Kulkarni on the date above. Certificate PDF available on request.' }));
  step(at(-1, '19:30'), () => L.submitCredential(U('u_leo'), { type: 'laser-safety', certificateId: 'FAB-LS-0877', issuer: 'Northfield FabLab', issuedDate: dateAdd(today, -3), expiresDate: dateAdd(today, 360), evidence: 'did the induction last week' }));

  // Aisha: a 3D print that starts right now (ready for a judge to check in)
  const startNow = Math.floor(t0 / (15 * MIN)) * 15 * MIN;
  step(at(-1, '20:00'), () => L.createBooking(U('u_aisha'), { resourceId: 'r_printer', ...slot(startNow, startNow + 3 * H), purpose: 'Second iteration of the lamp enclosure (thinner walls)', purposeCategory: 'coursework', attendees: 1, acceptRules: true }));

  // Contested laser slot tomorrow: Rohan (heavy recent use) vs Kavya (first-time, research)
  step(t0 - 3 * H, () => L.createBooking(U('u_rohan'), { resourceId: 'r_laser', ...slot(at(1, '14:00'), at(1, '16:00')), purpose: 'More acrylic signage for the weekend market', purposeCategory: 'personal', attendees: 1, acceptRules: true }));
  step(t0 - 2 * H, () => L.createBooking(U('u_grace'), { resourceId: 'r_laser', ...slot(at(1, '14:30'), at(1, '16:30')), purpose: 'Cutting calibration masks for a thin-film experiment', purposeCategory: 'research', attendees: 1, acceptRules: true }));

  // Studio: Kavya confirmed, Rohan on the waitlist for an overlapping time
  const dStudio2 = dayFor(R('r_studio'), 1, 1);
  step(t0 - 5 * H, () => L.createBooking(U('u_grace'), { resourceId: 'r_studio', ...slot(at(dStudio2, '11:00'), at(dStudio2, '12:00')), purpose: 'Recording a science-communication podcast with my lab group', purposeCategory: 'research', attendees: 3, acceptRules: true }));
  step(t0 - 4.5 * H, () => L.createBooking(U('u_aisha'), { resourceId: 'r_studio', ...slot(at(dStudio2, '15:00'), at(dStudio2, '16:00')), purpose: 'Recording the voice-over for my thesis showcase video', purposeCategory: 'coursework', attendees: 1, acceptRules: true }));
  step(t0 - 4 * H, () => L.createBooking(U('u_rohan'), { resourceId: 'r_studio', ...slot(at(dStudio2, '11:00'), at(dStudio2, '12:00')), purpose: 'Interview for the makers collective podcast', purposeCategory: 'community', attendees: 2, acceptRules: true, joinWaitlist: true }));

  // Community request for a library room needing institutional approval
  const dSem = dayFor(R('r_seminar'), 3, 1);
  step(t0 - 6 * H, () => L.createBooking(U('u_rohan'), { resourceId: 'r_seminar', ...slot(at(dSem, '17:00'), at(dSem, '19:00')), purpose: 'Free monthly repair-café meetup for residents and students (approx. 20 people)', purposeCategory: 'community', attendees: 20, acceptRules: true }));

  steps.sort((a, b) => a.time - b.time);
  for (const s of steps) {
    setClockOffset(Math.min(s.time, realNow) - Date.now());
    await s.fn();
  }
  setClockOffset(0);
  await L.tick();
  const cutoff = now() - 2 * DAY;
  for (const n of db.notifications) if (n.at < cutoff) n.read = true;
  db.settings.clockOffset = 0;
  suspendAi(false);
  return db;
}
