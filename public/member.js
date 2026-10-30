import {
  S, api, esc, fmtDT, fmtTime, fmtDay, fmtRange, wall, rel, money, badge, sevBadge, toast, dialog, confirmReason,
  readPhotos, photosHtml, checksHtml, breakdownHtml, timelineHtml, nowMs, roleLabel, isStaff,
} from './core.js';
import { art } from './art.js';
import { icon } from './icons.js';

const ELIG = {
  eligible: ['You can use this', 'ok'],
  conditional: ['Eligible once verified', 'warn'],
  not_eligible: ['Requirements missing', 'danger'],
};
const eligBadge = (s) => `<span class="badge ${ELIG[s][1]}">${ELIG[s][0]}</span>`;
const CAT = { equipment: 'Equipment', space: 'Space', computing: 'Computing' };

function availability(r) {
  if (r.status !== 'active') return '<span class="dotline danger"><i></i>Paused for maintenance</span>';
  if (r.live?.freeNow) return '<span class="dotline ok"><i></i>Free right now</span>';
  if (r.live?.nextFree) return `<span class="dotline"><i></i>Next free ${esc(fmtDT(r.live.nextFree))}</span>`;
  return '<span class="dotline"><i></i>No free slots this week</span>';
}

export function resCard(r, i = 0, extra = '') {
  const tag = r.eligibility.summary !== 'eligible' ? eligBadge(r.eligibility.summary) : r.approvalMode === 'auto' ? '<span class="badge ok">Instant approval</span>' : '';
  return `<a class="res-card stagger" style="--i:${i}" href="#/resource/${r.id}" data-text="${esc(`${r.name} ${r.description} ${r.tags.join(' ')} ${r.location} ${r.org.short}`.toLowerCase())}">
    <div style="position:relative">${art(r)}${tag ? `<div class="tagline">${tag}</div>` : ''}</div>
    <div class="rc-body">
      <div class="rc-title">${esc(r.name)}</div>
      <div class="rc-meta">${esc(r.org.short)} · ${esc(r.building)}${r.capacity ? ` · up to ${r.capacity} people` : ''}</div>
      ${extra}
      <div class="rc-foot">${availability(r)}${r.highDemand ? '<span class="muted" style="font-size:.8rem">High demand</span>' : ''}</div>
    </div>
  </a>`;
}

// ---------------- Discover ----------------
export async function viewDiscover() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const data = await api('GET', `/resources?${params.toString()}`);
  const href = (changes) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) p.set(k, v); else p.delete(k); }
    return `#/discover${p.toString() ? `?${p}` : ''}`;
  };
  const chip = (label, key, value) => {
    const on = (params.get(key) || '') === value;
    return `<a class="chip" aria-pressed="${on}" href="${href({ [key]: on && value ? '' : value })}">${label}</a>`;
  };
  const toggle = (label, key) => `<a class="chip" aria-pressed="${params.get(key) === '1'}" href="${href({ [key]: params.get(key) === '1' ? '' : '1' })}">${label}</a>`;
  return {
    title: 'Discover',
    html: `
    <div class="page-head"><div><h1>Discover</h1><p>Labs, studios and specialist equipment across Northfield — with what each needs, and whether you already qualify.</p></div></div>
    <form id="matchForm" class="matchbar" role="search" aria-label="Describe your project">
      <div class="search"><span>${icon('sparkle', 16)}</span><label class="sr-only" for="mq">Describe your project</label>
        <input id="mq" type="search" maxlength="400" placeholder="Describe your project — “film interviews for a documentary”, “workshop for 25 people”…"></div>
      <button class="btn primary">Find matches</button>
    </form>
    <div id="matchOut" class="match-result" aria-live="polite"></div>
    <div class="toolbar">
      <div class="search">${icon('search', 16)}<label class="sr-only" for="fq">Filter resources</label><input id="fq" type="search" placeholder="Filter by name, tag or building" value="${esc(params.get('q') || '')}"></div>
      <label class="sr-only" for="fb">Location</label>
      <select id="fb" aria-label="Location"><option value="">All locations</option>${data.buildings.map((b) => `<option ${params.get('building') === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <label class="sr-only" for="fs">Sort</label>
      <select id="fs" aria-label="Sort"><option value="recommended">Recommended for you</option><option value="soonest" ${params.get('sort') === 'soonest' ? 'selected' : ''}>Available soonest</option><option value="demand" ${params.get('sort') === 'demand' ? 'selected' : ''}>Most in demand</option><option value="name" ${params.get('sort') === 'name' ? 'selected' : ''}>Name A–Z</option></select>
    </div>
    <div class="chips" role="group" aria-label="Filters">
      ${chip('All', 'category', '')}${chip('Equipment', 'category', 'equipment')}${chip('Spaces', 'category', 'space')}${chip('Computing', 'category', 'computing')}
      <span style="width:1px;background:var(--line);margin:0 6px"></span>
      ${toggle('Free right now', 'free')}${toggle('Only what I can use', 'eligible')}
    </div>
    <p class="muted" id="countLine" style="margin:-12px 0 var(--s5);font-size:.88rem">${data.resources.length} resource${data.resources.length === 1 ? '' : 's'}</p>
    <div class="res-grid" id="grid">${data.resources.map((r, i) => resCard(r, i)).join('')}</div>
    <div class="empty" id="noResults" ${data.resources.length ? 'hidden' : ''}><b>Nothing matches yet</b>Try removing a filter or describing your project above.<a class="btn small" href="#/discover">Clear filters</a></div>`,
    mount(root) {
      const grid = root.querySelector('#grid');
      const fq = root.querySelector('#fq');
      const applyText = () => {
        const q = fq.value.trim().toLowerCase();
        let n = 0;
        grid.querySelectorAll('.res-card').forEach((c) => { const show = !q || q.split(/\s+/).every((w) => c.dataset.text.includes(w)); c.hidden = !show; if (show) n += 1; });
        root.querySelector('#countLine').textContent = `${n} resource${n === 1 ? '' : 's'}`;
        root.querySelector('#noResults').hidden = n > 0;
      };
      fq.addEventListener('input', applyText);
      if (fq.value) applyText();
      root.querySelector('#fb').addEventListener('change', (e) => { location.hash = href({ building: e.target.value, q: fq.value }); });
      root.querySelector('#fs').addEventListener('change', (e) => { location.hash = href({ sort: e.target.value === 'recommended' ? '' : e.target.value, q: fq.value }); });
      root.querySelector('#matchForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const out = root.querySelector('#matchOut');
        const query = root.querySelector('#mq').value.trim();
        if (query.length < 3) { out.innerHTML = '<p class="muted">Tell us a little more about what you\'re making.</p>'; return; }
        const btn = e.target.querySelector('button');
        btn.classList.add('loading');
        try {
          const r = await api('POST', '/match', { query });
          out.innerHTML = r.matches.length
            ? `<div class="section-head"><h2>Best matches</h2><span class="muted" style="font-size:.82rem">${r.source === 'claude' ? 'Ranked by Claude · eligibility checked by LabLend rules' : 'Keyword matching · eligibility checked by LabLend rules'}</span></div>
               <div class="res-grid">${r.matches.slice(0, 4).map((m, i) => resCard(m.resource, i, `<div style="font-size:.84rem;color:var(--text-2)"><b style="color:var(--accent)">${m.fit}% fit</b> · ${esc(m.reason)}</div>`)).join('')}</div>`
            : '<p class="muted">No strong match. Try describing the activity, e.g. “cut acrylic” or “record audio”.</p>';
        } catch (ex) { out.innerHTML = `<div class="alert danger">${esc(ex.message)}</div>`; }
        btn.classList.remove('loading');
      });
    },
  };
}

// ---------------- Resource detail + booking ----------------
function roundUp(ms, step) { return Math.ceil(ms / step) * step; }

function calendarHtml(cal, res, sel) {
  const a = res.availability;
  const [o, c] = [a.open, a.close].map((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; });
  const span = c - o;
  const pos = (ms, day) => ((ms - day.dayStart) / 60000 - o) / span * 100;
  const hours = [];
  const stepM = span > 600 ? 240 : 120;
  for (let m = Math.ceil(o / stepM) * stepM; m <= c; m += stepM) hours.push([m, `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:00`]);
  return `<div class="cal" role="grid" aria-label="Availability for the next 7 days">
    <div class="cal-axis"><div></div><div class="axis">${hours.map(([m, h]) => `<span style="left:${((m - o) / span) * 100}%">${h}</span>`).join('')}</div></div>
    ${cal.days.map((d) => {
      const blocks = d.blocks.map((b) => {
        const l = Math.max(0, pos(b.start, d)); const r = Math.min(100, pos(b.end, d));
        return r > l ? `<div class="blk ${b.kind}" style="left:${l}%;width:${r - l}%" title="${esc(b.label)} ${fmtTime(b.start)}–${fmtTime(b.end)}">${esc(b.label)}</div>` : '';
      }).join('');
      const n = nowMs();
      const nowLine = n > d.dayStart && n < d.dayStart + 864e5 && pos(n, d) > 0 && pos(n, d) < 100 ? `<div class="nowline" style="left:${pos(n, d)}%" title="Now"></div>` : '';
      let selBlk = '';
      if (sel && sel.start < d.dayStart + 864e5 && sel.end > d.dayStart) {
        const l = Math.max(0, pos(Math.max(sel.start, d.dayStart), d)); const r = Math.min(100, pos(Math.min(sel.end, d.dayStart + 864e5), d));
        if (r > l) selBlk = `<div class="blk sel" style="left:${l}%;width:${r - l}%"></div>`;
      }
      return `<div class="cal-row"><div class="cal-day"><b>${fmtDay(d.dayStart + 432e5).split(',')[0]}</b>${fmtDay(d.dayStart + 432e5).split(',').slice(1).join('')}</div>
        <div class="track ${d.open ? '' : 'closed'}" data-day="${d.dayStart}" ${d.open ? 'title="Click to pick a start time"' : 'title="Closed"'}>${blocks}${selBlk}${nowLine}</div></div>`;
    }).join('')}
    <div class="legend"><span><i style="background:var(--ok-soft);border:1px solid var(--border)"></i>Free</span><span><i style="background:#6b7770"></i>Booked</span><span><i style="background:#b8862a"></i>Requested</span><span><i style="background:var(--primary)"></i>Yours</span><span><i style="border:2px dashed var(--info)"></i>Your selection</span></div>
  </div>`;
}

export function evaluationHtml(ev, res) {
  const head = {
    auto_approve: ['✅ Will be confirmed instantly', ''],
    review: ['🕑 Goes to the owner for review', ''],
    waitlist: ['⏳ Slot taken — you can join the waitlist', ev.waitlistPosition ? ` (you would be #${ev.waitlistPosition})` : ''],
    blocked: ['⛔ Not possible yet', ''],
  }[ev.outcome];
  const elig = ev.checks.filter((c) => !['hours', 'duration', 'lead', 'advance', 'weekly', 'active', 'highdemand', 'range'].includes(c.key));
  const slot = ev.checks.filter((c) => ['hours', 'duration', 'lead', 'advance', 'weekly', 'active', 'highdemand', 'range'].includes(c.key));
  return `<div class="outcome ${ev.outcome}"><b>${head[0]}${head[1]}</b><span style="font-size:.88rem">${esc(ev.explanation)}</span></div>
    ${ev.alternatives?.length ? `<div class="field"><label>Free slots nearby</label><div class="row">${ev.alternatives.map((a) => `<button type="button" class="btn small" data-alt="${a.start}-${a.end}">${esc(fmtRange(a.start, a.end))}</button>`).join('')}</div></div>` : ''}
    <details ${ev.outcome === 'blocked' ? 'open' : ''}><summary>About you (${elig.filter((c) => c.status === 'pass').length}/${elig.filter((c) => c.status !== 'info').length} checks passed)</summary>${checksHtml(elig)}</details>
    <details ${ev.outcome === 'blocked' && slot.some((c) => c.status === 'fail') ? 'open' : ''}><summary>About this time slot (${slot.filter((c) => c.status === 'pass').length}/${slot.length} passed)</summary>${checksHtml(slot)}</details>
    <details><summary>Your priority score if requests compete: <span class="score">${ev.priority.score}</span></summary>
      <p class="muted" style="font-size:.84rem;margin:.4rem 0">When several people want the same time, staff see requests ranked by this score. It favours people who have used the resource less and coursework/research purposes.</p>
      ${breakdownHtml(ev.priority)}</details>`;
}

export async function viewResource({ id }) {
  const [{ resource: r, stats }, cal0] = await Promise.all([api('GET', `/resources/${id}`), api('GET', `/resources/${id}/calendar`)]);
  const t = nowMs();
  const step = 30 * 60000;
  let start = roundUp(t, step);
  const durMs = Math.min(r.loan ? 24 * 36e5 : 60 * 60000 * Math.min(2, r.requirements.maxHours), r.requirements.maxHours * 36e5);
  const s0 = wall(start); const e0 = wall(start + durMs);
  const req = r.requirements;
  const credNames = req.credentials.map((c) => S.meta.credTypes[c].name);
  return {
    title: r.name,
    html: `
    <a class="crumb" href="#/discover">← Discover</a>
    <section class="res-hero">
      ${art(r)}
      <div>
        <span class="eyebrow">${esc(r.org.name)}${r.org.verified ? ` · <span style="color:var(--ok)" title="Verified by ${esc(r.org.verifiedBy)}">${icon('shield', 13)} Verified owner</span>` : ''}</span>
        <h1>${esc(r.name)}</h1>
        <p class="lede">${esc(r.description)}</p>
        <div class="row" style="gap:var(--s4)">${r.status !== 'active' ? '<span class="dotline danger"><i></i>Paused for maintenance</span>' : r.live?.freeNow ? '<span class="dotline ok"><i></i>Free right now</span>' : r.live?.nextFree ? `<span class="dotline"><i></i>Next free ${esc(fmtDT(r.live.nextFree))}</span>` : ''}${eligBadge(r.eligibility.summary)}</div>
        <dl class="facts">
          <div><dt>Location</dt><dd>${esc(r.location)}</dd></div>
          <div><dt>${r.loan ? 'Desk hours' : 'Open'}</dt><dd>${r.availability.days.length === 7 && r.availability.open === '00:00' ? 'Around the clock' : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].filter((_, i) => r.availability.days.includes(i)).join(' ')} · ${r.availability.open}–${r.availability.close}`}</dd></div>
          <div><dt>Approval</dt><dd>${r.approvalMode === 'auto' ? 'Instant when every check passes' : 'Reviewed by staff'}</dd></div>
          <div><dt>Limits</dt><dd>${req.maxHours} h per booking · ${req.weeklyCapHours} h / week</dd></div>
          ${r.capacity ? `<div><dt>Capacity</dt><dd>${r.capacity} people</dd></div>` : ''}
          <div><dt>Managed by</dt><dd>${r.managers.map((m) => esc(m.name)).join(', ')}</dd></div>
        </dl>
        ${r.canEdit ? `<a class="btn small" href="#/listing/${r.id}/edit" style="margin-top:var(--s5)">Edit listing</a>` : ''}
      </div>
    </section>
    <div class="split">
      <div>
        <section class="block">
          <h2>Can you use it?</h2>
          <p class="muted">${credNames.length ? `Requires ${credNames.map(esc).join(', ')}.` : 'No training required.'} ${req.supervision ? 'A technician supervises on site.' : ''} ${req.deposit ? `Refundable deposit of ${money(req.deposit)}.` : ''} ${r.highDemand ? 'High demand — one upcoming booking per person.' : ''}</p>
          ${checksHtml(r.eligibility.checks)}
        </section>
        <section class="block">
          <div class="section-head"><h2>Availability</h2>
            <div class="row"><button class="icon-btn" data-week="-7" aria-label="Previous week" style="transform:scaleX(-1)">${icon('chevron')}</button><span class="muted" id="calLabel" style="font-size:.86rem;min-width:150px;text-align:center"></span><button class="icon-btn" data-week="7" aria-label="Next week">${icon('chevron')}</button></div></div>
          <p class="muted" style="font-size:.86rem">Click a free spot to pick a start time. Other people's bookings are shown without names.</p>
          <div id="cal"></div>
        </section>
        <section class="block grid cols-2" style="gap:var(--s8)">
          <div><h2>Usage rules</h2><ol style="margin:0;padding-left:1.1rem;color:var(--text-2);display:grid;gap:6px">${r.rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
          <div><h2>Condition checklist</h2><p class="muted" style="font-size:.86rem">Recorded at check-in and return, so earlier issues are never blamed on you.</p><ul style="margin:0;padding-left:1.1rem;color:var(--text-2);display:grid;gap:6px">${r.checklist.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        </section>
        ${stats ? `<section class="block"><h2>Last 30 days <span class="muted" style="font-weight:400;font-size:.9rem">· owner view</span></h2>${statsGrid(stats)}</section>` : ''}
      </div>
      <aside class="card sticky" aria-labelledby="bh">
        <h2 id="bh" style="font-size:1.15rem">Request this ${r.category === 'space' ? 'space' : r.loan ? 'kit' : 'resource'}</h2>
        <p class="muted" style="font-size:.86rem">Checks run live as you choose — you'll know the outcome before you send.</p>
        <form id="bookForm" novalidate>
          <div class="inline-fields">
            <div class="field"><label for="sd">${r.loan ? 'Pick-up date' : 'Date'}</label><input id="sd" name="startDate" type="date" value="${s0.date}" required></div>
            <div class="field"><label for="st">${r.loan ? 'Pick-up time' : 'Start'}</label><input id="st" name="startTime" type="time" step="900" value="${s0.time}" required></div>
            ${r.loan ? `<div class="field"><label for="ed">Return date</label><input id="ed" name="endDate" type="date" value="${e0.date}"></div>` : ''}
            <div class="field"><label for="et">${r.loan ? 'Return time' : 'End'}</label><input id="et" name="endTime" type="time" step="900" value="${e0.time}" required></div>
          </div>
          <div class="field"><label for="pc">Purpose</label><select id="pc" name="purposeCategory">${Object.entries(S.meta.purposes).map(([k, v]) => `<option value="${k}" ${S.me.affiliation === 'student' && k === 'coursework' ? 'selected' : S.me.affiliation === 'researcher' && k === 'research' ? 'selected' : S.me.affiliation === 'community' && k === 'community' ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
          <div class="field"><label for="pp">What will you make or do? <span class="hint">· only the owner sees this</span></label><textarea id="pp" name="purpose" maxlength="600" placeholder="e.g. Cutting acrylic panels for my final-year lamp prototype" required></textarea></div>
          ${r.capacity ? `<div class="field"><label for="at">Number of people</label><input id="at" name="attendees" type="number" min="1" max="${r.capacity}" value="1"></div>` : ''}
          <label class="check field"><input type="checkbox" name="acceptRules" required> <span style="font-size:.88rem">I've read the usage rules${req.deposit ? ` and agree to a refundable ${money(req.deposit)} deposit hold` : ''}${req.supervision ? ' and will wait for staff sign-off before operating' : ''}.</span></label>
          <div id="evalOut" aria-live="polite"><div class="skeleton"><i style="height:60px;width:100%"></i></div></div>
          <button class="btn primary large" id="bookBtn" style="width:100%;margin-top:var(--s3)" disabled>Checking…</button>
        </form>
      </aside>
    </div>`,
    mount(root) {
      const form = root.querySelector('#bookForm');
      const out = root.querySelector('#evalOut');
      const btn = root.querySelector('#bookBtn');
      let ev = null; let timer = null; let cal = cal0; let calFrom = wall(nowMs()).date;
      const body = () => {
        const fd = Object.fromEntries(new FormData(form));
        return { resourceId: r.id, ...fd, endDate: fd.endDate || fd.startDate, acceptRules: form.acceptRules.checked, attendees: fd.attendees || 1 };
      };
      const drawCal = () => { root.querySelector('#cal').innerHTML = calendarHtml(cal, r, ev && { start: ev.start, end: ev.end }); root.querySelector('#calLabel').textContent = `${fmtDay(cal.days[0].dayStart + 432e5)} – ${fmtDay(cal.days[6].dayStart + 432e5)}`; };
      const run = async () => {
        try {
          const res = await api('POST', '/bookings/precheck', body());
          ev = res.evaluation;
          out.innerHTML = evaluationHtml(ev, r);
          btn.disabled = ev.outcome === 'blocked';
          btn.textContent = { auto_approve: 'Confirm booking', review: 'Send request for review', waitlist: `Join the waitlist${ev.waitlistPosition ? ` (#${ev.waitlistPosition})` : ''}`, blocked: 'Requirements not met' }[ev.outcome];
          drawCal();
        } catch (ex) { out.innerHTML = `<div class="alert danger">${esc(ex.message)}</div>`; btn.disabled = true; }
      };
      const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
      form.addEventListener('input', schedule);
      out.addEventListener('click', (e) => {
        const b = e.target.closest('[data-alt]');
        if (!b) return;
        const [s, en] = b.dataset.alt.split('-').map(Number);
        setSlot(s, en);
      });
      const setSlot = (s, en) => {
        form.startDate.value = wall(s).date; form.startTime.value = wall(s).time;
        if (form.endDate) form.endDate.value = wall(en).date;
        form.endTime.value = wall(en).time;
        run();
      };
      root.querySelector('#cal').addEventListener('click', (e) => {
        const tr = e.target.closest('.track');
        if (!tr || tr.classList.contains('closed')) return;
        const rect = tr.getBoundingClientRect();
        const frac = (e.clientX - rect.left) / rect.width;
        const [o, c] = [r.availability.open, r.availability.close].map((x) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; });
        const minute = Math.floor((o + frac * (c - o)) / 30) * 30;
        const s = Number(tr.dataset.day) + minute * 60000;
        const cur = ev ? ev.end - ev.start : durMs;
        setSlot(s, s + cur);
      });
      root.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', async () => {
        const base = new Date(`${calFrom}T12:00:00Z`);
        base.setUTCDate(base.getUTCDate() + Number(b.dataset.week));
        calFrom = base.toISOString().slice(0, 10);
        cal = await api('GET', `/resources/${r.id}/calendar?from=${calFrom}`);
        drawCal();
      }));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!ev || ev.outcome === 'blocked') return;
        const b = body();
        if (b.purpose.trim().length < 10) { toast('Please describe your purpose (at least 10 characters).', 'danger'); form.purpose.focus(); return; }
        if (!b.acceptRules) { toast('Please confirm you have read the usage rules.', 'danger'); return; }
        btn.disabled = true;
        try {
          const res = await api('POST', '/bookings', { ...b, joinWaitlist: ev.outcome === 'waitlist' });
          toast({ approved: 'Booking confirmed!', pending: 'Request sent for review.', waitlisted: 'You joined the waitlist.' }[res.booking.status] || 'Done', 'ok');
          location.hash = `#/booking/${res.booking.id}`;
        } catch (ex) {
          toast(ex.message, 'danger');
          if (ex.data?.evaluation) { ev = ex.data.evaluation; out.innerHTML = evaluationHtml(ev, r); }
          btn.disabled = false;
        }
      });
      drawCal();
      run();
    },
  };
}

export function statsGrid(s) {
  return `<div class="metrics eight">
    <div><div class="num">${s.utilisation}%</div><div class="lbl">Utilisation of open hours</div><div class="bar" style="margin-top:10px"><span style="width:${Math.min(100, s.utilisation)}%"></span></div></div>
    <div><div class="num">${s.bookedHours}<small class="muted" style="font-size:.5em"> h</small></div><div class="lbl">Used · ${s.idleHours} h still idle</div></div>
    <div><div class="num">${s.communityHours}<small class="muted" style="font-size:.5em"> h</small></div><div class="lbl">Used by community members</div></div>
    <div><div class="num">${s.uniqueUsers}</div><div class="lbl">People served · top user ${s.topUserShare}%</div></div>
    <div><div class="num">${s.requests}</div><div class="lbl">Requests · ${s.rejected} rejected</div></div>
    <div><div class="num">${s.waitlisted}</div><div class="lbl">Waiting now</div></div>
    <div><div class="num ${s.noShows ? 'hot' : ''}">${s.noShows}</div><div class="lbl">No-shows</div></div>
    <div><div class="num">${s.avgDecisionHours ?? '—'}${s.avgDecisionHours != null ? '<small class="muted" style="font-size:.5em"> h</small>' : ''}</div><div class="lbl">Average time to decision</div></div>
  </div>`;
}

// ---------------- My bookings ----------------
export function bookingRow(b, { showUser = false } = {}) {
  const next = b.actions.includes('checkin') ? '<span class="badge primary">Check-in open</span>'
    : b.actions.includes('checkout') ? '<span class="badge primary">Record return</span>'
      : b.actions.includes('inspect') ? '<span class="badge warn">Inspect return</span>'
        : b.actions.includes('signoff') ? '<span class="badge warn">Sign-off needed</span>' : '';
  return `<a class="res-row" href="#/booking/${b.id}">${art(b.resource)}
    <div style="min-width:0"><div class="rr-title">${esc(b.resource.name)}</div>
      <div class="rr-meta">${esc(fmtRange(b.start, b.end))}${showUser ? ` · ${esc(b.user.name)}` : ''} · ${esc(b.ref)}</div></div>
    <div class="rr-side">${b.overdue ? '<span class="badge danger">Overdue</span>' : next}${badge(b.status, b.waitlistPosition ? ` · #${b.waitlistPosition}` : '')}</div></a>`;
}

export async function viewBookings() {
  const { bookings } = await api('GET', '/bookings?scope=mine');
  const active = bookings.filter((b) => ['approved', 'checked_in', 'returned'].includes(b.status)).sort((a, b) => a.start - b.start);
  const requests = bookings.filter((b) => ['pending', 'waitlisted'].includes(b.status)).sort((a, b) => a.start - b.start);
  const past = bookings.filter((b) => !active.includes(b) && !requests.includes(b));
  const sec = (title, list, empty, hint = '') => `<section class="block reveal"><div class="section-head"><h2>${title} <span class="muted" style="font-weight:400">${list.length}</span></h2>${hint}</div>
    ${list.length ? `<div class="list">${list.map((b) => bookingRow(b)).join('')}</div>` : `<p class="muted">${empty}</p>`}</section>`;
  return {
    title: 'My bookings',
    html: `<div class="page-head"><div><h1>My bookings</h1><p>Every request shows where it is in the process and the reason behind each decision.</p></div><a class="btn primary" href="#/discover">${icon('search', 16)} Find a resource</a></div>
      ${sec('Upcoming & in use', active, 'Nothing booked yet — <a href="#/discover">discover resources</a>.')}
      ${sec('Requests & waitlist', requests, 'No open requests.', '<span class="muted" style="font-size:.84rem">Waitlisted requests are promoted automatically</span>')}
      ${sec('History', past, 'No past bookings yet.')}`,
  };
}

// ---------------- Booking detail & lifecycle actions ----------------
function stepper(b) {
  const steps = ['Requested', 'Checks run', 'Decision', 'Checked in', 'Returned', 'Inspected'];
  const idx = { pending: 2, waitlisted: 2, approved: 3, checked_in: 4, returned: 5, completed: 6 }[b.status];
  const stopAt = { rejected: [2, 'Not approved'], cancelled: [b.decision?.at && b.checkIn ? 3 : 2, 'Cancelled'], expired: [2, 'Expired'], no_show: [3, 'No-show'] }[b.status];
  return `<ol class="stepper" aria-label="Booking progress">${steps.map((s, i) => {
    let cls = '';
    let label = s;
    if (stopAt) { if (i < stopAt[0]) cls = 'done'; else if (i === stopAt[0]) { cls = 'stop'; label = stopAt[1]; } }
    else if (i < idx) cls = 'done'; else if (i === idx) cls = 'current';
    if (b.status === 'waitlisted' && i === 2) label = 'Waitlisted';
    return `<li class="${cls}" data-n="${i + 1}">${esc(label)}</li>`;
  }).join('')}</ol>`;
}

function conditionTable(b) {
  if (!b.checkIn) return '<p class="muted">Condition is recorded by the user at check-in and again at return.</p>';
  const rows = b.resource.checklist.map((label, i) => {
    const a = b.checkIn.items[i]; const z = b.checkOut?.items[i];
    const isNew = a?.ok && z && !z.ok;
    const cell = (x) => (x ? (x.ok ? '<span class="cond-ok">✓ OK</span>' : `<span class="cond-bad">✕ Issue</span> <span class="muted">${esc(x.note)}</span>`) : '<span class="muted">—</span>');
    return `<tr class="${isNew ? 'cond-new' : ''}"><td>${esc(label)}</td><td>${cell(a)}</td><td>${cell(z)}</td><td>${isNew ? '<span class="badge danger">New since check-in</span>' : a && !a.ok ? (z?.ok ? '<span class="badge ok">Fixed by user</span>' : '<span class="badge outline">Pre-existing</span>') : ''}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="t"><thead><tr><th>Item</th><th>At check-in · ${fmtDT(b.checkIn.at)}</th><th>At return ${b.checkOut ? `· ${fmtDT(b.checkOut.at)}` : ''}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="grid cols-2" style="margin-top:.75rem">
      <div><b>Check-in notes</b><p class="muted">${esc(b.checkIn.notes || '—')}</p>${photosHtml(b.checkIn.photos)}</div>
      <div><b>Return notes</b><p class="muted">${esc(b.checkOut?.notes || '—')}</p>${photosHtml(b.checkOut?.photos)}${b.checkOut ? `<p>${b.checkOut.lateMinutes > 0 ? `<span class="badge warn">Returned ${b.checkOut.lateMinutes} min late</span>` : '<span class="badge ok">Returned on time</span>'}</p>` : ''}</div>
    </div>
    ${b.inspection ? `<div class="alert ${b.inspection.outcome === 'ok' ? 'ok' : 'warn'}" style="margin-top:.6rem"><strong>Inspection by ${esc(b.inspection.byName)} · ${fmtDT(b.inspection.at)}</strong>${b.inspection.outcome === 'ok' ? 'Accepted in good condition.' : 'Issue found.'} ${esc(b.inspection.notes)}</div>` : ''}`;
}

const ACTION_LABELS = {
  checkin: ['Check in & record condition', 'primary'], checkout: ['Record return & condition', 'primary'], approve: ['Approve', 'primary'],
  reject: ['Reject', 'danger'], waitlist: ['Move to waitlist', ''], cancel: ['Cancel booking', 'danger'], extend: ['Request extension', ''],
  signoff: ['Confirm supervision', 'primary'], inspect: ['Inspect return', 'primary'], decide_extension: ['Decide extension', 'primary'], report: ['Report an issue', 'warn'],
};
export const actionButtons = (b, small = false) => b.actions.map((a) => `<button class="btn ${ACTION_LABELS[a][1]} ${small ? 'small' : ''}" data-act="${a}" data-id="${b.id}">${ACTION_LABELS[a][0]}</button>`).join('');

function conditionForm(checklist, before) {
  return `${checklist.map((label, i) => `<div class="cond-item">
      <div><b>${esc(label)}</b>${before ? `<div class="was">At check-in: ${before[i]?.ok ? 'OK' : `Issue — ${esc(before[i]?.note || '')}`}</div>` : ''}</div>
      <div class="seg" role="radiogroup" aria-label="${esc(label)}">
        <label><input type="radio" name="c${i}" value="ok" ${before && !before[i]?.ok ? '' : ''}><span>OK</span></label>
        <label class="bad"><input type="radio" name="c${i}" value="bad"><span>Issue</span></label>
      </div>
      <div class="note" hidden><input type="text" name="n${i}" placeholder="Describe the issue (required)" maxlength="300" value="${before && !before[i]?.ok ? esc(before[i].note) : ''}"></div>
    </div>`).join('')}
    <div class="field" style="margin-top:.8rem"><label for="cn">Notes <span class="hint">(optional)</span></label><textarea id="cn" name="notes" maxlength="600"></textarea></div>
    <div class="field"><label for="cp">Photos <span class="hint">(up to 3 — strongly recommended for high-value equipment)</span></label><input id="cp" name="photos" type="file" accept="image/*" capture="environment" multiple></div>
    <div class="row"><button type="button" class="btn small" data-allok>Mark all OK</button></div>`;
}
function mountCondition(d) {
  const sync = () => d.querySelectorAll('.cond-item').forEach((it) => { it.querySelector('.note').hidden = it.querySelector('input[value=bad]').checked === false; });
  d.addEventListener('change', sync);
  d.querySelector('[data-allok]')?.addEventListener('click', () => { d.querySelectorAll('input[value=ok]').forEach((x) => { x.checked = true; }); sync(); });
  sync();
}
async function readCondition(form, checklist) {
  const condition = {};
  checklist.forEach((label, i) => {
    const v = form.querySelector(`input[name=c${i}]:checked`)?.value;
    if (!v) throw new Error(`Please mark “${label}” as OK or Issue.`);
    const note = form[`n${i}`].value.trim();
    if (v === 'bad' && note.length < 3) throw new Error(`Please describe the issue with “${label}”.`);
    condition[i] = { ok: v === 'ok', note: v === 'bad' ? note : '' };
  });
  return { condition, notes: form.notes.value, photos: await readPhotos(form.photos) };
}

export async function runAction(act, b, after) {
  const post = (path, body) => api('POST', `/bookings/${b.id}/${path}`, body);
  const fin = (msg) => { toast(msg, 'ok'); after?.(); };
  const res = b.resource;
  try {
    if (act === 'approve') {
      const pend = b.liveEligibility?.pendingCredential;
      if (pend) { toast('Verify the requester\'s training record first (Manage → Verifications).', 'danger'); return; }
      const v = await confirmReason({ title: `Approve ${b.ref}`, required: false, submitLabel: 'Approve', templates: ['Meets all requirements; slot is free.', 'Approved — a technician will be on site.', 'Approved. Please follow the usage rules carefully.'], intro: `${esc(b.user.name)} · ${esc(fmtRange(b.start, b.end))}. Approving automatically moves overlapping pending requests to the waitlist, and tells those people why.` });
      if (v) { await post('decision', { decision: 'approve', reason: v.reason }); fin('Approved and requester notified'); }
    } else if (act === 'reject') {
      const v = await confirmReason({ title: `Reject ${b.ref}`, submitLabel: 'Reject request', danger: true, templates: ['The time clashes with a scheduled class or maintenance.', 'This purpose is not covered by the resource\'s usage policy.', 'Please complete the required training first.', 'The group size exceeds what the room can safely hold.'] });
      if (v) { await post('decision', { decision: 'reject', reason: v.reason }); fin('Rejected — requester notified with your reason'); }
    } else if (act === 'waitlist') {
      const v = await confirmReason({ title: `Move ${b.ref} to the waitlist`, submitLabel: 'Move to waitlist', templates: ['Another request has higher priority for this time.', 'Waiting for the current booking holder to confirm.'] });
      if (v) { await post('decision', { decision: 'waitlist', reason: v.reason }); fin('Moved to waitlist'); }
    } else if (act === 'cancel') {
      const mine = b.userId === S.me.id;
      const late = mine && b.status === 'approved' && b.start - nowMs() < S.meta.policy.lateCancelHours * 36e5;
      const v = await confirmReason({ title: `Cancel ${b.ref}`, submitLabel: 'Cancel booking', danger: true, required: !mine, intro: late ? '<span class="badge warn">Late cancellation</span> This is within 2 hours of the start. It is recorded (no automatic penalty), and the slot goes to the next person on the waitlist.' : 'The slot is released and the next person on the waitlist is promoted automatically.', templates: mine ? ['My plans changed.', 'Finished the work earlier than expected.'] : ['Emergency maintenance on the equipment.', 'The room is needed for an exam.'] });
      if (v) { await post('cancel', { reason: v.reason }); fin('Cancelled'); }
    } else if (act === 'checkin') {
      await dialog({
        title: `Check in · ${res.name}`, submitLabel: 'Check in', wide: true,
        body: `<p class="muted">Record the condition <b>before</b> you start. Anything you mark as an issue now is documented as pre-existing, so you won't be held responsible for it.</p>${res.requirements.supervision ? '<div class="alert warn"><strong>Supervised equipment</strong>Do not operate it until a technician confirms supervision in LabLend.</div>' : ''}${conditionForm(res.checklist)}`,
        onMount: mountCondition,
        onSubmit: async (f) => { await post('checkin', await readCondition(f, res.checklist)); },
      }) && fin('Checked in — enjoy your session');
    } else if (act === 'checkout') {
      await dialog({
        title: `Return · ${res.name}`, submitLabel: 'Confirm return', wide: true,
        body: `<p class="muted">Record the condition now. Items that were OK at check-in but have an issue now are flagged and a damage report opens automatically for staff to review — reporting honestly is always better than staff finding it later.</p>${conditionForm(res.checklist, b.checkIn.items)}`,
        onMount: mountCondition,
        onSubmit: async (f) => { await post('checkout', await readCondition(f, res.checklist)); },
      }) && fin('Return recorded — staff will inspect it');
    } else if (act === 'signoff') {
      await dialog({ title: 'Confirm on-site supervision', submitLabel: 'I am supervising', body: `<p>Confirm that you are physically present and supervising <b>${esc(b.user.name)}</b> on <b>${esc(res.name)}</b>. This is recorded in the audit history.</p>`, onSubmit: () => post('signoff', {}) }) && fin('Supervision confirmed');
    } else if (act === 'inspect') {
      const full = (await api('GET', `/bookings/${b.id}`)).booking;
      await dialog({
        title: `Inspect return · ${full.ref}`, submitLabel: 'Save inspection', wide: true,
        body: `${conditionTable(full)}<hr>
          <div class="field"><label>Outcome</label>
            <label class="check"><input type="radio" name="outcome" value="ok" ${full.checkOut?.newIssues?.length ? '' : 'checked'}> Accept — in the same condition as at check-in${full.deposit ? ' (release deposit)' : ''}</label>
            <label class="check"><input type="radio" name="outcome" value="issue" ${full.checkOut?.newIssues?.length ? 'checked' : ''}> Issue found — keep${full.deposit ? ' deposit held and' : ''} open/attach a damage incident</label></div>
          <div class="field"><label for="in">Inspection notes</label><textarea id="in" name="notes" placeholder="What did you check?"></textarea></div>`,
        onSubmit: async (f) => { await post('inspect', { outcome: f.outcome.value, notes: f.notes.value }); },
      }) && fin('Inspection saved');
    } else if (act === 'extend') {
      await dialog({
        title: 'Request more time', submitLabel: 'Request extension',
        body: `<div class="field"><label for="em">Extra time</label><select id="em" name="minutes"><option value="15">15 minutes</option><option value="30" selected>30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></div>
          <div class="field"><label for="er">Why?</label><input id="er" name="reason" type="text" maxlength="300" placeholder="e.g. The final cut is taking longer than expected"></div>
          <p class="muted" style="font-size:.84rem">LabLend checks the next booking and your limits instantly. If nobody needs the slot and the resource allows instant approval, it is extended right away.</p>`,
        onSubmit: async (f) => {
          const r = await post('extend', { minutes: f.minutes.value, reason: f.reason.value });
          const ext = r.booking.extensions.at(-1);
          toast(`Extension ${ext.status}${ext.note ? `: ${ext.note}` : ''}`, ext.status === 'declined' ? 'danger' : 'ok');
        },
      }) && after?.();
    } else if (act === 'decide_extension') {
      const ext = b.extensions.find((e) => e.status === 'pending');
      await dialog({
        title: `Extension: +${ext.minutes} min for ${b.ref}`, submitLabel: 'Save decision',
        body: `<p>${esc(b.user.name)} asks: “${esc(ext.reason || 'No reason given')}”. The rules engine already confirmed nobody is booked straight after.</p>
          <label class="check"><input type="radio" name="d" value="1" checked> Approve</label><label class="check"><input type="radio" name="d" value="0"> Decline</label>
          <div class="field"><label for="xn">Note to user</label><input id="xn" name="note" type="text"></div>`,
        onSubmit: async (f) => { await post('extension', { extId: ext.id, approve: f.d.value === '1', note: f.note.value }); },
      }) && fin('Decision saved');
    } else if (act === 'report') {
      await reportIncident(b, after);
    }
  } catch (ex) { toast(ex.message, 'danger'); }
}

export async function reportIncident(b, after) {
  const types = S.meta.incidentTypes;
  const done = await dialog({
    title: `Report an issue · ${b.resource.name}`, submitLabel: 'Submit report',
    body: `<div class="inline-fields">
        <div class="field"><label for="it">Type</label><select id="it" name="type">${Object.entries(types).filter(([k]) => k !== 'no_show').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label for="is">How serious?</label><select id="is" name="severity"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical — someone could get hurt</option></select></div></div>
      <div class="field"><label for="idesc">What happened?</label><textarea id="idesc" name="description" placeholder="Describe what you saw, when, and anything you already did (e.g. pressed the E-stop)"></textarea></div>
      <div class="field"><label for="iph">Photos <span class="hint">(optional, up to 3)</span></label><input id="iph" name="photos" type="file" accept="image/*" multiple></div>
      <p class="muted" style="font-size:.84rem">Staff review every report. An AI-assisted summary may help them triage, but only a person decides on any outcome.</p>`,
    onSubmit: async (f) => {
      const r = await api('POST', '/incidents', { bookingId: b.id, type: f.type.value, severity: f.severity.value, description: f.description.value, photos: await readPhotos(f.photos) });
      return r.incident;
    },
  });
  if (done) { toast(`Reported as ${done.ref}`, 'ok'); location.hash = `#/incident/${done.id}`; }
}

export async function viewBooking({ id }) {
  const { booking: b, timeline } = await api('GET', `/bookings/${id}`);
  const mine = b.userId === S.me.id;
  const r = b.resource;
  const d = b.decision;
  const dep = b.deposit && { not_held: 'Not held yet', held: 'Held', released: 'Released', held_pending_review: 'Held pending incident review', forfeited: 'Forfeited', partially_released: `Partially released (₹${b.deposit.deducted} deducted)` }[b.deposit.status];
  const ev = b.evaluation;
  return {
    title: b.ref,
    html: `
    <a class="crumb" href="${mine ? '#/bookings' : '#/manage/queue'}">← ${mine ? 'My bookings' : 'Review queue'}</a>
    <div class="page-head"><div class="row" style="flex-wrap:nowrap;align-items:flex-start">
      <div class="thumb">${art(r)}</div>
      <div><h1 style="margin:0">${esc(r.name)}</h1><p>${esc(b.ref)} · ${esc(fmtRange(b.start, b.end))} · 📍 ${esc(r.location)}</p></div></div>
      <div class="row">${b.overdue ? '<span class="badge danger">Overdue</span>' : ''}${badge(b.status, b.waitlistPosition ? ` · #${b.waitlistPosition} in queue` : '')}</div></div>
    ${stepper(b)}
    <div class="split">
      <div class="stack">
        ${d ? `<section class="alert ${{ approved: 'ok', rejected: 'danger', waitlisted: 'warn', cancelled: '', expired: '' }[d.action] ?? 'info'}">
          <strong>${{ approved: 'Why this was approved', rejected: 'Why this was not approved', waitlisted: 'Why you are on the waitlist', cancelled: 'Cancellation', expired: 'Why this expired' }[d.action] || 'Decision'}</strong>
          ${esc(d.reason)}<div class="muted" style="font-size:.8rem;margin-top:.25rem">${esc(d.byName)} · ${fmtDT(d.at)}</div></section>`
        : b.status === 'pending' ? `<section class="alert info"><strong>Waiting for staff review</strong>${esc(ev.explanation)}</section>` : ''}
        ${b.status === 'no_show' ? '<section class="alert danger"><strong>Marked as a no-show</strong>No check-in was recorded within 30 minutes of the start, so the slot was released to the waitlist. A staff member reviews whether a strike applies — see the linked incident to explain what happened.</section>' : ''}
        ${b.overdue ? `<section class="alert danger"><strong>Overdue</strong>This was due back ${rel(b.end)}. ${mine ? 'Please return it and record the return now — or request an extension if nobody is waiting.' : 'The user and managers have been notified.'}</section>` : ''}
        ${b.checkIn?.supervisorRequired ? `<section class="alert ${b.checkIn.supervisorSignoff ? 'ok' : 'warn'}"><strong>Supervision</strong>${b.checkIn.supervisorSignoff ? `Signed off by ${esc(b.checkIn.supervisorSignoff.byName)} at ${fmtTime(b.checkIn.supervisorSignoff.at)}.` : 'Waiting for a technician to confirm they are supervising. Do not operate the machine yet.'}</section>` : ''}
        ${b.actions.length ? `<section class="card"><h2>Next steps</h2><div class="row">${actionButtons(b)}</div>
          ${b.status === 'approved' && !b.actions.includes('checkin') && mine ? `<p class="muted" style="margin:.6rem 0 0;font-size:.86rem">Check-in opens ${S.meta.policy.checkInEarlyMin} min before the start (${rel(b.start)}). If you don't check in within ${S.meta.policy.noShowGraceMin} min of the start it becomes a no-show.${S.meta.demo ? ' <b>Demo tip:</b> use the demo clock above to jump to the start time.' : ''}</p>` : ''}</section>` : ''}
        <section class="card"><h2>Condition record</h2>${conditionTable(b)}</section>
        ${b.extensions.length ? `<section class="card"><h2>Extensions</h2><table class="t"><tbody>${b.extensions.map((e) => `<tr><td>+${e.minutes} min</td><td>${esc(e.reason || '')}</td><td>${badge(e.status === 'declined' ? 'rejected' : e.status === 'approved' ? 'approved' : 'pending')}</td><td class="muted">${esc(e.decidedBy || '')} ${esc(e.note || '')}</td></tr>`).join('')}</tbody></table></section>` : ''}
        ${b.incidents.length ? `<section class="card"><h2>Incidents</h2><div class="stack">${b.incidents.map((i) => `<a href="#/incident/${i.id}" class="row between" style="text-decoration:none;color:inherit"><span><b>${esc(i.ref)}</b> · ${esc(S.meta.incidentTypes[i.type])}</span><span class="row">${sevBadge(i.severity)}${badge(i.status)}</span></a>`).join('')}</div></section>` : ''}
        <section class="card"><div class="row between"><h2 style="margin:0">Activity history</h2><a href="#/activity" class="muted" style="font-size:.84rem">Verify chain integrity →</a></div><p class="muted" style="font-size:.84rem">Every entry is hash-chained to the one before it, so the history can't be silently edited.</p>${timelineHtml(timeline)}</section>
      </div>
      <aside class="stack">
        <section class="card"><h3>Request</h3><dl class="kv">
          <dt>Requester</dt><dd>${esc(b.user.name)} <span class="muted">· ${esc(S.meta.affiliations[b.user.affiliation])}</span>${b.user.email ? `<br><small>${esc(b.user.email)} · ${b.user.strikes} strike(s)</small>` : ''}</dd>
          <dt>Purpose</dt><dd><span class="badge outline">${esc(S.meta.purposes[b.purposeCategory].label)}</span><br>${esc(b.purpose)}</dd>
          ${b.attendees > 1 ? `<dt>People</dt><dd>${b.attendees}</dd>` : ''}
          <dt>Requested</dt><dd>${fmtDT(b.createdAt)}</dd>
          ${b.deposit ? `<dt>Deposit</dt><dd>${money(b.deposit.amount)} · ${esc(dep)}</dd>` : ''}
          <dt>Owner</dt><dd>${esc(r.orgShort)}</dd>
        </dl></section>
        ${b.livePriority ? `<section class="card"><h3>Live checks (staff view)</h3>
          ${b.liveEligibility.pendingCredential ? '<div class="alert warn" style="margin-bottom:.5rem"><strong>Training record awaiting verification</strong>Approval is blocked until it is verified in Manage → Verifications.</div>' : ''}
          ${checksHtml(b.liveEligibility.checks.filter((c) => c.status !== 'pass'))}
          ${b.liveEligibility.checks.every((c) => c.status === 'pass' || c.status === 'info') ? '<p class="cond-ok">✓ All eligibility checks pass right now</p>' : ''}
          <h3 style="margin-top:.8rem">Priority score: <span class="score">${b.livePriority.score}</span></h3>${breakdownHtml(b.livePriority)}</section>` : ''}
        <section class="card"><h3>Checks at request time</h3><p class="muted" style="font-size:.84rem">Snapshot of the ${ev.checks.length} automated checks when this was requested — outcome: <b>${esc(ev.outcome.replace('_', ' '))}</b>.</p>
          <details><summary>Show checks</summary>${checksHtml(ev.checks)}</details>
          <details><summary>Priority score then: ${ev.priority.score}</summary>${breakdownHtml(ev.priority)}</details></section>
        <section class="card"><h3>Usage rules</h3><ol style="margin:0;padding-left:1.1rem;font-size:.88rem">${r.rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>
      </aside>
    </div>`,
    mount(root) {
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (btn) runAction(btn.dataset.act, b, () => S.refresh());
      });
    },
  };
}

// ---------------- Profile ----------------
export async function viewProfile() {
  const { user: u } = await api('GET', '/me');
  const ct = S.meta.credTypes;
  return {
    title: 'Profile',
    html: `<div class="page-head"><div><h1>${esc(u.name)}</h1><p>${esc(roleLabel(u.role))} · ${esc(S.meta.affiliations[u.affiliation])} · ${esc(u.department || '')}</p></div>
      <button class="btn" id="export">Download my data (JSON)</button></div>
    <div class="grid cols-2">
      <section class="card"><h2>Verification & standing</h2><dl class="kv">
        <dt>Email</dt><dd>${esc(u.email)}</dd>
        <dt>Identity</dt><dd>${u.verified ? `<span class="badge ok">Verified</span> ${esc(u.verifiedVia)}` : '<span class="badge danger">Not verified</span> An administrator must check your ID before you can book. In this demo, sign in as Priya (admin) → Admin → People → Verify.'}</dd>
        <dt>Booking access</dt><dd>${u.status === 'active' ? '<span class="badge ok">Active</span>' : '<span class="badge danger">Restricted</span>'}</dd>
        <dt>Strikes</dt><dd>${u.strikes || 0} confirmed <span class="muted">— each lowers your priority by ${S.meta.policy.strikePenalty} points in contested slots; ${S.meta.policy.strikeReviewThreshold}+ means every request is reviewed by staff. Strikes are only ever confirmed by a person.</span></dd>
      </dl></section>
      <section class="card"><h2>Your privacy</h2><ul style="margin:0;padding-left:1.1rem;font-size:.9rem">
        <li>Other users only see that a slot is “Booked” — never who booked it.</li>
        <li>Your purpose, contact details and condition photos are visible only to the staff of resources you request, and to platform admins.</li>
        <li>Training certificates are seen only by staff who verify that training.</li>
        <li>Every staff decision about you is recorded with a reason you can read.</li>
        <li>You can download everything we hold about you at any time.</li></ul></section>
    </div>
    <section class="card" style="margin-top:1rem"><div class="row between"><h2 style="margin:0">Training records</h2><button class="btn primary small" id="addCred">Add a training record</button></div>
      <div class="table-wrap" style="margin-top:.6rem"><table class="t"><thead><tr><th>Training</th><th>Certificate</th><th>Status</th><th>Valid until</th><th>Review</th></tr></thead><tbody>
      ${u.credentials.map((c) => `<tr><td>${esc(c.typeName)}</td><td><code>${esc(c.certificateId)}</code><br><small>${esc(c.issuer)}</small></td><td>${badge(c.status === 'rejected' ? 'rejected' : c.status)}</td><td>${c.expiresAt ? fmtDay(c.expiresAt) : '—'}</td><td class="muted" style="font-size:.84rem">${c.review ? `${esc(c.review.byName)}: ${esc(c.review.note)}` : 'Waiting for staff'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No training records yet.</td></tr>'}
      </tbody></table></div>
      <p class="muted" style="font-size:.84rem;margin-top:.6rem">Available trainings: ${Object.values(ct).map((x) => `${esc(x.name)} (${esc(x.issuer)})`).join(' · ')}</p></section>`,
    mount(root) {
      root.querySelector('#export').addEventListener('click', async () => {
        const r = await fetch('/api/me/export', { credentials: 'same-origin' });
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'my-lablend-data.json'; a.click();
        URL.revokeObjectURL(a.href);
      });
      root.querySelector('#addCred').addEventListener('click', async () => {
        const ok = await dialog({
          title: 'Add a training record', submitLabel: 'Submit for verification',
          body: `<div class="field"><label for="ct">Training</label><select id="ct" name="type">${Object.entries(ct).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('')}</select></div>
            <div class="inline-fields"><div class="field"><label for="cid">Certificate ID</label><input id="cid" name="certificateId" type="text" placeholder="${esc(Object.values(ct)[0].example)}"></div>
            <div class="field"><label for="ci">Issued by</label><input id="ci" name="issuer" type="text" value="${esc(Object.values(ct)[0].issuer)}"></div></div>
            <div class="inline-fields"><div class="field"><label for="cis">Issue date</label><input id="cis" name="issuedDate" type="date"></div>
            <div class="field"><label for="cie">Expiry date <span class="hint">(if any)</span></label><input id="cie" name="expiresDate" type="date"></div></div>
            <div class="field"><label for="cev">Evidence <span class="hint">(where/when you trained; optional)</span></label><textarea id="cev" name="evidence"></textarea></div>
            <p class="muted" style="font-size:.84rem">A staff member checks this against the training register. Automated checks (ID format, issuer, dates, duplicates) help them, but they make the decision.</p>`,
          onMount: (d) => d.querySelector('#ct').addEventListener('change', (e) => { d.querySelector('#cid').placeholder = ct[e.target.value].example; d.querySelector('#ci').value = ct[e.target.value].issuer; }),
          onSubmit: async (f) => api('POST', '/credentials', Object.fromEntries(new FormData(f))),
        });
        if (ok) { toast('Submitted — staff will verify it', 'ok'); S.refresh(); }
      });
    },
  };
}

// ---------------- Fairness & activity ----------------
export async function viewFairness() {
  const f = await api('GET', '/fairness');
  const p = f.policy;
  return {
    title: 'How allocation works',
    html: `<div class="page-head"><div><h1>How LabLend shares fairly</h1><p>The same published rules apply to everyone. Nothing about access or penalties is decided by an unexplained algorithm.</p></div></div>
    <div class="grid cols-3">
      <div class="stat card"><div class="num">${f.totals.idleHoursUnlocked} h</div><div class="lbl">Resource hours used in the last 30 days</div></div>
      <div class="stat card"><div class="num">${f.totals.communityHours} h</div><div class="lbl">…of which by community members</div></div>
      <div class="stat card"><div class="num">${f.totals.uniqueUsers}</div><div class="lbl">Different people served</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:1rem">
      <section class="card"><h2>1 · Hard limits stop monopolisation</h2><ul>
        <li>At most <b>${p.maxActiveBookings}</b> open requests or upcoming bookings per person across the platform.</li>
        <li>Each resource has a <b>weekly hours cap per person</b> and a maximum booking length.</li>
        <li><b>High-demand</b> resources allow only <b>one upcoming booking per person</b> at a time.</li>
        <li>Bookings can only be made within each resource's booking window (no block-booking months ahead).</li></ul></section>
      <section class="card"><h2>2 · Contested slots use a transparent score</h2>
        <p>When requests overlap, staff see them ranked by a priority score that everyone can see on their own request:</p>
        <table class="breakdown"><tr><td>Base</td><td>50</td></tr><tr><td>Per hour used on this resource in the last 30 days</td><td>−${p.usagePenaltyPerHour} (max −${p.usagePenaltyCap})</td></tr>
        <tr><td>First time using this resource</td><td>+${p.firstTimeBonus}</td></tr>
        ${Object.values(f.purposes).map((x) => `<tr><td>Purpose: ${esc(x.label)}</td><td>+${x.points}</td></tr>`).join('')}
        <tr><td>Per confirmed strike</td><td>−${p.strikePenalty}</td></tr></table>
        <p class="muted" style="font-size:.84rem;margin-top:.5rem">Ties go to whoever asked first. Staff can override the ranking, but must write a reason the requester can read.</p></section>
      <section class="card"><h2>3 · Waitlists promote automatically</h2><p>If a slot is taken you can join its waitlist. When a booking is cancelled or becomes a no-show, the highest-scoring waiting request is promoted immediately and notified — no first-come-first-served refresh races.</p></section>
      <section class="card"><h2>4 · Accountability, with people in charge</h2><ul>
        <li>No check-in within ${p.noShowGraceMin} min ⇒ no-show. The system <i>proposes</i> a strike; a manager confirms or waives it.</li>
        <li>Returns more than ${p.lateReturnGraceMin} min late open a delay review.</li>
        <li>Damage is judged by comparing check-in and return records — you are never blamed for issues you recorded at check-in.</li>
        <li>Any penalty can be disputed; disputes go to a platform administrator.</li></ul></section>
    </div>
    <section class="card" style="margin-top:1rem"><h2>High-demand resources right now</h2><div class="table-wrap"><table class="t"><thead><tr><th>Resource</th><th>Weekly cap</th><th>Utilisation (30d)</th><th>People served</th><th>Largest single-user share</th><th>Waiting</th></tr></thead><tbody>
      ${f.highDemand.map((h) => `<tr><td>${esc(h.name)}</td><td>${h.weeklyCapHours} h</td><td>${h.utilisation}%</td><td>${h.uniqueUsers}</td><td>${h.topUserShare}% ${h.topUserShare >= 60 ? '<span class="badge warn">concentrated</span>' : ''}</td><td>${h.waitlisted}</td></tr>`).join('')}
    </tbody></table></div></section>`,
  };
}

export async function viewActivity() {
  const [v, a] = await Promise.all([api('GET', '/audit/verify'), api('GET', '/audit')]);
  return {
    title: 'Activity history',
    html: `<div class="page-head"><div><h1>Activity history</h1><p>${S.me.role === 'admin' ? 'All platform activity.' : 'Activity on your bookings, incidents' + (isStaff() ? ' and the resources you manage' : '') + '.'}</p></div>
      ${S.me.role === 'admin' ? '<a class="btn" href="/api/audit/export.csv">Export CSV</a>' : ''}</div>
    <div class="alert ${v.ok ? 'ok' : 'danger'}"><strong>${v.ok ? '✓ Audit chain intact' : '✕ Audit chain broken'}</strong>${v.ok ? `All ${v.count} entries verified — each SHA-256 hash links to the previous entry. Head: <span class="hash">${esc(v.head.slice(0, 24))}…</span>` : `Entry #${v.brokenAt}: ${esc(v.reason)}`}</div>
    <section class="card" style="margin-top:1rem"><p class="muted">${a.total} entries${a.total > a.entries.length ? `, showing latest ${a.entries.length}` : ''}</p>${timelineHtml(a.entries, true)}</section>`,
  };
}
