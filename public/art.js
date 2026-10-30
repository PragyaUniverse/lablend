// Hand-drawn, technical-drawing style illustrations of each kind of equipment and space.
// Pure inline SVG themed through CSS variables, so they work in both themes and cost no network requests.
const L = 'class="l"'; // ink line
const F = 'class="f"'; // body fill
const A = 'class="a"'; // accent fill
const S = 'class="s"'; // soft fill
const G = 'class="g"'; // green fill

const ART = {
  laser: `
    <rect ${F} x="62" y="70" width="196" height="92" rx="6"/><rect ${L} x="62" y="70" width="196" height="92" rx="6"/>
    <path ${S} d="M70 70 L92 34 H228 L250 70 Z"/><path ${L} d="M70 70 L92 34 H228 L250 70"/>
    <rect ${L} x="104" y="42" width="112" height="22" rx="3"/>
    <rect ${S} x="80" y="96" width="160" height="40" rx="3"/><rect ${L} x="80" y="96" width="160" height="40" rx="3"/>
    <path ${L} d="M80 104 H240 M84 112 H236"/><rect ${F} x="146" y="84" width="22" height="14" rx="2"/><rect ${L} x="146" y="84" width="22" height="14" rx="2"/>
    <path class="beam" d="M157 98 V122"/><circle ${A} cx="157" cy="123" r="3.2"/>
    <path class="cut" d="M110 128 C 130 114, 140 134, 160 122 S 196 116, 210 128"/>
    <circle ${A} cx="238" cy="150" r="5"/><rect ${L} x="76" y="146" width="40" height="7" rx="2"/>`,
  printer: `
    <rect ${L} x="92" y="30" width="136" height="138" rx="5"/><path ${L} d="M100 30 V168 M220 30 V168"/>
    <rect ${F} x="92" y="150" width="136" height="18" rx="4"/><rect ${L} x="92" y="150" width="136" height="18" rx="4"/>
    <rect ${S} x="104" y="140" width="112" height="10"/><rect ${L} x="104" y="140" width="112" height="10"/>
    <path ${L} d="M100 62 H220"/><rect ${F} x="148" y="54" width="26" height="22" rx="3"/><rect ${L} x="148" y="54" width="26" height="22" rx="3"/>
    <path ${A} d="M157 76 h8 l-4 7 z"/>
    <path ${G} d="M138 140 h46 v-8 h-4 v-8 h-38 v8 h-4 z"/><path ${L} d="M138 140 h46 v-8 h-4 v-8 h-38 v8 h-4 z M142 132 h38 M146 124 h30"/>
    <circle ${S} cx="258" cy="70" r="20"/><circle ${L} cx="258" cy="70" r="20"/><circle ${L} cx="258" cy="70" r="7"/>
    <path class="wire" d="M240 78 C 210 90, 190 50, 172 58"/>`,
  cnc: `
    <path ${F} d="M34 120 L72 92 H288 L250 120 Z"/><path ${L} d="M34 120 L72 92 H288 L250 120 Z"/>
    <path ${L} d="M34 120 V150 M250 120 V150 M288 92 V122"/>
    <path ${S} d="M70 112 L92 98 H236 L214 112 Z"/><path class="cut" d="M100 108 h40 v-6 h30 v6 h36"/>
    <rect ${F} x="118" y="40" width="20" height="62" rx="2"/><rect ${L} x="118" y="40" width="20" height="62" rx="2"/>
    <rect ${F} x="226" y="22" width="20" height="62" rx="2"/><rect ${L} x="226" y="22" width="20" height="62" rx="2"/>
    <path ${S} d="M128 44 L236 28 V42 L128 58 Z"/><path ${L} d="M128 44 L236 28 V42 L128 58 Z"/>
    <rect ${F} x="168" y="40" width="20" height="34" rx="3"/><rect ${L} x="168" y="40" width="20" height="34" rx="3"/>
    <path ${L} d="M178 74 V92"/><circle ${A} cx="178" cy="94" r="3"/>`,
  camera: `
    <rect ${F} x="70" y="66" width="164" height="96" rx="12"/><rect ${L} x="70" y="66" width="164" height="96" rx="12"/>
    <path ${F} d="M110 66 L122 48 H170 L180 66"/><path ${L} d="M110 66 L122 48 H170 L180 66"/>
    <rect ${S} x="84" y="78" width="22" height="12" rx="3"/><circle ${A} cx="214" cy="78" r="5"/>
    <circle ${S} cx="160" cy="116" r="38"/><circle ${L} cx="160" cy="116" r="38"/><circle ${L} cx="160" cy="116" r="26"/>
    <circle class="lens" cx="160" cy="116" r="15"/><circle class="glint" cx="153" cy="109" r="4"/>
    <rect ${F} x="186" y="26" width="64" height="14" rx="7"/><rect ${L} x="186" y="26" width="64" height="14" rx="7"/><path ${L} d="M206 40 V48 M196 48 H216"/>`,
  studio: `
    <rect ${S} x="36" y="34" width="38" height="120" rx="4"/><rect ${S} x="246" y="34" width="38" height="120" rx="4"/>
    <path class="foam" d="M42 46 h26 M42 62 h26 M42 78 h26 M42 94 h26 M42 110 h26 M42 126 h26 M42 142 h26 M252 46 h26 M252 62 h26 M252 78 h26 M252 94 h26 M252 110 h26 M252 126 h26 M252 142 h26"/>
    <path ${L} d="M126 166 H194 M160 166 V128 L196 80"/>
    <rect ${F} x="140" y="34" width="40" height="66" rx="20" transform="rotate(-18 160 67)"/><rect ${L} x="140" y="34" width="40" height="66" rx="20" transform="rotate(-18 160 67)"/>
    <path class="grill" d="M147 52 h24 M146 62 h26 M147 72 h24" transform="rotate(-18 160 67)"/>
    <path class="wave" d="M100 70 q6 -12 0 -24 M88 76 q12 -18 0 -36"/><circle ${A} cx="196" cy="80" r="4"/>`,
  room: `
    <rect ${F} x="70" y="28" width="180" height="78" rx="4"/><rect ${L} x="70" y="28" width="180" height="78" rx="4"/>
    <path ${G} d="M90 92 L120 66 L140 80 L168 50 L196 74 L230 56 V92 Z"/><circle ${A} cx="108" cy="50" r="7"/>
    <path ${L} d="M160 106 V116"/>
    ${[0, 1, 2].map((r) => [0, 1, 2, 3, 4].map((c) => `<rect ${r === 1 && c === 2 ? A : S} x="${78 + c * 34}" y="${126 + r * 14}" width="24" height="9" rx="3"/>`).join('')).join('')}`,
  scope: `
    <rect ${F} x="44" y="44" width="170" height="112" rx="8"/><rect ${L} x="44" y="44" width="170" height="112" rx="8"/>
    <rect class="screen" x="56" y="56" width="104" height="72" rx="4"/>
    <path class="grid" d="M56 74 h104 M56 92 h104 M56 110 h104 M82 56 v72 M108 56 v72 M134 56 v72"/>
    <path class="trace" d="M58 92 C 66 64, 74 64, 82 92 S 98 120, 108 92 S 124 64, 134 92 S 150 120, 158 92"/>
    ${[0, 1, 2].map((r) => [0, 1].map((c) => `<circle ${S} cx="${180 + c * 18}" cy="${68 + r * 22}" r="7"/><circle ${L} cx="${180 + c * 18}" cy="${68 + r * 22}" r="7"/>`).join('')).join('')}
    <rect ${F} x="226" y="96" width="62" height="60" rx="6"/><rect ${L} x="226" y="96" width="62" height="60" rx="6"/>
    <rect ${S} x="234" y="104" width="46" height="16" rx="2"/><circle ${A} cx="246" cy="138" r="6"/><circle ${G} cx="268" cy="138" r="6"/>
    <path class="wire" d="M70 156 C 70 176, 240 176, 246 144"/>`,
  compute: `
    <rect ${F} x="106" y="26" width="108" height="144" rx="8"/><rect ${L} x="106" y="26" width="108" height="144" rx="8"/>
    ${[0, 1, 2].map((i) => `<circle ${S} cx="160" cy="${60 + i * 40}" r="15"/><circle ${L} cx="160" cy="${60 + i * 40}" r="15"/><path class="fan" d="M160 ${48 + i * 40} v24 M148 ${60 + i * 40} h24"/>`).join('')}
    <circle ${A} cx="196" cy="38" r="3.5"/>
    <rect class="term" x="230" y="48" width="70" height="56" rx="5"/><path class="code" d="M240 64 h22 M240 76 h36 M240 88 h16"/>
    <rect class="term" x="20" y="96" width="70" height="56" rx="5"/><path class="code" d="M30 112 h30 M30 124 h20 M30 136 h38"/>`,
  bench: `
    <rect ${F} x="40" y="104" width="240" height="16" rx="3"/><rect ${L} x="40" y="104" width="240" height="16" rx="3"/>
    <path ${L} d="M56 120 V170 M264 120 V170 M56 150 H264"/>
    <rect ${S} x="232" y="82" width="34" height="22" rx="2"/><rect ${L} x="232" y="82" width="34" height="22" rx="2"/>
    <path ${S} d="M70 46 H182 L172 66 H70 Z"/><path ${L} d="M70 46 H182 L172 66 H70 Z"/><path class="teeth" d="M74 66 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6"/>
    <rect ${A} x="182" y="40" width="28" height="32" rx="6"/>
    <path ${L} d="M110 104 L150 78"/><rect ${F} x="140" y="66" width="34" height="16" rx="3" transform="rotate(-34 157 74)"/><rect ${L} x="140" y="66" width="34" height="16" rx="3" transform="rotate(-34 157 74)"/>`,
  solder: `
    <rect ${G} x="40" y="116" width="150" height="46" rx="4"/><path class="trace2" d="M54 130 h40 v18 h40 M110 124 v14 h50"/>
    <rect ${F} x="64" y="124" width="22" height="12" rx="2"/><rect ${L} x="64" y="124" width="22" height="12" rx="2"/>
    <rect ${F} x="140" y="140" width="30" height="14" rx="2"/><rect ${L} x="140" y="140" width="30" height="14" rx="2"/>
    <circle ${A} cx="118" cy="130" r="4"/>
    <path ${L} d="M210 162 H280 M224 162 L244 104 M266 162 L244 104"/><circle ${L} cx="244" cy="98" r="10"/>
    <rect ${F} x="160" y="46" width="76" height="14" rx="7" transform="rotate(32 198 53)"/><rect ${L} x="160" y="46" width="76" height="14" rx="7" transform="rotate(32 198 53)"/>
    <path ${L} d="M166 30 L140 112"/><path class="smoke" d="M128 108 q-8 -10 0 -20 q8 -10 0 -20"/>`,
  generic: `
    <rect ${F} x="76" y="78" width="168" height="80" rx="8"/><rect ${L} x="76" y="78" width="168" height="80" rx="8"/>
    <path ${L} d="M132 78 V62 Q132 54 140 54 H180 Q188 54 188 62 V78 M76 104 H244"/><rect ${A} x="148" y="98" width="24" height="14" rx="3"/>`,
};

const PICK = [
  ['laser', /laser|engrav/], ['printer', /3d|print/], ['cnc', /cnc|mill|router/], ['camera', /camera|cinema|video|film/],
  ['studio', /podcast|audio|studio|record/], ['room', /room|seminar|meeting|space/], ['scope', /oscillo|signal|scope/],
  ['compute', /gpu|compute|workstation/], ['solder', /solder|pcb/], ['bench', /bench|wood|hand/],
];
export function artKind(r) {
  const text = `${r.name} ${(r.tags || []).join(' ')} ${r.category || ''}`.toLowerCase();
  return (PICK.find(([, re]) => re.test(text)) || ['generic'])[0];
}

export function art(r, cls = '') {
  const kind = artKind(r);
  return `<div class="art art-${kind} ${cls}" aria-hidden="true"><svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet">${ART[kind]}</svg></div>`;
}
