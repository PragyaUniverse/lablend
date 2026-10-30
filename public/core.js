// Shared client state, API access, formatting and UI helpers.
export const S = { me: null, orgs: [], meta: null, skew: 0, unread: 0 };

export async function api(method, path, body) {
  const opt = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(`/api${path}`, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || `Request failed (${r.status})`);
    e.status = r.status; e.data = data;
    if (r.status === 401 && !path.startsWith('/auth') && path !== '/me') { S.me = null; location.hash = '#/login'; }
    throw e;
  }
  return data;
}

export async function loadMeta() {
  S.meta = await api('GET', '/meta');
  S.skew = S.meta.now - Date.now();
}
export const nowMs = () => Date.now() + S.skew;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const tz = () => S.meta?.tz || 'Asia/Kolkata';
const fmtCache = {};
const F = (key, opts) => (fmtCache[key + tz()] ||= new Intl.DateTimeFormat('en-IN', { timeZone: tz(), ...opts }));
export const fmtDT = (ms) => F('dt', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
export const fmtTime = (ms) => F('t', { hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
export const fmtDay = (ms) => F('d', { weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
export function fmtRange(a, b) {
  return wall(a).date === wall(b - 1).date ? `${fmtDT(a)}–${fmtTime(b)}` : `${fmtDT(a)} → ${fmtDT(b)}`;
}
export function wall(ms) {
  const p = Object.fromEntries(F('w', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
export function rel(ms) {
  const d = ms - nowMs();
  const a = Math.abs(d);
  const m = Math.round(a / 60000);
  const s = m < 60 ? `${m} min` : m < 60 * 36 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 1440)} days`;
  return d >= 0 ? `in ${s}` : `${s} ago`;
}
export const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
export const initials = (name) => String(name).replace(/^Dr\.\s*/, '').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

export const STATUS = {
  pending: ['Awaiting review', 'info'], approved: ['Approved', 'ok'], waitlisted: ['Waitlisted', 'warn'], rejected: ['Not approved', 'danger'],
  cancelled: ['Cancelled', ''], checked_in: ['In use', 'primary'], returned: ['Returned · inspection due', 'warn'], completed: ['Completed', 'ok'],
  no_show: ['No-show', 'danger'], expired: ['Expired', ''],
  open: ['Open', 'warn'], resolved: ['Resolved', 'ok'], disputed: ['Disputed', 'danger'], closed: ['Closed', ''],
  verified: ['Verified', 'ok'], missing: ['Missing', 'danger'],
};
export function badge(status, extra = '') {
  const [label, kind] = STATUS[status] || [status, ''];
  return `<span class="badge ${kind}">${esc(label)}${extra}</span>`;
}
export const sevBadge = (s) => `<span class="badge ${{ low: '', medium: 'warn', high: 'danger', critical: 'danger' }[s] || ''}">${esc(s)}</span>`;
export const roleLabel = (r) => ({ member: 'Member', owner: 'Resource owner', manager: 'Lab manager', admin: 'Platform admin', system: 'System' }[r] || r);

export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, kind === 'danger' ? 7000 : 4200);
}

export const isStaff = () => ['owner', 'manager', 'admin'].includes(S.me?.role);

// Generic dialog. `body` is HTML; onSubmit receives the form element and may throw to keep it open.
export function dialog({ title, body, submitLabel = 'Save', danger = false, onSubmit, onMount, wide = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    if (wide) d.style.width = 'min(860px, calc(100vw - 2rem))';
    d.innerHTML = `<form method="dialog" novalidate>
      <div class="dlg-head"><h2>${esc(title)}</h2><button type="button" class="btn ghost small" data-close aria-label="Close">✕</button></div>
      <div class="dlg-body">${body}<div class="alert danger" data-err hidden></div></div>
      <div class="dlg-foot"><button type="button" class="btn" data-close>Cancel</button>${onSubmit ? `<button class="btn ${danger ? 'danger' : 'primary'}" data-submit>${esc(submitLabel)}</button>` : ''}</div>
    </form>`;
    document.body.append(d);
    const form = d.querySelector('form');
    const close = (v) => { d.classList.add('closing'); setTimeout(() => { d.close(); d.remove(); }, 140); resolve(v); };
    d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = d.querySelector('[data-submit]');
      const err = d.querySelector('[data-err]');
      btn.disabled = true; err.hidden = true;
      try { const v = await onSubmit(form); close(v ?? true); } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    });
    d.showModal();
    onMount?.(d);
  });
}

export function confirmReason({ title, intro = '', templates = [], submitLabel, danger, required = true, placeholder = 'Explain the decision…' }) {
  return dialog({
    title, submitLabel, danger,
    body: `${intro ? `<p>${intro}</p>` : ''}
      ${templates.length ? `<div class="field"><label>Quick reasons</label><div class="row">${templates.map((t) => `<button type="button" class="btn small" data-tpl="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>` : ''}
      <div class="field"><label for="reason">Reason ${required ? '' : '<span class="hint">(optional)</span>'}</label><textarea id="reason" name="reason" placeholder="${esc(placeholder)}"></textarea>
      <div class="hint">The requester sees this exact text, and it is stored in the audit history.</div></div>`,
    onMount: (d) => d.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => { d.querySelector('#reason').value = b.dataset.tpl; })),
    onSubmit: (f) => {
      const v = f.reason.value.trim();
      if (required && v.length < 5) throw new Error('Please write a reason (at least 5 characters).');
      return { reason: v };
    },
  });
}

export async function fileToDataUrl(file, max = 900) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}
export async function readPhotos(input) {
  const files = [...(input?.files || [])].slice(0, 3);
  return Promise.all(files.map((f) => fileToDataUrl(f)));
}
export const photosHtml = (list) => (list?.length ? `<div class="photos">${list.map((p, i) => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(p)}" alt="Condition photo ${i + 1}"></a>`).join('')}</div>` : '');

const ICON = { pass: '✓', fail: '✕', warn: '!', info: 'i' };
export function checksHtml(checks) {
  return `<ul class="checks">${checks.map((c) => `<li class="${c.status}"><span class="ic" aria-label="${c.status}">${ICON[c.status]}</span><div><div class="lbl">${esc(c.label)}</div><div class="det">${esc(c.detail)}</div>${c.fix ? `<div class="fix">How to fix: ${esc(c.fix)}</div>` : ''}</div></li>`).join('')}</ul>`;
}
export function breakdownHtml(pr) {
  return `<table class="breakdown">${pr.breakdown.map((b) => `<tr><td>${esc(b.label)}</td><td>${b.points > 0 ? '+' : ''}${b.points}</td></tr>`).join('')}<tr><td><b>Priority score</b></td><td>${pr.score}</td></tr></table>`;
}
export function timelineHtml(entries, newestFirst = false) {
  if (!entries?.length) return '<p class="muted">No activity yet.</p>';
  return `<ul class="timeline">${entries.slice().sort((a, b) => (newestFirst ? b.seq - a.seq : a.seq - b.seq)).map((e) => `<li class="${e.actorRole === 'system' ? 'sys' : ''}">
    <div class="when">${fmtDT(e.at)} · ${esc(e.actorName)} <span class="badge outline">${esc(roleLabel(e.actorRole))}</span></div>
    <div>${esc(e.summary)}</div>
    ${e.details?.reason || e.details?.notes ? `<div class="muted" style="font-size:.84rem">“${esc(e.details.reason || e.details.notes)}”</div>` : ''}
    <div class="hash" title="SHA-256 of this entry, chained to the previous one">#${e.seq} · ${e.hash.slice(0, 12)}… ← ${e.prevHash.slice(0, 8)}</div></li>`).join('')}</ul>`;
}
