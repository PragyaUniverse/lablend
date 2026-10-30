import { S, api, esc, fmtDT, fmtRange, fmtDay, rel, money, badge, sevBadge, toast, dialog, checksHtml, breakdownHtml, timelineHtml, photosHtml, roleLabel, isStaff } from './core.js';
import { art } from './art.js';
import { bookingRow, actionButtons, runAction, statsGrid } from './member.js';

const TABS = [['queue', 'Review queue'], ['active', 'In use & returns'], ['verifications', 'Verifications'], ['incidents', 'Incidents'], ['listings', 'Listings'], ['insights', 'Insights & flags']];
const tabs = (cur) => `<nav class="tabs" aria-label="Manage sections">${TABS.map(([k, v]) => `<a href="#/manage/${k}" class="${k === cur ? 'active' : ''}">${v}</a>`).join('')}</nav>`;
const actionMount = (list) => (root) => root.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  e.preventDefault();
  const b = list.find((x) => x.id === btn.dataset.id);
  runAction(btn.dataset.act, b, () => S.refresh());
});

export async function viewManage({ tab = 'queue' }) {
  const T = {
    queue: ['Review queue', 'Requests are pre-checked and ranked by a published priority score. You make the call.'],
    active: ['In use & returns', 'Who has what right now, what is overdue, and which returns need an inspection.'],
    verifications: ['Verifications', 'Training records waiting for a person to confirm them.'],
    incidents: ['Incidents', 'Damage, late returns, no-shows and safety reports — with the records side by side.'],
    listings: ['Listings', 'The resources you manage, their status and demand.'],
    insights: ['Insights', 'Utilisation, reach and explainable usage patterns for your resources.'],
  }[tab] || ['Manage', ''];
  const head = `<div class="page-head"><div><span class="eyebrow">${esc(S.orgs.map((o) => o.short).join(' · ') || 'All organisations')}</span><h1>${T[0]}</h1><p>${T[1]}</p></div>${['owner', 'admin'].includes(S.me.role) && ['listings', 'insights'].includes(tab) ? '<a class="btn primary" href="#/listing/new">List a resource</a>' : ''}</div>`;
  const v = await ({ queue, active, verifications, incidents: incidentsTab, listings, insights }[tab] || queue)();
  return { title: 'Manage', html: head + v.html, mount: v.mount };
}

async function queue() {
  const { groups } = await api('GET', '/manage/queue');
  const all = groups.flatMap((g) => g.items);
  const item = (b, i, g) => `<div class="queue-item">
    <div class="rank ${i === 0 && g.contested ? 'top' : ''}" title="Rank by priority score">${g.contested ? i + 1 : '•'}</div>
    <div style="min-width:0">
      <div class="row"><a href="#/booking/${b.id}"><b>${esc(b.user.name)}</b></a><span class="muted">${esc(S.meta.affiliations[b.user.affiliation])}</span>${badge(b.status)}
        ${b.user.strikes ? `<span class="badge danger">${b.user.strikes} strike</span>` : ''}
        ${b.liveEligibility.pendingCredential ? '<span class="badge warn">Training needs verifying</span>' : b.liveEligibility.eligible ? '<span class="badge ok">Eligible</span>' : '<span class="badge danger">No longer eligible</span>'}</div>
      <div class="muted" style="font-size:.86rem">${esc(b.ref)} · ${esc(fmtRange(b.start, b.end))} · requested ${rel(b.createdAt)}</div>
      <div style="margin-top:.3rem"><span class="badge outline">${esc(S.meta.purposes[b.purposeCategory].label)}</span> ${esc(b.purpose)}</div>
      <details style="margin-top:.35rem"><summary>Priority score <span class="score">${b.livePriority.score}</span></summary>${breakdownHtml(b.livePriority)}</details>
      ${b.decision?.reason && b.status === 'waitlisted' ? `<div class="muted" style="font-size:.82rem;margin-top:.3rem">${esc(b.decision.reason)}</div>` : ''}
    </div>
    <div class="qa row" style="justify-content:flex-end">${actionButtons({ ...b, actions: b.actions.filter((a) => ['approve', 'reject', 'waitlist'].includes(a)) }, true)}</div></div>`;
  return {
    html: `<p class="muted">Requests are grouped when they compete for overlapping time on the same resource and ranked by their transparent priority score. Approving one automatically moves the others to the waitlist and tells them why.</p>
      ${groups.length ? groups.map((g) => `<section class="card"><div class="row between"><h2 style="margin:0">${esc(g.resource.name)}</h2>
        <div class="row">${g.contested ? `<span class="badge warn">Contested · ${g.items.length} requests</span>` : ''}<span class="muted">${esc(fmtRange(g.start, g.end))}</span></div></div>
        <div style="margin-top:.7rem">${g.items.map((b, i) => item(b, i, g)).join('')}</div></section>`).join('') : '<div class="card empty">🎉 Nothing waiting for review.</div>'}`,
    mount: actionMount(all),
  };
}

async function active() {
  const d = await api('GET', '/manage/active');
  const all = [...d.inUse, ...d.returns, ...d.upcoming, ...d.extensions];
  const sec = (title, list, hint) => `<section class="card"><h2>${title} <span class="muted">(${list.length})</span></h2>${hint ? `<p class="muted" style="font-size:.86rem">${hint}</p>` : ''}
    <div class="stack">${list.map((b) => `<div>${bookingRow(b, { showUser: true })}<div class="row" style="margin:.4rem 0 0 .2rem">${actionButtons({ ...b, actions: b.actions.filter((a) => ['signoff', 'inspect', 'decide_extension', 'cancel'].includes(a)) }, true)}</div></div>`).join('') || '<p class="muted">None.</p>'}</div></section>`;
  return {
    html: `<div class="grid cols-2">${sec('Returns to inspect', d.returns, 'Compare the user\'s check-in and return records, then accept or flag an issue.')}${sec('In use now', d.inUse, 'Overdue items and supervision sign-offs are highlighted.')}${sec('Extension requests', d.extensions)}${sec('Starting in the next 48 h', d.upcoming)}</div>`,
    mount: actionMount(all),
  };
}

const REC = { looks_valid: ['Checks look consistent', 'ok'], needs_closer_look: ['Needs a closer look', 'warn'], likely_invalid: ['Likely invalid', 'danger'] };
async function verifications() {
  const { items } = await api('GET', '/manage/verifications');
  return {
    html: `<p class="muted">Users can request a resource while their training is pending, but nobody can be approved until a person verifies the record here.</p>
    ${items.map((x, i) => `<section class="card"><div class="row between"><h2 style="margin:0">${esc(x.credential.typeName)}</h2><span class="badge ${REC[x.assessment.recommendation][1]}">${REC[x.assessment.recommendation][0]}</span></div>
      <div class="grid cols-2" style="margin-top:.6rem"><dl class="kv">
        <dt>Person</dt><dd>${esc(x.user.name)} · ${esc(S.meta.affiliations[x.user.affiliation])}<br><small>${esc(x.user.email)}</small></dd>
        <dt>Certificate</dt><dd><code>${esc(x.credential.certificateId)}</code></dd>
        <dt>Issuer</dt><dd>${esc(x.credential.issuer)} <span class="muted">(expected ${esc(x.credential.expectedIssuer)})</span></dd>
        <dt>Dates</dt><dd>${x.credential.issuedAt ? fmtDay(x.credential.issuedAt) : '—'} → ${x.credential.expiresAt ? fmtDay(x.credential.expiresAt) : '—'}</dd>
        <dt>Evidence</dt><dd>${esc(x.credential.evidence || '—')}</dd><dt>Submitted</dt><dd>${rel(x.credential.submittedAt)}</dd></dl>
        <div class="card ai-card" style="box-shadow:none"><div class="ai-label">Automated review · ${esc(x.assessment.source)} · advisory only</div><ul style="margin:.4rem 0 0;padding-left:1.1rem;font-size:.88rem">${x.assessment.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div></div>
      <div class="row" style="margin-top:.7rem;justify-content:flex-end"><button class="btn danger" data-rev="${i}" data-ok="0">Reject</button><button class="btn primary" data-rev="${i}" data-ok="1">Verify</button></div></section>`).join('') || '<div class="card empty">No training records waiting.</div>'}`,
    mount(root) {
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-rev]');
        if (!b) return;
        const x = items[b.dataset.rev];
        const approve = b.dataset.ok === '1';
        const ok = await dialog({
          title: `${approve ? 'Verify' : 'Reject'} ${x.credential.typeName}`, submitLabel: approve ? 'Verify record' : 'Reject record', danger: !approve,
          body: `<p>${approve ? 'Confirm you have checked this against the training register.' : 'Tell the person what is wrong so they can fix it.'}</p><div class="field"><label for="vn">Note to ${esc(x.user.name)}</label><textarea id="vn" name="note">${approve ? 'Matched against the training register.' : ''}</textarea></div>`,
          onSubmit: (f) => api('POST', `/credentials/${x.user.id}/${x.credential.id}/review`, { approve, note: f.note.value }),
        });
        if (ok) { toast(approve ? 'Verified' : 'Rejected', 'ok'); S.refresh(); }
      });
    },
  };
}

function incidentTable(list) {
  return `<div class="table-wrap"><table class="t"><thead><tr><th>Ref</th><th>Type</th><th>Resource</th><th>Severity</th><th>Status</th><th>Opened</th></tr></thead><tbody>
    ${list.map((i) => `<tr><td><a href="#/incident/${i.id}"><b>${esc(i.ref)}</b></a>${i.booking ? `<br><small>${esc(i.booking.ref)}</small>` : ''}</td><td>${esc(S.meta.incidentTypes[i.type])}<br><small class="muted">${esc(i.source === 'system' ? 'Detected automatically' : `by ${i.reportedByName}`)}</small></td>
      <td>${esc(i.resource.name)}</td><td>${sevBadge(i.severity)}</td><td>${badge(i.status)}</td><td>${rel(i.createdAt)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No incidents.</td></tr>'}
  </tbody></table></div>`;
}
async function incidentsTab() {
  const { incidents } = await api('GET', '/incidents');
  const open = incidents.filter((i) => ['open', 'disputed'].includes(i.status));
  return { html: `<section class="card"><h2>Needs a decision (${open.length})</h2>${incidentTable(open)}</section><section class="card"><h2>Resolved</h2>${incidentTable(incidents.filter((i) => !open.includes(i)))}</section>` };
}

export async function viewIncidents() {
  const { incidents } = await api('GET', '/incidents');
  return { title: 'Incidents', html: `<div class="page-head"><div><h1>Incidents</h1><p>Damage, delays, no-shows and safety reports involving you.</p></div></div><section class="card">${incidentTable(incidents)}</section>` };
}

async function listings() {
  const { resources } = await api('GET', '/resources?mine=1');
  return {
    html: `<div class="res-grid">${resources.map((r) => `<div class="card stack">
      <div class="row" style="flex-wrap:nowrap"><div class="thumb">${art(r)}</div><div><b>${esc(r.name)}</b><div class="muted" style="font-size:.84rem">${esc(r.org.short)} · ${r.approvalMode === 'auto' ? 'Instant approval' : 'Owner review'}</div></div></div>
      <div class="row"><span class="badge ${r.status === 'active' ? 'ok' : 'warn'}">${esc(r.status)}</span><span class="muted" style="font-size:.84rem">${r.demand.upcoming} upcoming · ${r.demand.pending} pending · ${r.demand.waitlist} waiting</span></div>
      <div class="row"><a class="btn small" href="#/resource/${r.id}">View</a>${r.canEdit ? `<a class="btn small" href="#/listing/${r.id}/edit">Edit conditions</a>` : ''}
        <button class="btn small" data-status="${r.id}" data-to="${r.status === 'active' ? 'maintenance' : 'active'}">${r.status === 'active' ? 'Pause for maintenance' : 'Reopen for booking'}</button></div></div>`).join('')}</div>`,
    mount(root) {
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-status]');
        if (!b) return;
        const ok = await dialog({
          title: b.dataset.to === 'active' ? 'Reopen resource' : 'Pause for maintenance', submitLabel: 'Save',
          body: '<div class="field"><label for="sr">Reason (recorded in the audit history)</label><input id="sr" name="reason" type="text"></div>',
          onSubmit: (f) => api('POST', `/resources/${b.dataset.status}/status`, { status: b.dataset.to, reason: f.reason.value }),
        });
        if (ok) { toast('Status updated', 'ok'); S.refresh(); }
      });
    },
  };
}

async function insights() {
  const [{ stats }, { flags }] = await Promise.all([api('GET', '/manage/overview'), api('GET', '/flags')]);
  return {
    html: `<section class="card"><h2>Usage patterns to review</h2><p class="muted" style="font-size:.86rem">Explainable rules surface patterns that might mean misuse or unfair hoarding. They never act on their own — each is a prompt for a person to look.</p>
      ${flags.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Person</th><th>Pattern</th><th>Evidence</th><th>Suggested next step</th></tr></thead><tbody>${flags.map((f) => `<tr><td><b>${esc(f.userName)}</b></td><td>${sevBadge(f.severity)} ${esc(f.kind)}</td><td>${esc(f.evidence)}</td><td class="muted">${esc(f.suggestion)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No patterns flagged.</p>'}</section>
      ${stats.map((s) => `<section class="card"><div class="row between"><h2 style="margin:0">${esc(s.name)}</h2><div class="row">${s.highDemand ? '<span class="badge warn">High demand</span>' : ''}<span class="badge outline">${esc(s.status)}</span></div></div><div style="margin-top:.7rem">${statsGrid(s)}</div></section>`).join('')}`,
  };
}

// ---------------- Listing editor ----------------
export async function viewListingEditor({ id }) {
  const r = id ? (await api('GET', `/resources/${id}`)).resource : null;
  const orgs = S.me.role === 'admin' ? (await api('GET', '/orgs')).orgs : S.orgs;
  const v = r || { name: '', icon: '📦', category: 'equipment', description: '', location: '', building: '', capacity: '', value: 0, loan: false, riskLevel: 'low', approvalMode: 'manual', highDemand: false, tags: [], requirements: { credentials: [], affiliations: ['student', 'researcher', 'staff'], supervision: false, deposit: 0, minLeadHours: 0, maxHours: 3, weeklyCapHours: 6, maxAdvanceDays: 14, reviewAffiliations: ['community'] }, availability: { days: [1, 2, 3, 4, 5], open: '09:00', close: '17:00' }, rules: [], checklist: [] };
  const rq = v.requirements;
  const chk = (name, value, on, label) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(value)}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;
  return {
    title: r ? 'Edit listing' : 'New listing',
    html: `<p><a href="#/manage/listings">← Listings</a></p><div class="page-head"><div><h1>${r ? `Edit ${esc(r.name)}` : 'List a resource'}</h1><p>You decide who can use it, under which conditions. Changes are recorded in the audit history.</p></div></div>
    <form id="lf" class="grid cols-2" novalidate>
      <section class="card"><h2>What is it?</h2>
        <div class="inline-fields"><div class="field" style="grid-column:span 2"><label for="ln">Name</label><input id="ln" name="name" type="text" value="${esc(v.name)}" required></div><div class="field"><label for="li">Icon</label><input id="li" name="icon" type="text" value="${esc(v.icon)}" maxlength="4"></div></div>
        ${r ? '' : `<div class="field"><label for="lo">Owner organisation</label><select id="lo" name="orgId">${orgs.filter((o) => o.verified).map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div>`}
        <div class="inline-fields"><div class="field"><label for="lc">Type</label><select id="lc" name="category">${['equipment', 'space', 'computing'].map((c) => `<option ${v.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="field"><label for="lr">Risk level</label><select id="lr" name="riskLevel">${['low', 'medium', 'high'].map((c) => `<option ${v.riskLevel === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="field"><label for="lv">Replacement value (₹)</label><input id="lv" name="value" type="number" min="0" value="${v.value}"></div></div>
        <div class="field"><label for="ld">Description</label><textarea id="ld" name="description">${esc(v.description)}</textarea></div>
        <div class="inline-fields"><div class="field"><label for="ll">Location</label><input id="ll" name="location" type="text" value="${esc(v.location)}"></div><div class="field"><label for="lb">Building</label><input id="lb" name="building" type="text" value="${esc(v.building)}"></div><div class="field"><label for="lcap">Capacity (people)</label><input id="lcap" name="capacity" type="number" min="1" value="${esc(v.capacity ?? '')}"></div></div>
        <div class="field"><label for="lt">Tags <span class="hint">one per line — used for search and matching</span></label><textarea id="lt" name="tags">${esc(v.tags.join('\n'))}</textarea></div>
        ${chk('loan', '1', v.loan, 'Borrowed and taken away (pick-up & return at a desk)')}
      </section>
      <section class="card"><h2>Who can use it?</h2>
        <div class="field"><label>Eligible user groups</label>${Object.entries(S.meta.affiliations).map(([k, l]) => chk('aff', k, rq.affiliations.includes(k), l)).join('')}</div>
        <div class="field"><label>Groups needing institutional approval</label>${Object.entries(S.meta.affiliations).map(([k, l]) => chk('raff', k, rq.reviewAffiliations.includes(k), l)).join('')}</div>
        <div class="field"><label>Required training</label>${Object.entries(S.meta.credTypes).map(([k, c]) => chk('cred', k, rq.credentials.includes(k), c.name)).join('')}</div>
        ${chk('supervision', '1', rq.supervision, 'Staff must supervise on site (sign-off at check-in)')}
        <div class="field" style="margin-top:.6rem"><label for="ldep">Refundable deposit (₹)</label><input id="ldep" name="deposit" type="number" min="0" value="${rq.deposit}"></div>
        <div class="field"><label for="lap">Approval</label><select id="lap" name="approvalMode"><option value="manual" ${v.approvalMode === 'manual' ? 'selected' : ''}>I review every request</option><option value="auto" ${v.approvalMode === 'auto' ? 'selected' : ''}>Instant approval when every check passes</option></select></div>
      </section>
      <section class="card"><h2>When & how much?</h2>
        <div class="field"><label>Available days</label><div class="row">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => chk('day', i, v.availability.days.includes(i), d)).join('')}</div></div>
        <div class="inline-fields"><div class="field"><label for="lop">Opens</label><input id="lop" name="open" type="time" value="${v.availability.open}"></div><div class="field"><label for="lcl">Closes</label><input id="lcl" name="close" type="text" pattern="\\d{2}:\\d{2}" value="${v.availability.close}"></div></div>
        <div class="inline-fields"><div class="field"><label for="lmh">Max hours per booking</label><input id="lmh" name="maxHours" type="number" step="0.5" value="${rq.maxHours}"></div>
          <div class="field"><label for="lwc">Weekly cap per person (h)</label><input id="lwc" name="weeklyCapHours" type="number" step="0.5" value="${rq.weeklyCapHours}"></div>
          <div class="field"><label for="llead">Notice needed (h)</label><input id="llead" name="minLeadHours" type="number" value="${rq.minLeadHours}"></div>
          <div class="field"><label for="lad">Book up to (days ahead)</label><input id="lad" name="maxAdvanceDays" type="number" value="${rq.maxAdvanceDays}"></div></div>
        ${chk('highDemand', '1', v.highDemand, 'High demand — limit to one upcoming booking per person')}
      </section>
      <section class="card"><h2>Rules & condition checklist</h2>
        <div class="field"><label for="lru">Usage rules <span class="hint">one per line</span></label><textarea id="lru" name="rules" style="min-height:110px">${esc(v.rules.join('\n'))}</textarea></div>
        <div class="field"><label for="lck">Condition checklist <span class="hint">one item per line — recorded at check-in and return</span></label><textarea id="lck" name="checklist" style="min-height:110px">${esc(v.checklist.join('\n'))}</textarea></div>
        <div class="alert danger" id="lerr" hidden></div>
        <button class="btn primary" style="width:100%">${r ? 'Save changes' : 'Publish listing'}</button>
      </section>
    </form>`,
    mount(root) {
      const f = root.querySelector('#lf');
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        const all = (n) => fd.getAll(n);
        const body = {
          name: fd.get('name'), icon: fd.get('icon'), orgId: fd.get('orgId'), category: fd.get('category'), riskLevel: fd.get('riskLevel'), value: fd.get('value'),
          description: fd.get('description'), location: fd.get('location'), building: fd.get('building'), capacity: fd.get('capacity'), tags: fd.get('tags'),
          loan: fd.get('loan') === '1', approvalMode: fd.get('approvalMode'), highDemand: fd.get('highDemand') === '1',
          requirements: { affiliations: all('aff'), reviewAffiliations: all('raff'), credentials: all('cred'), supervision: fd.get('supervision') === '1', deposit: fd.get('deposit'), maxHours: fd.get('maxHours'), weeklyCapHours: fd.get('weeklyCapHours'), minLeadHours: fd.get('minLeadHours'), maxAdvanceDays: fd.get('maxAdvanceDays') },
          availability: { days: all('day').map(Number), open: fd.get('open'), close: fd.get('close') },
          rules: fd.get('rules'), checklist: fd.get('checklist'),
        };
        try {
          const res = await api(r ? 'PUT' : 'POST', r ? `/resources/${r.id}` : '/resources', body);
          toast(r ? 'Listing updated' : 'Resource listed — it is now discoverable', 'ok');
          location.hash = `#/resource/${res.resource.id}`;
        } catch (ex) { const el = root.querySelector('#lerr'); el.textContent = ex.message; el.hidden = false; }
      });
    },
  };
}

// ---------------- Incident detail ----------------
export async function viewIncident({ id }) {
  const { incident: i, timeline } = await api('GET', `/incidents/${id}`);
  const b = i.booking;
  const res = S.meta.resolutions;
  const condRows = b?.checkIn ? b.checkIn.items.map((a, k) => {
    const z = b.checkOut?.items[k];
    return `<tr class="${a.ok && z && !z.ok ? 'cond-new' : ''}"><td>${esc(a.label)}</td><td>${a.ok ? '<span class="cond-ok">OK</span>' : `<span class="cond-bad">Issue</span> ${esc(a.note)}`}</td><td>${z ? (z.ok ? '<span class="cond-ok">OK</span>' : `<span class="cond-bad">Issue</span> ${esc(z.note)}`) : '—'}</td></tr>`;
  }).join('') : '';
  return {
    title: i.ref,
    html: `<p><a href="${isStaff() ? '#/manage/incidents' : '#/incidents'}">← Incidents</a></p>
    <div class="page-head"><div><h1>${esc(i.ref)} · ${esc(S.meta.incidentTypes[i.type])}</h1><p>${esc(i.resource.name)}${b ? ` · <a href="#/booking/${b.id}">${esc(b.ref)}</a>` : ''} · opened ${fmtDT(i.createdAt)} ${i.source === 'system' ? 'automatically by the rules engine' : `by ${esc(i.reportedByName)}`}</p></div><div class="row">${sevBadge(i.severity)}${badge(i.status)}</div></div>
    <div class="split"><div class="stack">
      <section class="card"><h2>What was reported</h2><p>${esc(i.description)}</p>${photosHtml(i.photos)}
        ${i.subject ? `<p class="muted">Person involved: <b>${esc(i.subject.name)}</b> (${esc(S.meta.affiliations[i.subject.affiliation])})</p>` : ''}</section>
      ${isStaff() ? `<section class="card ai-card"><div class="ai-label">Triage assistant · ${i.ai.source === 'claude' ? 'Claude (AI)' : 'rule-based'} · advisory — a person decides</div>
        <p style="margin:.4rem 0"><b>${esc(i.ai.summary)}</b></p><p style="margin:0">Suggested severity: ${sevBadge(i.ai.suggestedSeverity)}</p>
        <div class="grid cols-2" style="margin-top:.5rem"><div><b style="font-size:.86rem">Facts from the records</b><ul style="margin:.2rem 0;padding-left:1.1rem;font-size:.86rem">${i.ai.keyFacts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div><b style="font-size:.86rem">Suggested next steps</b><ul style="margin:.2rem 0;padding-left:1.1rem;font-size:.86rem">${i.ai.suggestedActions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div></section>` : ''}
      ${condRows ? `<section class="card"><h2>Condition: check-in vs return</h2><div class="table-wrap"><table class="t"><thead><tr><th>Item</th><th>Check-in</th><th>Return</th></tr></thead><tbody>${condRows}</tbody></table></div>
        <div class="grid cols-2" style="margin-top:.5rem"><div>${photosHtml(b.checkIn.photos)}</div><div>${photosHtml(b.checkOut?.photos)}</div></div>
        ${b.inspection ? `<p class="muted" style="margin-top:.5rem">Inspection by ${esc(b.inspection.byName)}: ${esc(b.inspection.notes)}</p>` : ''}</section>` : ''}
      ${i.resolution ? `<section class="alert ${i.resolution.action === 'no_action' ? 'ok' : 'warn'}"><strong>Decision: ${esc(res[i.resolution.action])}${i.resolution.reviewOfDispute ? ' (after dispute review)' : ''}</strong>${esc(i.resolution.notes)}
        <div style="font-size:.84rem;margin-top:.3rem">${i.resolution.applied.map(esc).join(' · ')}</div><div class="muted" style="font-size:.8rem">${esc(i.resolution.byName)} · ${fmtDT(i.resolution.at)}</div></section>` : ''}
      <section class="card"><h2>Statements</h2>${i.thread.length ? i.thread.map((m) => `<div style="padding:.5rem 0;border-bottom:1px solid var(--border)"><b>${esc(m.byName)}</b> <span class="muted" style="font-size:.8rem">${esc(roleLabel(m.role))} · ${fmtDT(m.at)}</span>${m.dispute ? ' <span class="badge danger">Dispute</span>' : ''}<div>${esc(m.text)}</div></div>`).join('') : '<p class="muted">No statements yet.</p>'}
        <form id="say" style="margin-top:.7rem"><div class="field"><label for="msg">Add a statement</label><textarea id="msg" name="message" placeholder="Your side of what happened"></textarea></div>
        <div class="row"><button class="btn">Add statement</button>${i.canDispute ? '<button type="button" class="btn danger" id="dispute">Dispute this decision</button>' : ''}</div></form></section>
      <section class="card"><h2>History</h2>${timelineHtml(timeline)}</section>
    </div>
    <aside class="stack">${i.canResolve ? `<section class="card"><h2>${i.status === 'disputed' ? 'Review the dispute' : 'Decide'}</h2>
      ${i.proposedAction ? `<div class="alert info" style="margin-bottom:.6rem"><strong>Rules engine proposes: ${esc(res[i.proposedAction])}</strong>This is only a proposal — confirm, change or waive it.</div>` : ''}
      <form id="resolve"><div class="field"><label for="ra">Outcome</label><select id="ra" name="action">${Object.entries(res).map(([k, v]) => `<option value="${k}" ${k === (i.proposedAction || 'no_action') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="field" id="amt" hidden><label for="ram">Amount to deduct (max ${money(b?.deposit?.amount || 0)})</label><input id="ram" name="amount" type="number" min="1" max="${b?.deposit?.amount || 0}"></div>
        <div class="field"><label for="rn">Explanation to the people involved</label><textarea id="rn" name="notes" placeholder="What you looked at and why you decided this"></textarea></div>
        <button class="btn primary" style="width:100%">Record decision</button></form>
      <p class="muted" style="font-size:.8rem;margin-top:.6rem">The person involved is notified with your explanation and can dispute it; disputes go to a platform admin.</p></section>` : ''}
      ${b?.deposit ? `<section class="card"><h3>Deposit</h3><p>${money(b.deposit.amount)} · ${esc(b.deposit.status.replaceAll('_', ' '))}</p></section>` : ''}
    </aside></div>`,
    mount(root) {
      const rf = root.querySelector('#resolve');
      if (rf) {
        const sync = () => { root.querySelector('#amt').hidden = rf.action.value !== 'deposit_deduction'; };
        rf.action.addEventListener('change', sync); sync();
        rf.addEventListener('submit', async (e) => {
          e.preventDefault();
          try { await api('POST', `/incidents/${i.id}/resolve`, { action: rf.action.value, notes: rf.notes.value, amount: rf.amount.value }); toast('Decision recorded', 'ok'); S.refresh(); } catch (ex) { toast(ex.message, 'danger'); }
        });
      }
      const say = root.querySelector('#say');
      const send = async (dispute) => {
        try { await api('POST', `/incidents/${i.id}/respond`, { message: say.message.value, dispute }); toast(dispute ? 'Dispute sent to an administrator' : 'Statement added', 'ok'); S.refresh(); } catch (ex) { toast(ex.message, 'danger'); }
      };
      say.addEventListener('submit', (e) => { e.preventDefault(); send(false); });
      root.querySelector('#dispute')?.addEventListener('click', () => send(true));
    },
  };
}

// ---------------- Admin ----------------
export async function viewAdmin({ tab = 'people' }) {
  const T = { people: ['People & roles', 'Verify identities, assign roles and restrict access — every change needs a reason.'], flags: ['Usage flags', 'Explainable patterns that may need a person to look. Nothing here acts on its own.'], orgs: ['Organisations', 'Only verified organisations can list resources.'] }[tab] || ['Administration', ''];
  const head = `<div class="page-head"><div><span class="eyebrow">Platform administration</span><h1>${T[0]}</h1><p>${T[1]}</p></div><a class="btn" href="#/activity">Audit log</a></div>`;
  if (tab === 'flags') {
    const { flags } = await api('GET', '/flags');
    return { title: 'Admin', html: `${head}<section class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Person</th><th>Pattern</th><th>Evidence</th><th>Suggestion</th></tr></thead><tbody>${flags.map((f) => `<tr><td>${esc(f.userName)}</td><td>${sevBadge(f.severity)} ${esc(f.kind)}</td><td>${esc(f.evidence)}</td><td class="muted">${esc(f.suggestion)}</td></tr>`).join('')}</tbody></table></div></section>` };
  }
  const { users, orgs } = await api('GET', '/admin/users');
  if (tab === 'orgs') {
    return { title: 'Admin', html: `${head}<section class="card"><table class="t"><thead><tr><th>Organisation</th><th>Type</th><th>Status</th></tr></thead><tbody>${orgs.map((o) => `<tr><td>${esc(o.name)}</td><td>${esc(o.type)}</td><td>${o.verified ? `<span class="badge ok">Verified by ${esc(o.verifiedBy)}</span>` : '<span class="badge warn">Unverified</span>'}</td></tr>`).join('')}</tbody></table>
      <p class="muted" style="margin-top:.6rem;font-size:.86rem">Only verified organisations can list resources, and their owners see a “verified owner” mark on every listing.</p></section>` };
  }
  return {
    title: 'Admin',
    html: `${head}<section class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Person</th><th>Role</th><th>Identity</th><th>Access</th><th>Training</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td><b>${esc(u.name)}</b><br><small>${esc(u.email)} · ${esc(S.meta.affiliations[u.affiliation])}</small></td>
        <td>${esc(roleLabel(u.role))}${u.orgIds.length ? `<br><small>${u.orgIds.map((o) => esc(orgs.find((x) => x.id === o)?.short)).join(', ')}</small>` : ''}</td>
        <td>${u.verified ? '<span class="badge ok">Verified</span>' : '<span class="badge danger">Unverified</span>'}</td>
        <td>${u.status === 'active' ? '<span class="badge ok">Active</span>' : '<span class="badge danger">Restricted</span>'}${u.strikes ? ` <span class="badge warn">${u.strikes} strike</span>` : ''}</td>
        <td style="font-size:.8rem">${u.credentials.map((c) => `${esc(c.typeName)} ${badge(c.status === 'rejected' ? 'rejected' : c.status)}`).join('<br>') || '—'}</td>
        <td><div class="row" style="justify-content:flex-end">${!u.verified ? `<button class="btn small primary" data-u="${u.id}" data-a="verify">Verify ID</button>` : ''}
          ${u.id !== S.me.id ? `<button class="btn small" data-u="${u.id}" data-a="${u.status === 'active' ? 'restrict' : 'unrestrict'}">${u.status === 'active' ? 'Restrict' : 'Restore'}</button><button class="btn small" data-u="${u.id}" data-a="role">Role</button>` : ''}
          ${u.strikes ? `<button class="btn small" data-u="${u.id}" data-a="clear_strike">Clear strike</button>` : ''}</div></td></tr>`).join('')}
    </tbody></table></div></section>`,
    mount(root) {
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const u = users.find((x) => x.id === b.dataset.u);
        const a = b.dataset.a;
        const body = a === 'verify'
          ? `<p>Confirm you have checked an official ID for <b>${esc(u.name)}</b>. Only the method is stored — never the document itself.</p><div class="field"><label for="m">Method</label><select id="m" name="method"><option>Photo ID</option><option>University ID card</option><option>Partner organisation letter</option></select></div>`
          : a === 'role'
            ? `<div class="field"><label for="ro">Role</label><select id="ro" name="role">${['member', 'manager', 'owner', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}</select></div>
               <div class="field"><label>Organisations (for owners & managers)</label>${orgs.map((o) => `<label class="check"><input type="checkbox" name="org" value="${o.id}" ${u.orgIds.includes(o.id) ? 'checked' : ''}> ${esc(o.name)}</label>`).join('')}</div>
               <div class="field"><label for="rs">Reason</label><input id="rs" name="reason" type="text"></div>`
            : `<div class="field"><label for="rs">Reason (shown to ${esc(u.name)} and recorded)</label><textarea id="rs" name="reason"></textarea></div>`;
        const ok = await dialog({
          title: { verify: 'Verify identity', restrict: 'Restrict booking access', unrestrict: 'Restore booking access', role: `Change role for ${u.name}`, clear_strike: 'Clear a strike' }[a],
          submitLabel: 'Confirm', danger: a === 'restrict', body,
          onSubmit: (f) => api('POST', `/admin/users/${u.id}`, { action: a, method: f.method?.value, role: f.role?.value, orgIds: [...f.querySelectorAll('[name=org]:checked')].map((x) => x.value), reason: f.reason?.value }),
        });
        if (ok) { toast('Saved', 'ok'); S.refresh(); }
      });
    },
  };
}
