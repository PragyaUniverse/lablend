import { S, api, loadMeta, esc, fmtDT, rel, initials, roleLabel, toast, isStaff, nowMs } from './core.js';
import { viewDiscover, viewResource, viewBookings, viewBooking, viewProfile, viewFairness, viewActivity, bookingRow, resCard } from './member.js';
import { viewManage, viewIncidents, viewIncident, viewListingEditor, viewAdmin } from './staff.js';
import { viewLanding } from './landing.js';
import { icon } from './icons.js';
import { art } from './art.js';

let demoAccounts = null;
let cleanup = [];
let counts = {};

const ROUTES = [
  [/^welcome$/, viewLanding, { public: true, bare: true }],
  [/^login$/, viewLogin, { public: true, bare: true }],
  [/^(home)?$/, viewHome],
  [/^discover/, viewDiscover],
  [/^resource\/([\w-]+)$/, (m) => viewResource({ id: m[1] })],
  [/^bookings$/, viewBookings],
  [/^booking\/([\w-]+)$/, (m) => viewBooking({ id: m[1] })],
  [/^profile$/, viewProfile],
  [/^fairness$/, viewFairness],
  [/^activity$/, viewActivity],
  [/^incidents$/, viewIncidents],
  [/^incident\/([\w-]+)$/, (m) => viewIncident({ id: m[1] })],
  [/^manage(?:\/(\w+))?$/, (m) => viewManage({ tab: m[1] })],
  [/^listing\/new$/, () => viewListingEditor({})],
  [/^listing\/([\w-]+)\/edit$/, (m) => viewListingEditor({ id: m[1] })],
  [/^admin(?:\/(\w+))?$/, (m) => viewAdmin({ tab: m[1] })],
];

let lastPath = null;
async function render() {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  const main = document.getElementById('main');
  if (!S.me && path === '') { location.hash = '#/welcome'; return; }
  const route = ROUTES.find(([re]) => re.test(path));
  if (!route) { location.hash = S.me ? '#/home' : '#/welcome'; return; }
  if (!route[2]?.public && !S.me) { location.hash = '#/login'; return; }
  if (path === 'login' && S.me) { location.hash = '#/home'; return; }
  cleanup.forEach((fn) => fn()); cleanup = [];
  const bare = !!route[2]?.bare;
  document.body.classList.toggle('app', !bare);
  document.body.classList.toggle('public', bare);
  document.body.classList.remove('drawer');
  chrome(bare);
  dock();
  const samePage = lastPath === path;
  lastPath = path;
  if (!samePage) main.innerHTML = '<div class="skeleton" aria-label="Loading"><i></i><i></i><i></i></div>';
  try {
    const view = await route[1](path.match(route[0]));
    document.title = `${view.title} · LabLend`;
    const el = document.createElement('div');
    el.innerHTML = view.html;
    if (samePage) el.style.animation = 'none';
    main.replaceChildren(el);
    if (!samePage) window.scrollTo({ top: 0, behavior: 'instant' });
    const off = view.mount?.(el);
    if (typeof off === 'function') cleanup.push(off);
    observeReveals(el);
  } catch (ex) {
    if (ex.status === 401) return;
    main.innerHTML = `<div class="empty"><b>Something went wrong</b><p>${esc(ex.message)}</p><a class="btn" href="#/home">Go home</a></div>`;
  }
  refreshCounts();
}
S.refresh = async () => { await loadMeta(); render(); };

function observeReveals(root) {
  const items = root.querySelectorAll('.reveal, [data-count], .flow > div, .scorebars');
  if (!items.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      if (e.target.dataset.count) countUp(e.target);
      io.unobserve(e.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
  items.forEach((x) => io.observe(x));
  cleanup.push(() => io.disconnect());
}
function countUp(el) {
  const to = Number(el.dataset.count);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !to) { el.textContent = to.toLocaleString('en-IN'); return; }
  const t0 = performance.now();
  setTimeout(() => { el.textContent = to.toLocaleString('en-IN'); }, 1250); // guarantees the final value even if frames are throttled
  const step = (t) => {
    const p = Math.min(1, (t - t0) / 1100);
    el.textContent = Math.round(to * (1 - (1 - p) ** 3)).toLocaleString('en-IN');
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------- Theme ----------------
export const themeToggle = (cls = 'icon-btn') => `<button class="${cls} theme-toggle" data-theme-toggle aria-label="Switch between light and dark theme" title="Toggle theme"><span class="sun">${icon('sun')}</span><span class="moon">${icon('moon')}</span></button>`;
function setTheme(next) {
  document.body.classList.add('theming');
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('lablend-theme', next); } catch { /* storage blocked */ }
  setTimeout(() => document.body.classList.remove('theming'), 400);
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-theme-toggle]')) setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

// ---------------- Navigation (role-aware) ----------------
function navModel() {
  const r = S.me.role;
  const groups = [{ label: null, items: [['home', 'Home', 'home'], ['discover', 'Discover', 'compass'], ['bookings', 'My bookings', 'calendar', counts.myActive + counts.myRequests]] }];
  if (isStaff()) {
    groups.push({
      label: 'Operations',
      items: [
        ['manage/queue', 'Review queue', 'inbox', counts.queue, true],
        ['manage/active', 'In use & returns', 'wrench', counts.operations, true],
        ['manage/verifications', 'Verifications', 'shield', counts.verifications],
        ['manage/incidents', 'Incidents', 'alert', counts.incidents, true],
      ],
    });
    groups.push({ label: r === 'manager' ? 'Resources' : 'Your resources', items: [['manage/listings', 'Listings', 'box'], ['manage/insights', 'Insights', 'chart']] });
  } else {
    groups[0].items.push(['incidents', 'Incidents', 'alert', counts.incidents]);
  }
  if (r === 'admin') {
    groups.push({ label: 'Platform', items: [['admin/people', 'People & roles', 'users', counts.unverifiedUsers], ['admin/flags', 'Usage flags', 'flag'], ['admin/orgs', 'Organisations', 'building']] });
  }
  groups.push({ label: 'Transparency', items: [['fairness', 'Fair use', 'scale'], ['activity', 'Activity log', 'list']] });
  return groups;
}

function chrome(bare) {
  const el = document.getElementById('chrome');
  if (bare) { el.innerHTML = ''; return; }
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  const isActive = (href) => path === href || (href === 'home' && path === '') || (path.startsWith(`${href}/`) && !['manage', 'admin'].includes(href))
    || (href === 'manage/queue' && path === 'manage') || (href === 'admin/people' && path === 'admin')
    || (href === 'bookings' && path.startsWith('booking/')) || (href === 'discover' && path.startsWith('resource/'))
    || (href === 'manage/incidents' && path.startsWith('incident/')) || (href === 'manage/listings' && path.startsWith('listing/'));
  const link = ([href, label, ic, n, hot]) => `<a class="nav-link ${isActive(href) ? 'active' : ''}" href="#/${href}" ${isActive(href) ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${n ? `<span class="count ${hot ? 'hot' : ''}">${n}</span>` : ''}</a>`;
  el.innerHTML = `
    <header class="appbar">
      <button class="icon-btn" id="openNav" aria-label="Open navigation" aria-controls="side" aria-expanded="false">${icon('menu', 20)}</button>
      <a class="brand" href="#/home"><span class="brand-mark"></span>LabLend</a>
      ${themeToggle()}
      <button class="icon-btn" data-bell aria-label="Notifications">${icon('bell')}<span class="dot" data-unread hidden></span></button>
    </header>
    <div class="scrim" id="scrim"></div>
    <aside class="side" id="side" aria-label="Main navigation">
      <div class="side-top"><a class="brand" href="#/home"><span class="brand-mark"></span>LabLend</a>
        <div class="row" style="gap:2px">${themeToggle()}<button class="icon-btn" data-bell aria-label="Notifications">${icon('bell')}<span class="dot" data-unread hidden></span></button></div></div>
      <nav>${navModel().map((g) => `<div class="nav-group">${g.label ? `<div class="nav-label">${g.label}</div>` : ''}${g.items.map(link).join('')}</div>`).join('')}</nav>
      ${S.me.role === 'owner' || S.me.role === 'admin' ? `<a class="btn small" href="#/listing/new" style="margin:0 var(--s2)">${icon('plus', 16)} List a resource</a>` : ''}
      <div class="side-foot">
        <button class="user-btn" id="userBtn" aria-haspopup="menu" aria-expanded="false"><span class="avatar">${esc(initials(S.me.name))}</span><span class="who"><b>${esc(S.me.name)}</b><span>${esc(roleLabel(S.me.role))}</span></span>${icon('chevron', 16)}</button>
      </div>
    </aside>
    <div class="card drop" id="drop" hidden role="dialog" aria-label="Notifications"></div>`;
  const openBtn = el.querySelector('#openNav');
  const setDrawer = (open) => { document.body.classList.toggle('drawer', open); openBtn.setAttribute('aria-expanded', String(open)); };
  openBtn.addEventListener('click', () => setDrawer(true));
  el.querySelector('#scrim').addEventListener('click', () => setDrawer(false));
  el.querySelectorAll('[data-bell]').forEach((b) => b.addEventListener('click', toggleDrop));
  const userBtn = el.querySelector('#userBtn');
  userBtn.addEventListener('click', () => {
    const foot = el.querySelector('.side-foot');
    const open = foot.querySelector('.menu');
    if (open) { open.remove(); userBtn.setAttribute('aria-expanded', 'false'); return; }
    foot.insertAdjacentHTML('afterbegin', `<div class="menu" role="menu">
      <a role="menuitem" href="#/profile">${icon('user', 16)} Profile & training</a>
      <button role="menuitem" data-theme-toggle>${icon('moon', 16)} Toggle theme</button>
      ${S.meta.demo ? `<button role="menuitem" data-open-dock>${icon('clock', 16)} Demo controls</button>` : ''}
      <hr><button role="menuitem" id="logout">${icon('logout', 16)} Sign out</button></div>`);
    userBtn.setAttribute('aria-expanded', 'true');
    foot.querySelector('#logout').addEventListener('click', logout);
    foot.querySelector('[data-open-dock]')?.addEventListener('click', () => { dockOpen = true; dock(); foot.querySelector('.menu')?.remove(); });
    foot.querySelector('.menu a, .menu button').focus();
  });
}
async function logout() { await api('POST', '/auth/logout', {}); S.me = null; location.hash = '#/welcome'; }
document.addEventListener('click', (e) => {
  const m = document.querySelector('.side-foot .menu');
  if (m && !e.target.closest('.side-foot')) { m.remove(); document.getElementById('userBtn')?.setAttribute('aria-expanded', 'false'); }
  const d = document.getElementById('drop');
  if (d && !d.hidden && !e.target.closest('#drop') && !e.target.closest('[data-bell]')) d.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelector('.side-foot .menu')?.remove();
  const d = document.getElementById('drop'); if (d) d.hidden = true;
  document.body.classList.remove('drawer');
  if (dockOpen) { dockOpen = false; dock(); }
});

async function refreshCounts() {
  if (!S.me) return;
  try {
    const next = await api('GET', '/summary');
    const changed = JSON.stringify(next) !== JSON.stringify(counts);
    counts = next;
    document.querySelectorAll('[data-unread]').forEach((dot) => { dot.hidden = !counts.unread; dot.textContent = counts.unread > 9 ? '9+' : counts.unread; });
    if (changed && document.body.classList.contains('app')) {
      const scroll = document.querySelector('.side')?.scrollTop;
      chrome(false);
      document.querySelectorAll('[data-unread]').forEach((dot) => { dot.hidden = !counts.unread; dot.textContent = counts.unread > 9 ? '9+' : counts.unread; });
      if (scroll) document.querySelector('.side').scrollTop = scroll;
    }
  } catch { /* offline or signed out */ }
}

async function toggleDrop() {
  const d = document.getElementById('drop');
  if (!d.hidden) { d.hidden = true; return; }
  const { notifications } = await api('GET', '/notifications');
  d.innerHTML = `<div class="head"><b>Notifications</b><button class="btn small ghost" id="readAll">Mark all read</button></div>
    ${notifications.map((n) => `<a class="notif ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/home')}" data-n="${n.id}"><span class="k-${esc(n.kind)}"><b>${esc(n.title)}</b></span>${esc(n.body)}<div class="muted" style="font-size:.76rem;margin-top:2px">${rel(n.at)}</div></a>`).join('') || '<div class="empty"><b>You\'re all caught up</b></div>'}`;
  d.hidden = false;
  d.querySelector('#readAll').addEventListener('click', async () => { await api('POST', '/notifications/read', { all: true }); d.hidden = true; refreshCounts(); });
  d.onclick = async (e) => {
    const a = e.target.closest('[data-n]');
    if (!a) return;
    d.hidden = true;
    document.body.classList.remove('drawer');
    await api('POST', '/notifications/read', { ids: [a.dataset.n] });
    refreshCounts();
  };
}

// ---------------- Demo dock ----------------
let dockOpen = false;
function dock() {
  const el = document.getElementById('dock');
  if (!S.me || !S.meta?.demo) { el.innerHTML = ''; return; }
  const off = S.meta.clockOffset;
  el.innerHTML = `<div class="dock">
    ${dockOpen ? `<div class="dock-panel" role="dialog" aria-label="Demo controls">
      <div class="row between"><h3>Demo controls</h3><button class="icon-btn" data-dock-close aria-label="Close">${icon('x', 16)}</button></div>
      <p class="muted" style="font-size:.84rem;margin:var(--s2) 0 0">Reminders, check-in windows, no-shows and overdue returns all run on this clock.</p>
      <div class="clockface">${esc(fmtDT(nowMs()))}</div>
      ${off ? `<span class="badge warn">+${Math.round(off / 60000).toLocaleString('en-IN')} min simulated</span>` : '<span class="badge ok">Real time</span>'}
      <div class="chips"><button class="btn small" data-clock="15">+15 min</button><button class="btn small" data-clock="60">+1 h</button><button class="btn small" data-clock="1440">+1 day</button></div>
      <div class="row"><button class="btn small primary" id="jump" style="flex:1">Jump to my next booking</button>${off ? '<button class="btn small" data-clock="reset">Real time</button>' : ''}</div>
      <div class="section"><label for="persona">Switch persona</label>
        <select id="persona">${(demoAccounts?.accounts || []).map((a) => `<option value="${esc(a.email)}" ${a.email === S.me.email ? 'selected' : ''}>${esc(a.name)} — ${esc(a.persona)}</option>`).join('')}</select></div>
      <div class="section row between"><span class="muted" style="font-size:.82rem">All data is fictional</span><button class="btn small danger" id="reset">Regenerate data</button></div>
    </div>` : ''}
    <button class="dock-btn" data-dock-toggle aria-expanded="${dockOpen}"><span class="pulse"></span>Demo${off ? ` <span class="sim">+${Math.round(off / 3600000)}h</span>` : ''}</button>
  </div>`;
  el.querySelector('[data-dock-toggle]').onclick = () => { dockOpen = !dockOpen; dock(); };
  el.querySelector('[data-dock-close]')?.addEventListener('click', () => { dockOpen = false; dock(); });
  el.querySelectorAll('[data-clock]').forEach((b) => b.addEventListener('click', async () => {
    const v = b.dataset.clock;
    await api('POST', '/demo/clock', v === 'reset' ? { reset: true } : { minutes: Number(v) });
    toast(v === 'reset' ? 'Back to real time' : 'Clock moved — reminders, no-shows and overdue checks ran', 'ok');
    S.refresh();
  }));
  el.querySelector('#jump')?.addEventListener('click', async () => {
    const { bookings } = await api('GET', '/bookings?scope=mine');
    const next = bookings.filter((b) => b.status === 'approved' && b.start > nowMs()).sort((a, b) => a.start - b.start)[0];
    if (!next) { toast('No upcoming approved booking to jump to.', 'danger'); return; }
    await api('POST', '/demo/clock', { to: next.start - 5 * 60000 });
    toast(`Jumped to 5 min before ${next.ref} — check-in is open`, 'ok');
    dockOpen = false;
    location.hash = `#/booking/${next.id}`;
    S.refresh();
  });
  el.querySelector('#persona')?.addEventListener('change', async (e) => {
    await api('POST', '/auth/logout', {});
    await signIn(e.target.value, demoAccounts.password);
  });
  el.querySelector('#reset')?.addEventListener('click', async (e) => {
    e.target.classList.add('loading');
    await api('POST', '/demo/reset', {});
    toast('Demo data regenerated for right now', 'ok');
    dockOpen = false;
    location.hash = '#/home';
    S.refresh();
  });
}

// ---------------- Sign in ----------------
export async function signIn(email, password) {
  const r = await api('POST', '/auth/login', { email, password });
  S.me = r.user;
  const me = await api('GET', '/me');
  S.orgs = me.orgs;
  await loadMeta();
  dockOpen = false;
  counts = {};
  toast(`Signed in as ${S.me.name}`, 'ok');
  if (location.hash === '#/home') render(); else location.hash = '#/home';
}
export const getDemoAccounts = async () => (demoAccounts ||= await api('GET', '/demo/accounts'));
export const personaHtml = (a) => `<button class="persona" data-email="${esc(a.email)}"><span class="avatar">${esc(initials(a.name))}</span><b>${esc(a.name)} <small class="muted">${esc(a.persona)}</small></b><span class="blurb">${esc(a.blurb)}</span><span class="go" aria-hidden="true">→</span></button>`;

async function viewLogin() {
  await getDemoAccounts();
  const stale = S.meta.demo && Date.now() - S.meta.seededAt > 45 * 60000;
  return {
    title: 'Sign in',
    html: `<div class="auth">
      <section class="auth-left">
        <div class="row between"><a class="brand" href="#/welcome"><span class="brand-mark"></span>LabLend</a>${themeToggle()}</div>
        <div style="margin:auto 0;max-width:460px;width:100%">
          <h1>Welcome to the <span class="serif">workshop</span>.</h1>
          <p class="lede">Sign in with your Northfield account, or step in as one of the demo personas.</p>
          ${stale ? `<div class="alert warn" style="margin:var(--s6) 0"><strong>The demo data is ${esc(rel(S.meta.seededAt).replace(' ago', ''))} old</strong>Time-based examples may have moved on. <button class="btn small" id="regen" style="margin-top:var(--s2)">Regenerate for right now</button></div>` : ''}
          <form class="auth-form" id="loginForm" novalidate style="margin-top:var(--s8)">
            <div class="field"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" placeholder="you@northfield.edu" required></div>
            <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required></div>
            <p class="fix" id="loginErr" role="alert" hidden style="color:var(--danger);font-size:.88rem"></p>
            <button class="btn primary large" style="width:100%">Sign in</button>
            ${demoAccounts.accounts.length ? `<p class="muted" style="font-size:.84rem;margin-top:var(--s3)">Demo password for every account: <code>${esc(demoAccounts.password)}</code></p>` : ''}
          </form>
        </div>
        <a class="crumb" href="#/welcome" style="margin:0">← Back to the overview</a>
      </section>
      <section class="auth-right">
        <div><span class="eyebrow">Explore without an account</span><h2 style="font-size:1.5rem;letter-spacing:-.03em">Pick a role in the sharing lifecycle</h2>
        <p class="muted" style="margin:0">Each persona opens a different part of the product with realistic, fictional data.</p></div>
        <div class="persona-list">${demoAccounts.accounts.map(personaHtml).join('')}</div>
      </section>
    </div>`,
    mount(root) {
      root.querySelectorAll('[data-email]').forEach((b) => b.addEventListener('click', () => { b.style.opacity = '.6'; signIn(b.dataset.email, demoAccounts.password).catch((ex) => toast(ex.message, 'danger')); }));
      root.querySelector('#regen')?.addEventListener('click', async (e) => {
        e.target.classList.add('loading');
        try { await api('POST', '/demo/reset', {}); await loadMeta(); toast('Fresh demo data generated', 'ok'); render(); } catch (ex) { toast(ex.message, 'danger'); e.target.classList.remove('loading'); }
      });
      root.querySelector('#loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target; const err = root.querySelector('#loginErr'); const btn = f.querySelector('button');
        err.hidden = true;
        if (!f.email.value.includes('@') || !f.password.value) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
        btn.classList.add('loading');
        try { await signIn(f.email.value, f.password.value); } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.classList.remove('loading'); }
      });
    },
  };
}

// ---------------- Home dashboards ----------------
const TOUR = [
  ['Aisha', 'Open the 3D print that starts now and <b>check in</b>, marking one item as an issue.'],
  ['Aisha', '<b>Record the return</b> with a different item damaged — a damage report opens and the before/after comparison highlights it.'],
  ['Aisha', '<b>Discover → Laser Cutter</b>, pick tomorrow afternoon, watch the live checks and priority score, and send the request.'],
  ['Sameer', 'Switch persona via <b>Demo</b> (bottom right) → <b>Review queue</b>. Approve the top request; the rest are waitlisted with a reason.'],
  ['Sameer', '<b>In use & returns</b> → inspect. <b>Incidents</b> → settle the CNC damage report.'],
  ['Anand', '<b>Verifications</b>: verify Aisha\'s media training. Sameer\'s list flags Arjun\'s duplicated certificate.'],
  ['Anyone', 'Demo clock <b>+1 day</b>: no-shows (with proposed strikes) and overdue returns are detected automatically.'],
  ['Priya', '<b>People & roles</b>: verify Ishaan. <b>Activity log</b> verifies the tamper-evident chain.'],
];
const tourHtml = () => (S.meta.demo ? `<div class="aside-block tour"><span class="eyebrow">Judge walkthrough · ~8 minutes</span><h2>Try the full lifecycle</h2><ol>${TOUR.map(([who, what]) => `<li><span class="who">${who}</span> — ${what}</li>`).join('')}</ol></div>` : '');
const notifBlock = (list) => `<div class="aside-block"><div class="section-head"><h2>Latest updates</h2><button class="btn small ghost" data-bell>View all</button></div>
  ${list.length ? `<div class="list">${list.slice(0, 4).map((n) => `<a class="todo" href="${esc(n.link || '#/home')}" style="grid-template-columns:minmax(0,1fr)"><div><b class="${n.read ? '' : ''}">${esc(n.title)}</b><span>${esc(n.body.slice(0, 90))}${n.body.length > 90 ? '…' : ''} · ${rel(n.at)}</span></div></a>`).join('')}</div>` : '<p class="muted">Nothing new.</p>'}</div>`;

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: S.meta.tz, hour: 'numeric', hourCycle: 'h23' }).format(nowMs()));
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
const firstName = () => (S.me.name.startsWith('Dr.') ? S.me.name.split(' ')[1] : S.me.name.split(' ')[0]);
const todo = (href, ic, title, sub, hot) => `<a class="todo ${hot ? 'hot' : ''}" href="${href}"><span class="ti">${icon(ic)}</span><div><b>${title}</b><span>${sub}</span></div>${icon('chevron', 16)}</a>`;

function featureBooking(b) {
  const t = nowMs();
  const state = b.actions.includes('checkin') ? ['Check-in is open', 'Check in now'] : b.actions.includes('checkout') ? [b.overdue ? 'Overdue — please return it' : 'In use', 'Record return'] : b.status === 'returned' ? ['Returned — awaiting inspection', 'View record'] : [`Starts ${rel(b.start)}`, 'View booking'];
  return `<a class="feature-booking reveal" href="#/booking/${b.id}">${art(b.resource)}
    <div class="fb-body"><span class="eyebrow" style="margin:0">${b.start <= t ? 'Happening now' : 'Your next booking'} · ${esc(b.ref)}</span>
      <h2>${esc(b.resource.name)}</h2>
      <div class="muted">${esc(fmtDT(b.start))} – ${esc(fmtDT(b.end).split(', ').pop())} · ${esc(b.resource.location)}</div>
      <div class="fb-foot"><span class="dotline ${b.overdue ? 'danger' : 'ok'}"><i></i>${state[0]}</span><span class="btn small ${b.overdue ? 'accent' : 'primary'}" style="margin-left:auto">${state[1]} <span class="arrow">→</span></span></div></div></a>`;
}

async function viewHome() {
  const notesP = api('GET', '/notifications');
  if (isStaff()) {
    const reqs = [api('GET', '/manage/queue'), api('GET', '/manage/active'), api('GET', '/manage/verifications'), api('GET', '/incidents'), api('GET', '/flags'), notesP];
    if (S.me.role === 'admin') reqs.push(api('GET', '/audit/verify'));
    const [q, a, v, inc, fl, notes, chain] = await Promise.all(reqs);
    const pending = q.groups.reduce((s, g) => s + g.items.filter((b) => b.status === 'pending').length, 0);
    const contested = q.groups.filter((g) => g.contested).length;
    const overdue = a.inUse.filter((b) => b.overdue);
    const signoffs = a.inUse.filter((b) => b.actions.includes('signoff'));
    const openInc = inc.incidents.filter((i) => ['open', 'disputed'].includes(i.status));
    const metric = (n, label, href, hot) => `<a href="${href}"><div class="num ${hot && n ? 'hot' : ''}" data-count="${n}">${Number(n).toLocaleString('en-IN')}</div><div class="lbl">${label}</div></a>`;
    const todos = [
      ...overdue.map((b) => todo(`#/booking/${b.id}`, 'clock', `${esc(b.resource.name)} is overdue`, `${esc(b.user.name)} · due ${rel(b.end)}`, true)),
      ...signoffs.map((b) => todo(`#/booking/${b.id}`, 'shield', `Confirm supervision on ${esc(b.resource.name)}`, `${esc(b.user.name)} has checked in`, true)),
      ...a.returns.map((b) => todo(`#/booking/${b.id}`, 'clipboard', `Inspect the return of ${esc(b.resource.name)}`, `${esc(b.user.name)} · ${esc(b.ref)}`)),
      ...openInc.slice(0, 4).map((i) => todo(`#/incident/${i.id}`, 'alert', `${esc(S.meta.incidentTypes[i.type])} on ${esc(i.resource.name)}`, `${esc(i.ref)} · ${i.status === 'disputed' ? 'disputed — admin review' : 'needs a decision'}`, i.status === 'disputed')),
      ...v.items.map((x) => todo('#/manage/verifications', 'shield', `Verify ${esc(x.credential.typeName)}`, `${esc(x.user.name)} · ${x.assessment.recommendation === 'likely_invalid' ? 'flagged by automated checks' : 'checks look consistent'}`, x.assessment.recommendation === 'likely_invalid')),
    ];
    return {
      title: 'Home',
      html: `<div class="hello"><div><span class="eyebrow">${esc(roleLabel(S.me.role))} · ${esc(S.orgs.map((o) => o.short).join(', ') || 'All organisations')}</span>
        <h1>${greeting()}, ${esc(firstName())}.</h1><p>${pending ? `${pending} request${pending > 1 ? 's' : ''} waiting for review${contested ? `, ${contested} contested` : ''}.` : 'No requests waiting for review.'} ${todos.length ? `${todos.length} other item${todos.length > 1 ? 's' : ''} need${todos.length > 1 ? '' : 's'} you.` : ''}</p></div>
        <a class="btn primary" href="#/manage/queue">Open review queue <span class="arrow">→</span></a></div>
        <div class="metrics eight reveal">
          ${metric(pending, `Requests to review${contested ? ` · ${contested} contested` : ''}`, '#/manage/queue')}
          ${metric(a.returns.length, 'Returns to inspect', '#/manage/active')}
          ${metric(overdue.length, 'Overdue returns', '#/manage/active', true)}
          ${metric(a.inUse.length, 'In use right now', '#/manage/active')}
          ${metric(v.items.length, 'Training records to verify', '#/manage/verifications')}
          ${metric(openInc.length, 'Open incidents', '#/manage/incidents', true)}
          ${metric(fl.flags.length, 'Usage patterns flagged', S.me.role === 'admin' ? '#/admin/flags' : '#/manage/insights')}
          ${chain ? `<a href="#/activity"><div class="num ${chain.ok ? 'good' : 'hot'}">${chain.ok ? 'Intact' : 'Broken'}</div><div class="lbl">Audit chain · ${chain.count} entries</div></a>` : metric(a.upcoming.length, 'Starting in the next 48 h', '#/manage/active')}
        </div>
        <div class="home-grid">
          <div>
            <section class="reveal"><div class="section-head"><h2>Needs your attention</h2></div>
              ${todos.length ? `<div class="list">${todos.join('')}</div>` : '<div class="empty"><b>All clear</b>Nothing is overdue, waiting for inspection or flagged.</div>'}</section>
            <section class="reveal"><div class="section-head"><h2>Review queue</h2><a href="#/manage/queue">Open queue →</a></div>
              ${q.groups.length ? `<div class="list">${q.groups.slice(0, 4).map((g) => `<a class="res-row" href="#/manage/queue">${art(g.resource)}<div><div class="rr-title">${esc(g.resource.name)}</div><div class="rr-meta">${g.items.length} request${g.items.length > 1 ? 's' : ''} · top: ${esc(g.items[0].user.name)} (score ${g.items[0].livePriority?.score ?? '—'})</div></div><div class="rr-side">${g.contested ? '<span class="badge warn">Contested</span>' : '<span class="badge info">Awaiting review</span>'}</div></a>`).join('')}</div>` : '<p class="muted">Nothing waiting.</p>'}</section>
          </div>
          <aside>${notifBlock(notes.notifications)}${tourHtml()}</aside>
        </div>`,
      mount(root) { root.querySelectorAll('[data-bell]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleDrop(); })); },
    };
  }
  const [{ bookings }, { resources }, { incidents }, notes] = await Promise.all([api('GET', '/bookings?scope=mine'), api('GET', '/resources?sort=recommended'), api('GET', '/incidents'), notesP]);
  const live = bookings.filter((b) => ['approved', 'checked_in', 'returned'].includes(b.status)).sort((a, b) => a.start - b.start);
  const reqs = bookings.filter((b) => ['pending', 'waitlisted'].includes(b.status)).sort((a, b) => a.start - b.start);
  const u = S.me;
  const next = live[0];
  const bookedIds = new Set(live.map((b) => b.resource.id));
  const explore = resources.filter((r) => !bookedIds.has(r.id) && r.status === 'active').slice(0, 3);
  const todos = [
    ...(!u.verified ? [todo('#/profile', 'shield', 'Verify your identity', 'An administrator checks your ID once — then you can book', true)] : []),
    ...live.filter((b) => b.actions.includes('checkin')).map((b) => todo(`#/booking/${b.id}`, 'check', `Check in to ${esc(b.resource.name)}`, 'Check-in is open now', true)),
    ...live.filter((b) => b.overdue).map((b) => todo(`#/booking/${b.id}`, 'clock', `Return ${esc(b.resource.name)}`, `It was due ${rel(b.end)}`, true)),
    ...incidents.filter((i) => ['open', 'resolved'].includes(i.status) && i.subjectUserId === u.id && Date.now() - i.createdAt < 7 * 864e5).map((i) => todo(`#/incident/${i.id}`, 'alert', `${esc(S.meta.incidentTypes[i.type])} on ${esc(i.resource.name)}`, i.status === 'open' ? 'Staff are reviewing — add your statement' : 'Decision made — you can respond')),
    ...u.credentials.filter((c) => c.status === 'pending').map((c) => todo('#/profile', 'hourglass', `${esc(c.typeName)} is being verified`, 'You can already request resources that need it')),
  ];
  return {
    title: 'Home',
    html: `<div class="hello"><div><span class="eyebrow">${esc(S.meta.affiliations[u.affiliation])} · ${esc(u.department || '')}</span>
      <h1>${greeting()}, ${esc(firstName())}.</h1>
      <p>${live.length ? `You have ${live.length} active booking${live.length > 1 ? 's' : ''}` : 'Nothing booked yet'}${reqs.length ? ` and ${reqs.length} request${reqs.length > 1 ? 's' : ''} in progress` : ''}.</p></div>
      <a class="btn primary" href="#/discover">${icon('search', 16)} Find a resource</a></div>
      ${next ? featureBooking(next) : `<a class="feature-booking reveal" href="#/discover">${art({ name: 'laser', tags: [] })}<div class="fb-body"><span class="eyebrow" style="margin:0">Get started</span><h2>There's idle kit waiting for you</h2><p class="muted" style="margin:0">Browse laser cutters, studios, cameras and more — and see instantly what you're eligible to use.</p><div class="fb-foot"><span class="btn small primary" style="margin-left:auto">Explore resources <span class="arrow">→</span></span></div></div></a>`}
      <div class="home-grid">
        <div>
          <section class="reveal"><div class="section-head"><h2>Needs your attention</h2></div>
            ${todos.length ? `<div class="list">${todos.join('')}</div>` : '<p class="muted">Nothing needs you right now.</p>'}</section>
          <section class="reveal"><div class="section-head"><h2>Bookings & requests</h2><a href="#/bookings">All bookings →</a></div>
            ${[...live, ...reqs].length ? `<div class="list">${[...live.slice(next ? 1 : 0), ...reqs].map((b) => bookingRow(b)).join('') || '<p class="muted">Only the booking above.</p>'}</div>` : '<p class="muted">No bookings or requests yet.</p>'}</section>
          <section class="reveal"><div class="section-head"><h2>Explore next</h2><a href="#/discover">Browse all →</a></div>
            <div class="res-grid">${explore.map((r, i) => resCard(r, i)).join('')}</div></section>
        </div>
        <aside>${notifBlock(notes.notifications)}${tourHtml()}</aside>
      </div>`,
    mount(root) { root.querySelectorAll('[data-bell]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleDrop(); })); },
  };
}

// ---------------- Boot ----------------
async function boot() {
  await loadMeta();
  if (S.meta.demo) demoAccounts = await api('GET', '/demo/accounts').catch(() => null);
  try {
    const me = await api('GET', '/me');
    S.me = me.user; S.orgs = me.orgs;
  } catch { S.me = null; }
  window.addEventListener('hashchange', render);
  render();
  setInterval(refreshCounts, 30_000);
}
boot();
