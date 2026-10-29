// One-off seeding of landing copy, blog posts and empty ledgers. Safe to re-run: it only
// fills files that do not exist yet (pass --force to overwrite content.json and posts.json).
// usage: node tools/seed-content.js [--force]
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'data');
const force = process.argv.includes('--force');
const has = (n) => fs.existsSync(path.join(D, `${n}.json`));
const read = (n) => JSON.parse(fs.readFileSync(path.join(D, `${n}.json`), 'utf8'));
const write = (n, v) => fs.writeFileSync(path.join(D, `${n}.json`), JSON.stringify(v, null, 2));

const content = {
  seo: { title: 'BALLOP Indonesia — Gallop Lightly', description: 'BALLOP, brand sepatu & sportswear dari Korea, kini hadir di Indonesia. Sepatu padel Padel Pulse, event, galeri, dan artikel.' },
  nav: { story: 'Story', koleksi: 'Koleksi', teknologi: 'Teknologi', event: 'Event', galeri: 'Galeri', blog: 'Jurnal', toko: 'Toko' },
  hero: {
    pill: 'FROM KOREA · NOW IN INDONESIA', title: 'ALWAYS LIGHT AND FREE.',
    lead: 'Sepatu dan sportswear yang terasa seperti kulit kedua. Sekarang dengan sepatu padel, khusus untuk lapangan Indonesia.',
    cta1: 'Lihat koleksi', cta2: 'Event terbaru', image: '/img/padel-pulse-3.png',
  },
  marquee: { items: ['GALLOP LIGHTLY, BALLOP!', 'ALWAYS LIGHT AND FREE', 'FROM KOREA', 'PADEL PULSE'] },
  story: {
    eyebrow: '01 / BRAND STORY', word1: 'BAREFOOT', word2: 'GALLOP', word3: 'BALLOP',
    p1: 'BALLOP lahir di Korea Selatan dari gabungan dua kata: barefoot dan gallop. Idenya sederhana: lepas sepatu yang berat, lalu berlari bebas ke alam terbuka. Logonya menggabungkan sayap dan huruf B, simbol terbang dengan ringan dan bebas.',
    p2: 'Dimulai tahun 2014 dengan aqua shoes pertama di Korea, BALLOP berkembang jadi brand lifestyle dan sportswear: sepatu lari Tivat, walking shoes, slipper akupresur, sampai apparel. Sekarang BALLOP masuk Indonesia lewat lapangan padel.',
    stats: [
      { value: 2014, suffix: '', plain: true, label: 'Aqua shoes pertama di Korea' },
      { value: 13, suffix: '', plain: false, label: 'Negara pengajuan paten teknologi anti-slip' },
      { value: 300, suffix: 'K', plain: false, label: 'Pasang Tivat terjual di 2021' },
      { value: 7893, suffix: '%', plain: false, label: 'Target crowdfunding Wadiz Tivat Gradient 2.0' },
    ],
    timeline: [
      { year: '2013', text: 'GTS Global berdiri, merek BALLOP didaftarkan' },
      { year: '2014', text: 'Aqua shoes pertama BALLOP, jadi steady seller' },
      { year: '2015', text: 'Rash guard, yoga wear, dan Design Research Institute' },
      { year: '2016', text: 'Grand prize footwear di ISPO, Jerman' },
      { year: '2017', text: 'BALLOP Mix walking shoes, ekspansi ke sneakers' },
      { year: '2019', text: 'Good Design Award untuk Aqualander Fit' },
      { year: '2021', text: '300.000 pasang Tivat terjual' },
      { year: '2026', text: 'Launching sepatu padel di Indonesia' },
    ],
  },
  catalog: { eyebrow: '02 / KOLEKSI', title: 'PILIH WARNAMU.', hint: 'Arahkan kursor ke sepatu, klik untuk lihat detail.', all: 'SEMUA' },
  tech: {
    eyebrow: '03 / TEKNOLOGI', title: 'DIBUAT UNTUK\nLAPANGAN PADEL.', image: '/img/padel-pulse-3.png',
    features: [
      { title: 'COMFORT', text: 'Bantalan empuk yang tetap responsif, nyaman dipakai main berjam-jam.', x: 24, y: 22 },
      { title: 'DURABLE UPPER', text: 'Upper anyaman tahan gesekan saat sliding dan sprint ke net.', x: 74, y: 46 },
      { title: 'STABILITY', text: 'Penopang tumit menjaga kaki tetap stabil saat ganti arah mendadak.', x: 22, y: 72 },
      { title: 'COURT GRIP', text: 'Outsole herringbone, cengkeraman maksimal di rumput sintetis.', x: 58, y: 90 },
      { title: 'PADEL', text: 'Didesain khusus gerakan padel: lateral, cepat, dan banyak berhenti.', x: 43, y: 30 },
    ],
  },
  events: {
    eyebrow: '04 / EVENT', title: 'MAIN BARENG\nBALLOP.', sub: 'Fun match, launching, dan komunitas. Ini event-event yang sudah dan akan kami jalankan.',
    empty: 'Belum ada event. Nantikan kabar berikutnya di Instagram kami.', more: 'Lihat detail', upcoming: 'SEGERA', done: 'SELESAI', info: 'Info event',
  },
  gallery: { eyebrow: '05 / GALERI', title: 'MOMEN DI\nLAPANGAN.', all: 'SEMUA', empty: 'Galeri masih kosong.' },
  blog: {
    eyebrow: '06 / JURNAL', title: 'CERITA &\nTIPS PADEL.', sub: 'Artikel, recap event, dan tips memilih sepatu dari tim BALLOP Indonesia.',
    more: 'Semua artikel', read: 'Baca', pageTitle: 'JURNAL BALLOP.', pageSub: 'Cerita, tips, dan kabar terbaru dari BALLOP Indonesia.',
    search: 'Cari artikel…', related: 'Artikel lainnya', back: 'Semua artikel', share: 'Bagikan', empty: 'Belum ada artikel.',
  },
  cta: { eyebrow: '07 / BELI DI MANA', title: 'SIAP\nGALLOP?', sub: 'Pesan langsung atau ikuti kabar terbaru BALLOP Indonesia.', giant: 'GALLOP LIGHTLY · ' },
  footer: { line: 'Gallop lightly, BALLOP! · Brand dari Korea Selatan', copyright: 'BALLOP Indonesia' },
  sku: {
    back: 'KATALOG', addCart: 'Add to Cart', buyNow: 'Buy Now', pickSize: 'Pilih ukuran dulu ya', added: 'masuk keranjang',
    noLink: 'Link beli belum diatur di admin', cartEmpty: 'Keranjang masih kosong', cartCount: 'item di keranjang',
  },
};

const posts = [
  {
    id: 'kenalan-ballop', slug: 'kenalan-dengan-ballop', title: 'Kenalan dengan BALLOP: Barefoot + Gallop dari Korea',
    excerpt: 'Dari aqua shoes pertama di Korea sampai sepatu padel di Jakarta. Ini cerita singkat BALLOP.',
    cover: '/img/padel-pulse-1.png', tags: ['Brand', 'Story'], author: 'Tim BALLOP', date: '2026-04-20', published: true, featured: true,
    body: [
      '## Dari mana nama BALLOP?', '',
      'BALLOP adalah gabungan dua kata: **barefoot** dan **gallop**. Brand ini lahir di Korea Selatan dengan satu ide: sepatu harus terasa ringan, seperti berlari tanpa alas kaki.', '',
      '> Always light and free.', '',
      '## Perjalanan singkat', '',
      '- **2014**: aqua shoes pertama BALLOP rilis di Korea dan jadi steady seller.',
      '- **2016**: meraih grand prize kategori footwear di ISPO, Jerman.',
      '- **2019**: Good Design Award untuk Aqualander Fit.',
      '- **2021**: 300.000 pasang sepatu lari Tivat terjual.', '',
      '## Sekarang di Indonesia', '',
      'Tahun 2026 BALLOP resmi masuk Indonesia lewat sepatu padel **Padel Pulse**. Ikuti kabar terbarunya di Instagram @ballopofficial.id.',
    ].join('\n'),
  },
  {
    id: 'recap-launching', slug: 'recap-launching-padel-pulse', title: 'Recap: Launching Sepatu Padel BALLOP di Madre Padel Club',
    excerpt: '16 pemain, 2 lapangan, format Americano. Begini serunya launching BALLOP di Jakarta.',
    cover: '/img/padel-pulse-2.png', tags: ['Event', 'Padel'], author: 'Tim BALLOP', date: '2026-05-04', published: true, featured: false,
    body: [
      'Sabtu, 2 Mei 2026, BALLOP Indonesia resmi meluncurkan sepatu padel barunya lewat fun match bareng **For Padel** di Madre Padel Club, Jakarta Selatan.', '',
      '## Formatnya', '',
      '- 2 lapangan, 8 pasang fixed partner',
      '- Americano, best of 5, golden point',
      '- Goodie bag hingga Rp350K untuk semua pemain', '',
      '## Hadiah', '',
      'Juara pertama membawa pulang sepatu padel BALLOP terbaru, dengan total hadiah hingga Rp4,5 juta dari BALLOP dan sponsor.', '',
      'Terima kasih untuk semua pemain dan partner yang datang. Sampai jumpa di event berikutnya!',
    ].join('\n'),
  },
  {
    id: 'tips-sepatu-padel', slug: 'tips-memilih-sepatu-padel', title: '5 Hal yang Perlu Dicek Sebelum Beli Sepatu Padel',
    excerpt: 'Sepatu lari bukan sepatu padel. Ini lima hal yang bikin sepatu padel beda.',
    cover: '/img/padel-pulse-6.png', tags: ['Tips', 'Padel'], author: 'Tim BALLOP', date: '2026-05-12', published: true, featured: false,
    body: [
      'Padel penuh gerakan lateral, berhenti mendadak, dan sliding. Sepatu lari dirancang untuk gerak lurus ke depan, jadi kurang cocok.', '',
      '## 1. Outsole herringbone', '', 'Pola zig-zag di sol memberi grip di rumput sintetis berpasir.', '',
      '## 2. Penopang tumit', '', 'Cari heel counter yang kokoh supaya kaki stabil saat ganti arah.', '',
      '## 3. Upper yang awet', '', 'Upper sering bergesekan dengan lantai saat sliding. Pilih material anyaman yang tahan abrasi.', '',
      '## 4. Bantalan responsif', '', 'Empuk boleh, tapi jangan terlalu tebal: kamu butuh rasa lantai untuk reaksi cepat.', '',
      '## 5. Ukuran pas', '', 'Sisakan sekitar satu jari di ujung jempol. Terlalu longgar bikin kaki bergeser di dalam sepatu.', '',
      'Semua poin ini ada di **BALLOP Padel Pulse**. Cek koleksinya di halaman depan.',
    ].join('\n'),
  },
];

if (force || !has('content')) write('content', content);
if (force || !has('posts')) write('posts', posts);
['sales', 'stock', 'ads', 'expenses'].forEach((n) => { if (!has(n)) write(n, []); });

if (has('products')) {
  const products = read('products');
  products.forEach((p, i) => {
    p.sku = p.sku || `PP-${String(i + 1).padStart(2, '0')}`;
    p.cost = p.cost || 650000;
    p.lowStock = p.lowStock || 0;
  });
  write('products', products);
}
if (has('settings')) {
  const s = read('settings');
  delete s.tagline; // moved to content.hero.title
  s.tiktokShop = s.tiktokShop || '';
  s.monthlyTarget = s.monthlyTarget || 50000000;
  s.lowStock = s.lowStock || 5;
  write('settings', s);
}
console.log('seeded', fs.readdirSync(D).join(', '));
