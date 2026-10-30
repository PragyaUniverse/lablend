// Public landing page. Every resource, organisation and number shown here comes from the live API.
import { S, api, esc, toast } from './core.js';
import { signIn, getDemoAccounts, themeToggle, personaHtml } from './app.js';
import { art } from './art.js';
import { icon } from './icons.js';

const ROLES = [
  {
    tab: 'Students & makers', sub: 'Find, qualify, book', email: 'aisha@northfield.edu', artKey: { name: '3d printer', tags: [] },
    title: 'Find the kit. Know you qualify. Book it.',
    points: [
      'Describe your project and get matched to the right equipment or room.',
      'See exactly which requirements you meet — and how to fix the ones you don\'t.',
      'Every decision arrives with a reason. No silent “no”.',
      'Record condition at check-in, so earlier damage is never pinned on you.',
    ],
  },
  {
    tab: 'Resource owners', sub: 'Share without losing control', email: 'meera@northfield.edu', artKey: { name: 'cnc router', tags: [] },
    title: 'Say yes without losing control.',
    points: [
      'Set who may use each item: training, user groups, supervision, deposits and limits.',
      'Instant approval for low-risk kit, personal review for the rest.',
      'See utilisation, idle hours and who you reach beyond your department.',
      'Pause anything for maintenance in one click.',
    ],
  },
  {
    tab: 'Lab managers', sub: 'Run the floor', email: 'sameer@northfield.edu', artKey: { name: 'oscilloscope', tags: [] },
    title: 'Every request arrives checked and ranked.',
    points: [
      'Competing requests are grouped and ranked by a transparent priority score.',
      'Before-and-after condition records turn inspections into a 30-second job.',
      'No-shows and late returns are detected for you — you confirm or waive.',
      'Training certificates are pre-screened for typos, expiry and duplicates.',
    ],
  },
  {
    tab: 'Administrators', sub: 'Oversight you can prove', email: 'priya@northfield.edu', artKey: { name: 'seminar room', tags: [] },
    title: 'Oversight you can prove.',
    points: [
      'Verify identities and partner organisations before anyone books or lists.',
      'Review disputes — reversing a penalty undoes it everywhere.',
      'Explainable flags surface hoarding, repeat no-shows and shared certificates.',
      'A hash-chained audit log shows every decision, and that none were edited.',
    ],
  },
];

const STEPS = ['Request sent', 'Training verified', 'Fair-use checks passed', 'Approved by the lab manager', 'Checked in · condition recorded'];

export async function viewLanding() {
  const [ov, demo] = await Promise.all([api('GET', '/public/overview'), getDemoAccounts().catch(() => ({ accounts: [] }))]);
  const t = ov.totals;
  const rs = ov.resources;
  const featured = [...rs.filter((r) => r.highDemand), ...rs.filter((r) => !r.highDemand)].slice(0, 5);
  const orgs = [...new Set(rs.map((r) => r.org))];
  const cta = S.me ? '<a class="btn primary large" href="#/discover">Explore resources <span class="arrow">→</span></a>' : '<a class="btn primary large" href="#/login">Explore resources <span class="arrow">→</span></a>';
  const featCard = (r, i) => `<a class="res-card reveal" style="--d:${i * 0.06}s" href="${S.me ? `#/resource/${r.id}` : '#/login'}"><div style="position:relative">${art(r)}${r.highDemand ? '<div class="tagline"><span class="badge warn">High demand</span></div>' : ''}</div>
    <div class="rc-body"><div class="rc-title">${esc(r.name)}</div><div class="rc-meta">${esc(r.org)} · ${esc(r.building)}</div>
    <div class="rc-foot"><span class="dotline ${r.approvalMode === 'auto' ? 'ok' : ''}"><i></i>${r.approvalMode === 'auto' ? 'Instant approval when eligible' : 'Reviewed by staff'}</span></div></div></a>`;
  return {
    title: 'Unlock your campus workshop',
    html: `<div class="lp">
  <header class="lp-nav" id="lpnav"><div class="lp-wrap">
    <a class="brand" href="#/welcome"><span class="brand-mark"></span>LabLend</a>
    <nav class="lp-links" aria-label="Sections"><a href="#" data-scroll="resources">Resources</a><a href="#" data-scroll="how">How it works</a><a href="#" data-scroll="trust">Safety</a><a href="#" data-scroll="fair">Fair access</a></nav>
    <div class="actions">${themeToggle()}${S.me ? '<a class="btn small primary" href="#/home">Open LabLend</a>' : '<a class="btn small ghost" href="#/login">Sign in</a><a class="btn small primary hide-sm" href="#/login">Get started</a>'}</div>
  </div></header>
<div class="lp-top">

  <section class="lp-hero"><div class="lp-wrap">
    <div class="lp-hero-copy">
      <span class="pill lp-in"><b>Northfield</b> ${t.resources} labs, studios and machines · ${t.orgs} verified owners</span>
      <h1 class="lp-in" style="--d:.06s">Unlock the campus <span class="serif">workshop</span>.</h1>
      <p class="lede lp-in" style="--d:.12s">Laser cutters, studios, cameras and labs sit idle most evenings. LabLend opens them to students, researchers and local makers — with training checks, fair queues and condition records built in, so owners can finally say yes.</p>
      <div class="lp-cta lp-in" style="--d:.18s">${cta}<button class="btn large" data-scroll="how">How it works</button></div>
      <p class="lp-note lp-in" style="--d:.24s">${demo.accounts.length ? `No account needed — try it as one of ${demo.accounts.length} demo personas. All data is fictional.` : ''}</p>
    </div>
    <div class="lp-show lp-in" style="--d:.3s" aria-hidden="true">
      <div class="showcase">
        <div class="sc-bar"><i></i><i></i><i></i><span>lablend · Discover</span></div>
        <div class="sc-body">
          <div class="sc-nav"><span>Home</span><span class="on">Discover</span><span>My bookings</span><span>Fair use</span><span>Activity log</span></div>
          <div class="sc-main"><h4>Available near you</h4>
            <div class="sc-list">${rs.slice(0, 6).map((r, i) => `<div class="sc-tile ${i === 0 ? 'active' : ''}" data-tile="${i}">${art(r)}<b>${esc(r.name.split(' — ')[0])}</b><small class="muted">${esc(r.org)}</small></div>`).join('')}</div></div>
          <div class="sc-side">
            <span class="eyebrow" style="margin:0" id="scWhen">Saturday · 14:00–16:00</span>
            <h4 id="scName">${esc(rs[0]?.name.split(' — ')[0] || '')}</h4>
            ${STEPS.map((s, i) => `<div class="sc-step" data-step="${i}"><i>✓</i>${s}</div>`).join('')}
            <div class="sc-progress"><span id="scBar"></span></div>
          </div>
        </div>
      </div>
    </div>
  </div></section>
</div>

<div class="owners"><span>Shared on LabLend by</span>${orgs.map((o) => `<b>${esc(o)}</b>`).join('')}</div>

<section class="lp-sec" id="resources"><div class="lp-wrap">
  <div class="lp-sec-head reveal"><div><span class="eyebrow">Featured resources</span><h2>Specialist kit, a short walk away.</h2></div>
    <p>From a 60W laser cutter to a soundproofed podcast studio — each listing shows its rules, its availability, and whether you already qualify.</p></div>
  <div class="feat-grid">${featured.map(featCard).join('')}</div>
</div></section>

<section class="lp-sec tint" id="how"><div class="lp-wrap">
  <div class="lp-sec-head reveal"><div><span class="eyebrow">How LabLend works</span><h2>From “who do I ask?” to checked in.</h2></div>
    <p>One flow for everyone. The system does the checking and the paperwork; people make the decisions that matter.</p></div>
  <div class="flow">
    ${[['Discover', 'Search or describe your project. Every listing shows what it needs and whether you meet it.'],
    ['Request', 'Pick a time on the live calendar. Training, limits and clashes are checked before you send.'],
    ['Get approved', 'Low-risk kit is confirmed instantly; the rest is reviewed by staff, with a reason either way.'],
    ['Use & return', 'Record condition at check-in and return. Late returns and damage are handled by people, on the record.'],
  ].map(([h, p], i) => `<div style="--d:${i * 0.12}s"><h3>${h}</h3><p>${p}</p></div>`).join('')}
  </div>
</div></section>

<section class="lp-sec"><div class="lp-wrap">
  <div class="lp-sec-head reveal"><div><span class="eyebrow">Built for university communities</span><h2>One platform, four very different jobs.</h2></div>
    <p>Each role gets its own workspace and its own permissions — students never see the review queue, and managers only see their own labs.</p></div>
  <div class="roles reveal">
    <div class="role-tabs" role="tablist" aria-label="Roles">${ROLES.map((r, i) => `<button class="role-tab" role="tab" id="rt${i}" aria-controls="rolePanel" aria-selected="${i === 0}" data-role="${i}"><b>${r.tab}</b><span>${r.sub}</span></button>`).join('')}</div>
    <div id="rolePanel" role="tabpanel"></div>
  </div>
</div></section>

<section class="lp-sec tint" id="trust"><div class="lp-wrap two">
  <div class="reveal">
    <span class="eyebrow" style="color:var(--accent)">Safety & trust</span>
    <h2 style="font-size:clamp(1.9rem,1.2rem + 2.4vw,3rem);letter-spacing:-.045em;line-height:1.04;margin-bottom:var(--s8)">The parts that make owners nervous, handled.</h2>
    <div class="trust-list">
      <div><span class="ti">${icon('shield')}</span><div><h3>Eligibility before access</h3><p>Identity, user group, training with expiry dates, and account standing — checked live, with a fix for anything missing.</p></div></div>
      <div><span class="ti">${icon('users')}</span><div><h3>Supervision for high-risk machines</h3><p>A technician must confirm they're on site before a CNC router can be used.</p></div></div>
      <div><span class="ti">${icon('clipboard')}</span><div><h3>Condition records, both ways</h3><p>Checklists and photos at check-in and return. Only new damage is flagged.</p></div></div>
      <div><span class="ti">${icon('link')}</span><div><h3>A history nobody can quietly edit</h3><p>Every approval, return and penalty is hash-chained — ${t.auditEntries} entries and counting.</p></div></div>
    </div>
  </div>
  <div class="mock reveal" style="--d:.1s" aria-label="Example condition record">
    <div class="mock-head"><div><b>Condition record</b><div class="muted" style="font-size:.82rem">Laser Cutter · check-in vs return</div></div><span class="badge danger">1 new issue</span></div>
    <table><thead><tr><th>Item</th><th>Check-in</th><th>Return</th></tr></thead><tbody>
      <tr><td>Lens and mirrors</td><td class="cond-ok">OK</td><td class="cond-ok">OK</td></tr>
      <tr class="new"><td>Honeycomb bed</td><td class="cond-ok">OK</td><td class="cond-bad">Bent corner</td></tr>
      <tr><td>Fume extractor</td><td class="cond-bad">Filter worn</td><td class="cond-bad">Filter worn</td></tr>
      <tr><td>Emergency stop</td><td class="cond-ok">OK</td><td class="cond-ok">OK</td></tr>
    </tbody></table>
    <div class="mock-foot">The worn filter was recorded at check-in, so it's not the borrower's responsibility. A manager reviews the new issue.</div>
  </div>
</div></section>

<section class="lp-sec" id="fair"><div class="lp-wrap two">
  <div class="mock reveal" aria-label="Example of ranked competing requests">
    <div class="mock-head"><div><b>Three requests, one Saturday slot</b><div class="muted" style="font-size:.82rem">Ranked by the published priority score</div></div></div>
    <div class="scorebars">
      ${[['First-time, coursework', 0.75, 75], ['Research, first-time', 0.7, 70], ['8 h used this month', 0.3, 30]].map(([l, v, n], i) => `<div class="scorebar"><span class="muted" style="font-size:.84rem">${l}</span><div class="bar"><span style="--v:${v};--d:${i * 0.12}s"></span></div><b>${n}</b></div>`).join('')}
    </div>
    <div class="mock-foot">Approving the top request moves the others to the waitlist — with a written explanation.</div>
  </div>
  <div class="reveal" style="--d:.1s">
    <span class="eyebrow" style="color:var(--accent)">Fair access</span>
    <h2 style="font-size:clamp(1.9rem,1.2rem + 2.4vw,3rem);letter-spacing:-.045em;line-height:1.04;margin-bottom:var(--s6)">The same rules for everyone, written down.</h2>
    <div class="rules">
      <div><span>Open requests or bookings per person</span><em>max 4</em></div>
      <div><span>High-demand kit: upcoming bookings per person</span><em>1 at a time</em></div>
      <div><span>Weekly hours per person, per resource</span><em>owner-set cap</em></div>
      <div><span>Contested slots go to</span><em>lower recent use first</em></div>
      <div><span>When a slot frees up</span><em>waitlist auto-promotes</em></div>
      <div><span>Penalties are applied by</span><em>a person, never the system</em></div>
    </div>
  </div>
</div></section>

<section class="lp-sec tint"><div class="lp-wrap">
  <div class="lp-sec-head reveal"><div><span class="eyebrow">In the last 30 days</span><h2>What sharing looks like here.</h2></div><p>Live figures from the Northfield demo data — not marketing numbers.</p></div>
  <div class="numbers reveal">
    <div><div class="n"><span data-count="${t.resources}">${Number(t.resources).toLocaleString('en-IN')}</span></div><p>Resources opened up by ${t.orgs} verified owners</p></div>
    <div><div class="n"><span data-count="${t.hoursUsed}">${Number(t.hoursUsed).toLocaleString('en-IN')}</span><small>h</small></div><p>Of equipment and space time used</p></div>
    <div><div class="n"><span data-count="${t.communityHours}">${Number(t.communityHours).toLocaleString('en-IN')}</span><small>h</small></div><p>Used by community makers outside the university</p></div>
    <div><div class="n"><span data-count="${t.idleHours}">${Number(t.idleHours).toLocaleString('en-IN')}</span><small>h</small></div><p>Still idle — waiting for a good idea</p></div>
  </div>
</div></section>

<section class="lp-sec"><div class="lp-wrap">
  <div class="final reveal">
    <div><h2>Step into the <span class="serif">workshop</span>.</h2><p>No sign-up needed. Each persona opens a different part of the product — a print to check in, a contested slot to rank, a damage report to settle.</p>
      <div class="row" style="margin-top:var(--s6)">${S.me ? '<a class="btn accent large" href="#/home">Open LabLend</a>' : '<a class="btn accent large" href="#/login">Sign in</a>'}</div></div>
    <div class="persona-list">${demo.accounts.slice(0, 4).map(personaHtml).join('')}</div>
  </div>
</div></section>

<footer class="lp-foot"><div class="lp-wrap">
  <a class="brand" href="#/welcome"><span class="brand-mark"></span>LabLend</a>
  <span>Built for the “Unlock Underused Equipment and Spaces” challenge · all demo data is fictional</span>
  ${themeToggle()}
</div></footer>
</div>`,
    mount(root) {
      const nav = root.querySelector('#lpnav');
      const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();

      root.addEventListener('click', (e) => {
        const s = e.target.closest('[data-scroll]');
        if (s) { e.preventDefault(); root.querySelector(`#${s.dataset.scroll}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
        const p = e.target.closest('[data-email]');
        if (p) { p.style.opacity = '.6'; signIn(p.dataset.email, demo.password).catch((ex) => toast(ex.message, 'danger')); }
      });

      const panel = root.querySelector('#rolePanel');
      const showRole = (i) => {
        const r = ROLES[i];
        root.querySelectorAll('[data-role]').forEach((b) => { const on = Number(b.dataset.role) === i; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
        panel.setAttribute('aria-labelledby', `rt${i}`);
        const who = demo.accounts.find((a) => a.email === r.email);
        panel.innerHTML = `<div class="role-panel"><div><h3>${r.title}</h3><ul>${r.points.map((x) => `<li>${x}</li>`).join('')}</ul>
          ${who ? `<button class="btn primary" data-email="${r.email}">Try it as ${esc(who.name)} <span class="arrow">→</span></button>` : ''}</div>${art(r.artKey)}</div>`;
      };
      root.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', () => showRole(Number(b.dataset.role))));
      root.querySelector('.role-tabs').addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        const cur = Number(document.activeElement?.dataset.role ?? 0);
        const next = (cur + (['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1) + ROLES.length) % ROLES.length;
        root.querySelector(`[data-role="${next}"]`).focus();
        showRole(next);
      });
      showRole(0);

      // The showcase plays a booking through its lifecycle, cycling through real resources.
      const steps = root.querySelectorAll('[data-step]');
      const tiles = root.querySelectorAll('[data-tile]');
      const bar = root.querySelector('#scBar');
      const name = root.querySelector('#scName');
      const slots = ['Saturday · 14:00–16:00', 'Monday · 10:00–12:00', 'Tuesday · 18:00–19:00', 'Thursday · 09:00–13:00', 'Friday · 15:00–17:00', 'Sunday · 11:00–12:00'];
      let i = 0; let res = 0;
      const tick = () => {
        steps.forEach((s, k) => { s.classList.toggle('on', k < i); s.classList.toggle('now', k === i); });
        bar.style.width = `${(Math.min(i, steps.length) / steps.length) * 100}%`;
        i += 1;
        if (i > steps.length + 1) {
          i = 0; res = (res + 1) % tiles.length;
          tiles.forEach((t, k) => t.classList.toggle('active', k === res));
          name.textContent = rs[res]?.name.split(' — ')[0] || '';
          root.querySelector('#scWhen').textContent = slots[res % slots.length];
        }
      };
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) { i = steps.length; tick(); }
      const timer = reduce ? null : setInterval(tick, 1100);
      tick();
      return () => { window.removeEventListener('scroll', onScroll); clearInterval(timer); };
    },
  };
}
