// Shared matcher: marketplace listing (product name + variant label) -> warehouse item key.
// Paste in the page together with the shopee/tiktok script. Needs window.__WH = <wh.json content>.
window.__matchKey = (name, variant) => {
  const WH = window.__WH;
  const G = [[/padel/i, 'PADEL PULSE'], [/attivo/i, 'TIVAT ATTIVO'], [/protect/i, 'TIVAT PROTECT'], [/laseless|laceless/i, 'TIVAT LASELESS'], [/gradient 2/i, 'TIVAT GRADIENT 2.0'], [/gradient/i, 'GRADIENT 1.0'],
    [/tivat 2\.0|2\.0\+/i, 'TIVAT 2.0+'], [/tivat 1\.0|tivat ivory/i, 'TIVAT 1.0'], [/flex ?gel/i, 'FLEX'], [/chiropr/i, 'CALORING DIET CHIROPRACTIC SLIPPERS'], [/caloring/i, 'CALORING DIET SLIPPERS'],
    [/stemina/i, 'BEDKING STEMINA ACUPRESSURE SLIPPERS'], [/bed ?king/i, 'BEDKING DIET SLIPPERS'], [/carbon/i, 'CARBON BOLT RUNNING'], [/one more/i, 'ONE MORE SQUAT SHOES WYDN'],
    [/wayden|wydn|squat/i, 'WYDN S200 SQUAT SHOES'], [/ready walk/i, 'READY WALK'], [/thunder/i, 'THUNDER R2'], [/neon|r4/i, 'TURBO SPEEDSTER R4'], [/speedster|r3/i, 'TURBO SPEEDSTER R3'],
    [/wave/i, 'BALOSTER WAVE'], [/veloster|balloster|baloster/i, 'BALLOSTER'], [/rora|mary jane/i, 'RORA']];
  const COL = ['ALL BLACK', 'OFF WHITE', 'AQUA BLUE', 'BLACK', 'WHITE', 'GRAY', 'GREY', 'NAVY', 'PINK', 'BLUE', 'IVORY', 'BEIGE', 'KHAKI', 'CHARCOAL', 'SILVER', 'VIOLET', 'MULTI', 'YELLOW', 'ORANGE', 'RED', 'GREEN', 'NEON'];
  const norm = (s) => s.replace(/EUU|EA|EU/g, '').replace(/[()\s]/g, '').replace(/~/g, '/');
  const ek = (k) => norm((k.match(/\(([^)]*)\)\s*$/) || ['', ''])[1]);
  const txt = name.toUpperCase();
  const g = (G.find(([r]) => r.test(txt)) || [])[1];
  if (!g) return null;
  const col = COL.find((c) => txt.includes(c));
  const colOk = (k, c) => k.includes(` - ${c} - `) || (c === 'GRAY' && k.includes(' - GREY - ')) || (c === 'GREY' && k.includes(' - GRAY - ')) || (c === 'BLACK' && k.includes(' - ALL BLACK - ')) || (c === 'WHITE' && k.includes(' - OFF WHITE - '));
  let keys = Object.keys(WH).filter((k) => (g === 'FLEX' ? /^FLEX/.test(k) : g === 'RORA' ? /RORA/.test(k) : k.startsWith(`${g} - `)));
  if (col && keys.some((k) => colOk(k, col))) keys = keys.filter((k) => colOk(k, col));
  const vc = COL.find((c) => variant.toUpperCase().includes(c));
  if (vc && keys.some((k) => colOk(k, vc))) keys = keys.filter((k) => colOk(k, vc));
  // only one colour left is required, otherwise the size could belong to several colours
  if (new Set(keys.map((k) => k.split(' - ').slice(-2, -1)[0])).size > 1) return null;
  const eu = norm((variant.match(/[\d.\/]+/) || [''])[0]);
  let m = keys.filter((k) => ek(k) === eu);
  if (m.length !== 1) { const f = eu.split('/')[0]; const m2 = keys.filter((k) => ek(k).split('/')[0] === f); if (m2.length === 1) m = m2; }
  return m.length === 1 ? m[0] : null;
};
'matcher ready';
