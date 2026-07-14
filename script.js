/* ============================================================
   SÖTÉT MÓD — napszak alapján automatikus
   19:00–06:00 között sötét, egyébként világos. A színek maguk a
   style.css-ben vannak (html.dark { --bg: ...; ... }), itt csak
   a class ki/bekapcsolása történik.
   ============================================================ */
function applyThemeByTime() {
  const h = new Date().getHours();
  const isDark = h >= 19 || h < 6;
  document.documentElement.classList.toggle('dark', isDark);
}
applyThemeByTime();
setInterval(applyThemeByTime, 5 * 60 * 1000); // 5 percenként újraellenőrzi, ha nyitva marad az app napszakváltáskor

/* ============================================================
   FIREBASE INICIALIZÁLÁS + BEJELENTKEZÉS
   A state mentése/betöltése (save/load) a script.js-ben van,
   ez a fájl csak az auth-ot és a Firestore kapcsolatot adja.
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyAkOUfRTHFSTVny4zqhMfn4w9U3Gp99wlw",
  authDomain: "vagyonmentor-ccefc.firebaseapp.com",
  projectId: "vagyonmentor-ccefc",
  storageBucket: "vagyonmentor-ccefc.firebasestorage.app",
  messagingSenderId: "512858526563",
  appId: "1:512858526563:web:2281d62d6d7ba6a99ef956"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Offline cache, hogy gyors maradjon és rossz net esetén se álljon meg
db.enablePersistence().catch(err => {
  console.warn('[Firebase] offline persistence nem elérhető:', err.code);
});

let currentUid = null;

auth.onAuthStateChanged(user => {
  const loginModal = document.getElementById('login-modal');
  const loginError = document.getElementById('login-error');
  if (loginError) loginError.textContent = '';

  if (user) {
    currentUid = user.uid;
    if (loginModal) loginModal.classList.remove('open');

    const userLabel = document.getElementById('logged-in-as');
    if (userLabel) userLabel.textContent = user.email || '';

    migrateLocalDataIfNeeded().finally(() => {
      load().then(() => {
        normalizeState();
        renderAll();
        if (typeof afterDataLoaded === 'function') afterDataLoaded();
      });
    });
  } else {
    currentUid = null;
    if (loginModal) loginModal.classList.add('open');
  }
});

function loginWithEmail() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  const loginError = document.getElementById('login-error');
  if (!email || !pass) {
    if (loginError) loginError.textContent = 'Add meg az e-mail címet és a jelszót.';
    return;
  }
  auth.signInWithEmailAndPassword(email, pass)
    .catch(err => {
      if (loginError) loginError.textContent = hibaSzoveg(err);
    });
}

function registerWithEmail() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  const loginError = document.getElementById('login-error');
  if (!email || !pass) {
    if (loginError) loginError.textContent = 'Add meg az e-mail címet és a jelszót.';
    return;
  }
  if (pass.length < 6) {
    if (loginError) loginError.textContent = 'A jelszónak legalább 6 karakternek kell lennie.';
    return;
  }
  auth.createUserWithEmailAndPassword(email, pass)
    .catch(err => {
      if (loginError) loginError.textContent = hibaSzoveg(err);
    });
}

function logout() {
  if (!confirm('Biztosan kijelentkezel?')) return;
  auth.signOut();
}

function hibaSzoveg(err) {
  switch (err.code) {
    case 'auth/invalid-email': return 'Érvénytelen e-mail cím.';
    case 'auth/user-not-found': return 'Nincs ilyen felhasználó — regisztrálj előbb.';
    case 'auth/wrong-password': return 'Hibás jelszó.';
    case 'auth/email-already-in-use': return 'Ez az e-mail cím már regisztrálva van — jelentkezz be.';
    case 'auth/weak-password': return 'Túl gyenge jelszó (min. 6 karakter).';
    default: return 'Hiba történt: ' + err.message;
  }
}

/* Egyszeri migráció: ha van régi localStorage adat és a Firestore-ban
   még nincs semmi ehhez a felhasználóhoz, feltölti a felhőbe. */
function migrateLocalDataIfNeeded() {
  if (!currentUid) return Promise.resolve();
  const old = localStorage.getItem('vagyonmentor_v2');
  if (!old) return Promise.resolve();

  return db.collection('vaults').doc(currentUid).get().then(snap => {
    if (snap.exists) return; // már van felhő-adat, ne írjuk felül
    let data;
    try { data = JSON.parse(old); } catch (e) { return; }
    return db.collection('vaults').doc(currentUid).set(data, { merge: true }).then(() => {
      console.log('[VagyonMentor] régi localStorage adatok átmigrálva a Firestore-ba.');
    });
  }).catch(e => console.error('[VagyonMentor] migráció hiba:', e));
}
/* ============================================================
   ÁLLAPOT — a TELJES felhő-rekord szerkezetét megtartjuk, így a
   Magánszemély és a Vállalkozó oldal ugyanabba a "vaults/$uid"
   rekordba ír, anélkül hogy a másik adatait felülírná.
   Ez az oldal CSAK a magánszemély mezőket jeleníti meg és kezeli;
   az üzleti mezőket érintetlenül továbbírja a felhőbe.
   ============================================================ */
let state = {
  stocks: [],
  crypto: [],
  loans: [],
  pledges: [],
  gold: { grams: 0, cost: 0, pricePerGram: 28000 },
  goldItems: [],
  goldSpot: 28000,
  services: [],
  bizIncome: [],
  bizExpense: [],
  orders: [],
  bizTaxRate: 15,
  paidInstallments: {}
};

let priceCache = {};

/* Tárolás: Firestore (felhő), a currentUid-t a firebase-init.js állítja be
   bejelentkezés után. A gyors, egymást követő mentéseket (pl. gépelés
   közben) 600ms-mal késleltetjük, hogy ne írjunk feleslegesen sokat. */
let _saveTimer = null;

function save() {
  if (!currentUid) return; // még nincs bejelentkezve, ne is próbáljunk menteni
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    db.collection('vaults').doc(currentUid).set(state, { merge: true })
      .catch(e => console.error('[VagyonMentor] mentés hiba:', e));
  }, 600);
}

/* normalizálás: ugyanazok a védő-alapértékek, mint a load()-ban */

/* Normalizálás — csak a magánszemély mezőkre. Az üzleti mezőket
   (bizIncome, orders, ...) szándékosan nem bántjuk, hogy a
   Vállalkozó oldal adatai megmaradjanak a közös rekordban. */
function normalizeState() {
  if (!state.paidInstallments) state.paidInstallments = {};
  if (!state.pledges) state.pledges = [];
  if (!state.goldItems) state.goldItems = [];
  if (!state.stocks) state.stocks = [];
  if (!state.crypto) state.crypto = [];
  if (!state.loans) state.loans = [];
  if (!state.goldSpot) state.goldSpot = (state.gold && state.gold.pricePerGram) || 28000;
  if (!state.services) state.services = [];
  if (state.usdHuf) usdHuf = state.usdHuf;
  if (state.eurHuf) eurHuf = state.eurHuf;
  if (state.fxUpdatedAt) fxUpdatedAt = state.fxUpdatedAt;
}

/* Betöltés a Firestore-ból. Aszinkron (Promise-t ad vissza), mert a
   felhőből olvasás nem azonnali — mindenhol, ahol korábban a load()
   utáni azonnali renderAll()-ra számítottunk, most a .then() ágban
   kell folytatni (lásd firebase-init.js: onAuthStateChanged). */
function load() {
  if (!currentUid) return Promise.resolve();
  return db.collection('vaults').doc(currentUid).get()
    .then(snap => {
      if (snap.exists) state = snap.data();
    })
    .catch(e => console.error('[VagyonMentor] betöltés hiba:', e))
    .then(() => {
      if (!state.paidInstallments) state.paidInstallments = {};
      if (!state.pledges) state.pledges = [];
      if (!state.goldItems) state.goldItems = [];
      if (!state.goldSpot) state.goldSpot = (state.gold && state.gold.pricePerGram) || 28000;
      if (!state.services) state.services = [];
      if (state.usdHuf) usdHuf = state.usdHuf;
      if (state.eurHuf) eurHuf = state.eurHuf;
      if (state.fxUpdatedAt) fxUpdatedAt = state.fxUpdatedAt;
      if (state.gold && state.gold.grams > 0 && state.goldItems.length === 0) {
        state.goldItems.push({
          id: uid(), name: 'Korábbi arany', form: 'egyéb', purity: '999.9',
          grams: state.gold.grams, cost: state.gold.cost, date: ''
        });
        state.gold = { grams: 0, cost: 0, pricePerGram: state.goldSpot };
      }
    });
}

/* -------- Biztonsági mentés / visszatöltés JSON fájlba -------- */
function openDataModal() { openModal('data-modal'); }

function exportData() {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vagyonmentor-mentes-' + now() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    alert('A mentés exportálása nem sikerült.');
    console.error('[VagyonMentor] export error:', e);
  }
}

function importData(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch (e) { alert('Hibás mentésfájl — nem JSON formátum.'); input.value = ''; return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      alert('Ez nem egy érvényes VagyonMentor mentésfájl.'); input.value = ''; return;
    }
    if (!confirm('Biztosan visszatöltöd ezt a mentést? A jelenlegi adatok felülíródnak ezen az eszközön.')) {
      input.value = ''; return;
    }
    state = data;
    normalizeState();
    save();
    renderAll();
    closeModal('data-modal');
    alert('A mentés visszatöltve.');
    input.value = '';
  };
  reader.readAsText(file);
}

function resetAllData() {
  if (!confirm('Biztosan törlöd az ÖSSZES magánszemély adatot a felhőből (részvény, kripto, arany, hitel, zálog, szolgáltatás)? Ez a művelet nem visszavonható — előtte érdemes fájlba menteni!')) return;
  if (!confirm('Utolsó megerősítés: minden ilyen adat véglegesen törlődik. A Vállalkozó oldal (StruckWebMentor) adatai érintetlenek maradnak. Folytatod?')) return;
  try { localStorage.removeItem('vagyonmentor_v2'); } catch (e) {}
  /* Csak a magánszemély mezőket nullázzuk — a közös felhő-rekordban
     lévő üzleti mezőket (bizIncome, orders, ...) nem érintjük. */
  const reset = {
    stocks: [], crypto: [], loans: [], pledges: [],
    gold: { grams: 0, cost: 0, pricePerGram: state.goldSpot || 28000 },
    goldItems: [], services: [], paidInstallments: {}
  };
  if (!currentUid) { Object.assign(state, reset); location.reload(); return; }
  db.collection('vaults').doc(currentUid).set(reset, { merge: true })
    .catch(e => console.error('[VagyonMentor] reset error:', e))
    .finally(() => location.reload());
}

const fmt = n => {
  if (n === undefined || n === null || isNaN(n)) return '0 Ft';
  return Math.round(n).toLocaleString('hu-HU') + ' Ft';
};

const fmtNum = n => parseFloat(n.toFixed(5)).toLocaleString('hu-HU', { maximumFractionDigits: 5 });

// Deviza szerinti formázás: HUF -> "Ft", USD -> "$", EUR -> "€"

function fmtCur(n, cur) {
  if (n === undefined || n === null || isNaN(n)) n = 0;
  if (cur === 'USD') return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cur === 'EUR') return '€' + n.toLocaleString('hu-HU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Math.round(n).toLocaleString('hu-HU') + ' Ft';
}

// Egy deviza aktuális HUF árfolyama (1 egység = ? Ft)

function rateForCurrency(cur) {
  return cur === 'USD' ? usdHuf : (cur === 'EUR' ? eurHuf : 1);
}

function formatThousands(el) {
  const caretFromEnd = el.value.length - el.selectionStart;
  const digits = el.value.replace(/\D/g, '');
  el.value = digits ? parseInt(digits, 10).toLocaleString('hu-HU') : '';
  const newPos = Math.max(0, el.value.length - caretFromEnd);
  el.setSelectionRange(newPos, newPos);
}

function parseAmount(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const digits = (el.value || '').replace(/\s|\u00a0/g, '').replace(/\D/g, '');
  return parseFloat(digits) || 0;
}

function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

const now = () => toLocalDateStr(new Date());

const uid = () => Math.random().toString(36).slice(2,9);

const COINGECKO_ID_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', DOT: 'polkadot',
  MATIC: 'matic-network', LTC: 'litecoin', LINK: 'chainlink',
  AVAX: 'avalanche-2', UNI: 'uniswap', ATOM: 'cosmos', XLM: 'stellar',
  ALGO: 'algorand', VET: 'vechain', FIL: 'filecoin', TRX: 'tron',
  NEAR: 'near', OP: 'optimism', ARB: 'arbitrum', SHIB: 'shiba-inu',
  PEPE: 'pepe', TON: 'the-open-network', SUI: 'sui', APT: 'aptos',
  INJ: 'injective-protocol', FTM: 'fantom'
};

let usdHuf = 306;

let eurHuf = 353;

let fxUpdatedAt = null;

async function fetchUsdHuf() {
  await fetchFxRates();
}

async function fetchCryptoPricesHuf(tickers) {
  if (!tickers.length) return {};
  const ids = tickers.map(t => COINGECKO_ID_MAP[t.toUpperCase()] || t.toLowerCase()).join(',');
  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    );
    const data = await r.json();
    const result = {};
    tickers.forEach(t => {
      const id = COINGECKO_ID_MAP[t.toUpperCase()] || t.toLowerCase();
      if (data[id] && data[id].usd) {
        result[t.toUpperCase()] = data[id].usd * usdHuf;
      }
    });
    return result;
  } catch(e) { return {}; }
}

/* -------- Több, kulcs nélküli CORS-proxy láncolása --------
   A Yahoo Finance API böngészőből közvetlenül nem hívható (nincs CORS
   engedélyezve), ezért egy nyilvános proxyn kell átmennie. Egyetlen
   proxy gyakran instabil, ezért sorban többet is megpróbálunk —
   ha az egyik nem válaszol időben, a következőt próbáljuk. */
const CORS_PROXIES = [
  { build: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    parse: r => r.json() },
  { build: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    parse: r => r.json() },
  { build: u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    parse: async r => { const outer = await r.json(); return JSON.parse(outer.contents); } },
];

async function fetchJsonViaProxies(targetUrl, timeoutMs = 6000) {
  for (const proxy of CORS_PROXIES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const r = await fetch(proxy.build(targetUrl), { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!r.ok) continue;
      const data = await proxy.parse(r);
      if (data) return data;
    } catch (e) { /* megyünk a következő proxyra */ }
  }
  return null;
}

async function fetchStockPriceHuf(ticker, currency) {
  try {
    // időbélyeg a lekérdezés végén, hogy a köztes CORS-proxyk (pl. allorigins)
    // ne egy korábban gyorsítótárazott, elavult választ adjanak vissza;
    // két különböző Yahoo host-ot is megpróbálunk, ha az egyik akadozna
    const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
    let price = null;
    for (const host of hosts) {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d&_=${Date.now()}`;
      const data = await fetchJsonViaProxies(url);
      price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) break;
    }
    if (!price) return null;
    if (currency === 'USD') return price * usdHuf;
    if (currency === 'EUR') {
      try {
        const er = await fetch('https://api.frankfurter.app/latest?from=EUR&to=HUF');
        const ed = await er.json();
        return price * (ed.rates?.HUF || 390);
      } catch(e) { return price * 390; }
    }
    return price;
  } catch(e) { return null; }
}

let refreshing = false;

async function refreshAllPrices() {
  if (refreshing) return;
  refreshing = true;
  setRefreshStatus('Frissítés…');

  await fetchUsdHuf();

  const cryptoTickers = [...new Set(state.crypto.map(c => c.coin.toUpperCase()))];
  if (cryptoTickers.length) {
    const prices = await fetchCryptoPricesHuf(cryptoTickers);
    Object.entries(prices).forEach(([ticker, price]) => {
      priceCache[ticker] = { price, updatedAt: new Date().toLocaleTimeString('hu-HU') };
    });
  }

  const failedTickers = [];
  for (const s of state.stocks) {
    const ticker = s.ticker.toUpperCase();
    const price = await fetchStockPriceHuf(s.ticker, s.currency);
    if (price) {
      priceCache[ticker] = { price, updatedAt: new Date().toLocaleTimeString('hu-HU') };
      s.price = price;
    } else if (!failedTickers.includes(ticker)) {
      failedTickers.push(ticker);
    }
  }

  if (state.goldItems && state.goldItems.length) {
    const gp = await fetchGoldSpotHuf();
    if (gp) {
      state.goldSpot = Math.round(gp);
      document.querySelectorAll('.refresh-status-gold').forEach(el =>
        el.textContent = '✅ ' + new Date().toLocaleTimeString('hu-HU'));
    }
  }
  save();

  refreshing = false;
  const okMsg = '✅ Frissítve: ' + new Date().toLocaleTimeString('hu-HU');
  setRefreshStatus(
    failedTickers.length
      ? `${okMsg} — ⚠ nem sikerült: ${failedTickers.join(', ')}`
      : okMsg
  );
  renderAll();
}

function setRefreshStatus(msg) {
  document.querySelectorAll('.refresh-status').forEach(el => el.textContent = msg);
}

function getLivePrice(ticker) {
  return priceCache[ticker.toUpperCase()]?.price || null;
}

function getLiveUpdatedAt(ticker) {
  return priceCache[ticker.toUpperCase()]?.updatedAt || null;
}

function showTab(id) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  const tab = document.getElementById('tab-' + id);
  if (tab) tab.classList.add('active');
  const activeBtn = document.querySelector('nav button[data-tab="' + id + '"]');
  if (activeBtn) {
    activeBtn.classList.add('active');
    // mobil: aktuális fül nevének frissítése
    const label = document.getElementById('nav-current-label');
    if (label) label.textContent = activeBtn.textContent.trim();
  }
  closeNav();
  renderAll();
}

/* ============================================================
   NÉZETVÁLTÓ — Magánszemély / Vállalkozó
   A választás eszközönként mentődik (localStorage), és a hozzá
   tartozó navigációt + alap-áttekintést mutatja.
   ============================================================ */

function toggleNav() {
  const nav = document.getElementById('main-nav');
  const icon = document.getElementById('nav-toggle-icon');
  const open = nav.classList.toggle('open');
  if (icon) icon.textContent = open ? '✕' : '☰';
}

function closeNav() {
  const nav = document.getElementById('main-nav');
  const icon = document.getElementById('nav-toggle-icon');
  if (nav) nav.classList.remove('open');
  if (icon) icon.textContent = '☰';
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

function updateStockLabels() {
  const cur = document.getElementById('st-currency').value;
  const sym = cur === 'HUF' ? 'Ft' : cur;
  document.getElementById('st-avg-label').textContent = `Vételi ár (${sym})`;
  const info = document.getElementById('st-fx-info');
  if (cur !== 'HUF') {
    info.style.display = 'block';
    const rate = cur === 'USD' ? usdHuf : (cur === 'EUR' ? eurHuf : 1);
    document.getElementById('st-fx-rate').textContent = Math.round(rate);
    info.innerHTML = `Az árak a vétel dátumához tartozó (történeti) árfolyammal lesznek HUF-ra váltva. Mai árfolyam: 1 ${cur} ≈ <span id="st-fx-rate">${Math.round(rate)}</span> Ft`;
  } else {
    info.style.display = 'none';
  }
}

function updateCryptoLabels() {
  const cur = document.getElementById('cr-currency').value;
  const sym = cur === 'HUF' ? 'Ft' : cur;
  document.getElementById('cr-price-label').textContent = `Ár (${sym})`;
  document.getElementById('cr-fee-label').textContent = `Díj (${sym})`;
  const info = document.getElementById('cr-fx-info');
  if (cur !== 'HUF') {
    const rate = cur === 'USD' ? usdHuf : (cur === 'EUR' ? eurHuf : 1);
    info.style.display = 'block';
    document.getElementById('cr-fx-cur').textContent = cur;
    document.getElementById('cr-fx-rate').textContent = Math.round(rate);
  } else {
    info.style.display = 'none';
  }
}

async function fetchFxRates() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=HUF,EUR');
    const d = await r.json();
    if (d.rates?.HUF) usdHuf = d.rates.HUF;
    if (d.rates?.EUR) eurHuf = usdHuf / d.rates.EUR;
    fxUpdatedAt = new Date().toLocaleTimeString('hu-HU');
    state.usdHuf = usdHuf;
    state.eurHuf = eurHuf;
    state.fxUpdatedAt = fxUpdatedAt;
    save();
    return true;
  } catch(e) { return false; }
}

let fxHistoryCache = {};

async function fxRateForDate(currency, dateStr) {
  if (currency === 'HUF') return 1;
  const today = now();
  if (!dateStr || dateStr >= today) {
    return currency === 'USD' ? usdHuf : eurHuf;
  }
  if (!fxHistoryCache[dateStr]) {
    try {
      const r = await fetch(`https://api.frankfurter.app/${dateStr}?from=USD&to=HUF,EUR`);
      const d = await r.json();
      if (d.rates?.HUF) {
        const usd = d.rates.HUF;
        const eur = d.rates.EUR ? usd / d.rates.EUR : eurHuf;
        fxHistoryCache[dateStr] = { usd, eur };
      }
    } catch(e) {}
  }
  const h = fxHistoryCache[dateStr];
  if (!h) return currency === 'USD' ? usdHuf : eurHuf;
  return currency === 'USD' ? h.usd : h.eur;
}

async function addStock() {
  const ticker = document.getElementById('st-ticker').value.trim().toUpperCase();
  const qty = parseFloat(document.getElementById('st-qty').value)||0;
  const currency = document.getElementById('st-currency').value;
  const avgNative = parseFloat(document.getElementById('st-avg').value)||0;
  const divYield = parseFloat(document.getElementById('st-div').value)||0;
  const buyDate = document.getElementById('st-date').value || now();
  if (!ticker || !qty) return;
  const fxRate = await fxRateForDate(currency, buyDate);
  const avg = avgNative * fxRate;
  const price = avg; // kezdő érték; az élő frissítés felülírja
  state.stocks.push({ id:uid(), ticker, qty, avg, avgNative, price, divYield, currency, buyDate });
  save();
  ['st-ticker','st-qty','st-avg','st-div'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('st-date').value = now();
  closeModal('stock-modal');
  renderAll();
}

function deleteStock(id) {
  state.stocks = state.stocks.filter(s=>s.id!==id);
  save(); renderAll();
}

// Visszaadja a részvény éves osztalékhozamát %-ban.
// Új adat: s.divYield (%). Régi adat: s.div (Ft/részvény) -> hozammá számolva.

function stockDivYield(s, currentPrice) {
  if (s.divYield != null) return s.divYield;
  return (s.div && currentPrice) ? (s.div / currentPrice * 100) : 0;
}

function renderStocks() {
  const tbody = document.getElementById('stock-tbody');

  document.getElementById('stock-refresh-bar').innerHTML = '';

  if (!state.stocks.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="color:var(--muted);text-align:center;padding:20px">Nincs részvény</td></tr>';
    document.getElementById('st-sum-invested').textContent = fmt(0);
    document.getElementById('st-sum-current').textContent = fmt(0);
    const plEl0 = document.getElementById('st-sum-pl');
    plEl0.textContent = fmt(0);
    plEl0.className = 'stat-value';
    document.getElementById('st-sum-pl-card').className = 'card card-stat-dark';
    document.getElementById('st-sum-div').textContent = fmt(0);
    return;
  }

  let totalInvested=0, totalCurrent=0, totalDiv=0;
  const rows = [...state.stocks].sort((a,b) => (b.buyDate||'').localeCompare(a.buyDate||''));
  tbody.innerHTML = rows.map(s => {
    const cur = s.currency || 'HUF';
    const rate = rateForCurrency(cur);
    const livePrice = getLivePrice(s.ticker);
    const currentPriceHuf = livePrice || s.price;

    // HUF értékek az összesítőkhöz (devizák összegezhetők)
    const investedHuf = s.qty * s.avg;
    const currentHuf = s.qty * currentPriceHuf;
    const divYield = stockDivYield(s, currentPriceHuf);
    totalInvested += investedHuf;
    totalCurrent += currentHuf;
    totalDiv += currentHuf * divYield / 100;

    // Natív értékek a sorhoz
    const avgN = (s.avgNative != null) ? s.avgNative : (rate ? s.avg / rate : s.avg);
    const curPriceN = rate ? currentPriceHuf / rate : currentPriceHuf;
    const investedN = s.qty * avgN;
    const currentN = s.qty * curPriceN;
    const plN = currentN - investedN;
    const plPct = investedN ? (plN/investedN*100) : 0;
    const annualDivN = currentN * divYield / 100;

    const updatedAt = getLiveUpdatedAt(s.ticker);
    const liveBadge = livePrice
      ? `<span class="badge badge-green" title="Frissítve: ${updatedAt}">● élő</span>`
      : `<span class="badge badge-yellow" title="Manuális ár">manuális</span>`;
    return `
      <tr>
        <td><strong>${s.ticker}</strong> <span class="badge badge-cyan">${cur}</span></td>
        <td style="color:var(--muted)">${s.buyDate||'—'}</td>
        <td>${fmtNum(s.qty)}</td>
        <td>${fmtCur(avgN, cur)}</td>
        <td>${fmtCur(curPriceN, cur)} ${liveBadge}</td>
        <td>${fmtCur(investedN, cur)}</td>
        <td><strong>${fmtCur(currentN, cur)}</strong></td>
        <td class="${plN>=0?'green':'red'}" style="font-weight:500">${plN>=0?'+':''}${fmtCur(plN, cur)} <span style="font-size:10px">(${plPct.toFixed(1)}%)</span></td>
        <td class="yellow">${fmtCur(annualDivN, cur)}</td>
        <td>${divYield.toFixed(2)}%</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteStock('${s.id}')">×</button></td>
      </tr>
    `;
  }).join('');

  const totalPL = totalCurrent - totalInvested;
  document.getElementById('st-sum-invested').textContent = fmt(totalInvested);
  document.getElementById('st-sum-current').textContent = fmt(totalCurrent);
  const plEl = document.getElementById('st-sum-pl');
  plEl.textContent = (totalPL>=0?'+':'') + fmt(totalPL);
  plEl.className = 'stat-value ' + (totalPL>=0?'green':'red');
  document.getElementById('st-sum-pl-card').className = 'card ' + (totalPL>=0?'card-stat-green':'card-stat-red');
  document.getElementById('st-sum-div').textContent = fmt(totalDiv);
}

async function addCryptoTrade() {
  const coin = document.getElementById('cr-coin').value.trim().toUpperCase();
  const type = 'buy';
  const currency = document.getElementById('cr-currency').value;
  const qty = parseFloat(document.getElementById('cr-qty').value)||0;
  const priceNative = parseFloat(document.getElementById('cr-price').value)||0;
  const feeNative = parseFloat(document.getElementById('cr-fee').value)||0;
  const date = document.getElementById('cr-date').value || now();
  if (!coin || !qty || !priceNative) return;
  const fxRate = await fxRateForDate(currency, date);
  const price = priceNative * fxRate;
  const fee = feeNative * fxRate;
  state.crypto.push({ id:uid(), coin, type, qty, price, date, fee, currency });
  save();
  ['cr-coin','cr-qty','cr-price','cr-fee'].forEach(id=>document.getElementById(id).value='');
  closeModal('crypto-modal');
  renderAll();
}

function deleteCryptoTrade(id) {
  state.crypto = state.crypto.filter(c=>c.id!==id);
  save(); renderAll();
}

let sellCoin = null;

let sellMaxQty = 0;

function openSellModal(coin) {
  const coins = calcCryptoPL();
  const c = coins[coin];
  const openQty = c ? c.buys.reduce((a,b)=>a+b.qty,0) : 0;
  if (openQty <= 0) return;
  sellCoin = coin;
  sellMaxQty = openQty;
  document.getElementById('sell-coin-info').innerHTML =
    `<strong style="color:var(--text);font-size:14px">${coin}</strong> — elérhető mennyiség: <strong style="color:var(--accent2)">${fmtNum(openQty)}</strong> db`;
  document.getElementById('sell-date').value = now();
  ['sell-qty','sell-price','sell-fee'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('sell-currency').value = 'HUF';
  document.getElementById('sell-error').style.display = 'none';
  updateSellLabels();
  document.getElementById('sell-modal').style.display = 'flex';
}

function closeSellModal() {
  document.getElementById('sell-modal').style.display = 'none';
  sellCoin = null;
}

function updateSellLabels() {
  const cur = document.getElementById('sell-currency').value;
  const sym = cur === 'HUF' ? 'Ft' : cur;
  document.getElementById('sell-price-label').textContent = `Eladási ár / db (${sym})`;
  document.getElementById('sell-fee-label').textContent = `Díj (${sym})`;
  const info = document.getElementById('sell-fx-info');
  if (cur !== 'HUF') {
    const rate = cur === 'USD' ? usdHuf : eurHuf;
    info.style.display = 'block';
    info.innerHTML = `Az ár és a díj az eladás dátumához tartozó (történeti) árfolyammal lesz HUF-ra váltva. Mai árfolyam: 1 ${cur} ≈ ${Math.round(rate)} Ft`;
  } else {
    info.style.display = 'none';
  }
}

async function confirmSell() {
  if (!sellCoin) return;
  const currency = document.getElementById('sell-currency').value;
  const qty = parseFloat(document.getElementById('sell-qty').value)||0;
  const priceNative = parseFloat(document.getElementById('sell-price').value)||0;
  const feeNative = parseFloat(document.getElementById('sell-fee').value)||0;
  const date = document.getElementById('sell-date').value || now();
  const errEl = document.getElementById('sell-error');
  if (!qty || !priceNative) {
    errEl.textContent = 'Adj meg eladott mennyiséget és eladási árat.';
    errEl.style.display = 'block';
    return;
  }
  if (qty > sellMaxQty + 1e-9) {
    errEl.textContent = `Legfeljebb ${fmtNum(sellMaxQty)} db ${sellCoin} adható el.`;
    errEl.style.display = 'block';
    return;
  }
  const fxRate = await fxRateForDate(currency, date);
  const price = priceNative * fxRate;
  const fee = feeNative * fxRate;
  state.crypto.push({ id:uid(), coin:sellCoin, type:'sell', qty, price, date, fee, currency });
  save();
  closeSellModal();
  renderAll();
}

function calcCryptoPL() {
  const coins = {};
  state.crypto.forEach(t => {
    if (!coins[t.coin]) coins[t.coin] = { buys: [], realized: 0, fees: 0 };
    coins[t.coin].fees += t.fee;
    if (t.type === 'buy') {
      coins[t.coin].buys.push({ qty: t.qty, price: t.price });
    } else {
      let remaining = t.qty;
      let costBasis = 0;
      while (remaining > 0 && coins[t.coin].buys.length) {
        const buy = coins[t.coin].buys[0];
        const used = Math.min(remaining, buy.qty);
        costBasis += used * buy.price;
        buy.qty -= used;
        remaining -= used;
        if (buy.qty <= 0) coins[t.coin].buys.shift();
      }
      coins[t.coin].realized += t.qty * t.price - costBasis;
    }
  });
  return coins;
}

function renderCrypto() {
  document.getElementById('crypto-refresh-bar').innerHTML = '';

  updateCryptoLabels();

  const coins = calcCryptoPL();
  let totalRealized = 0, totalOpen = 0, totalLiveOpen = 0, totalFees = 0;

  Object.entries(coins).forEach(([coin, c]) => {
    const livePrice = getLivePrice(coin);
    const openQty = c.buys.reduce((a,b)=>a+b.qty,0);
    const openCost = c.buys.reduce((a,b)=>a+b.qty*b.price,0);
    totalRealized += c.realized;
    totalOpen += openCost;
    totalLiveOpen += livePrice ? openQty * livePrice : openCost;
    totalFees += c.fees;
  });

  const el = document.getElementById('cr-realized');
  el.textContent = fmt(totalRealized);
  el.className = 'stat-value ' + (totalRealized>=0?'green':'red');
  document.getElementById('cr-realized-card').className = 'card ' + (totalRealized>=0?'card-stat-green':'card-stat-red');
  document.getElementById('cr-open').textContent = fmt(totalOpen);
  document.getElementById('cr-fees').textContent = fmt(totalFees);

  const liveOpenEl = document.getElementById('cr-live-open');
  if (liveOpenEl) {
    const unrealized = totalLiveOpen - totalOpen;
    liveOpenEl.innerHTML = `
      <div class="stat-value cyan">${fmt(totalLiveOpen)}</div>
      <div class="stat-sub">Nem realizált P&L: <span class="${unrealized>=0?'green':'red'}">${unrealized>=0?'+':''}${fmt(unrealized)}</span></div>
    `;
  }

  const tbody = document.getElementById('crypto-tbody');
  tbody.innerHTML = state.crypto.map(t => `
    <tr>
      <td>${t.date}</td>
      <td><strong>${t.coin}</strong> <span class="badge badge-cyan">${t.currency||'HUF'}</span></td>
      <td><span class="badge ${t.type==='buy'?'badge-green':'badge-yellow'}">${t.type==='buy'?'Vétel':'Eladás'}</span></td>
      <td>${fmtNum(t.qty)}</td>
      <td>${fmt(t.price)}</td>
      <td>${fmt(t.qty*t.price)}</td>
      <td class="red">${t.fee?fmt(t.fee):'-'}</td>
      <td>—</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteCryptoTrade('${t.id}')">×</button></td>
    </tr>
  `).join('') || '<tr><td colspan="9" style="color:var(--muted);text-align:center;padding:20px">Nincs ügylet</td></tr>';

  const sumEl = document.getElementById('crypto-coin-summary');
  sumEl.innerHTML = Object.entries(coins).map(([coin,c]) => {
    const openQty = c.buys.reduce((a,b)=>a+b.qty,0);
    const openCost = c.buys.reduce((a,b)=>a+b.qty*b.price,0);
    const livePrice = getLivePrice(coin);
    const liveVal = livePrice ? openQty * livePrice : null;
    const unrealized = liveVal !== null ? liveVal - openCost : null;
    const updatedAt = getLiveUpdatedAt(coin);
    return `<div class="card" style="min-width:180px;padding:12px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="font-family:var(--display);font-weight:700">${coin}</span>
        ${livePrice ? `<span class="badge badge-green" title="${updatedAt}">● élő</span>` : ''}
      </div>
      <div style="font-size:11px;color:var(--muted)">Realizált P&L</div>
      <div class="${c.realized>=0?'green':'red'}" style="font-weight:600">${fmt(c.realized)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">Nyitott pozíció (bekerülési)</div>
      <div>${fmt(openCost)}</div>
      ${liveVal !== null ? `
        <div style="font-size:11px;color:var(--muted);margin-top:6px">Aktuális eladási érték</div>
        <div class="cyan" style="font-weight:600">${fmt(liveVal)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">Nem realizált P&L</div>
        <div class="${unrealized>=0?'green':'red'}" style="font-weight:600">${unrealized>=0?'+':''}${fmt(unrealized)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">Frissítve: ${updatedAt}</div>
      ` : `<div style="font-size:11px;color:var(--muted);margin-top:6px">Nyomj frissítést az élő árért</div>`}
      ${openQty > 0 ? `<button class="btn btn-sm" style="width:100%;margin-top:10px" onclick="openSellModal('${coin}')">Eladás</button>` : ''}
    </div>`;
  }).join('');
}

function calcLoanEndDate() {
  const start = document.getElementById('ln-start').value;
  const months = parseInt(document.getElementById('ln-months').value)||0;
  const payday = parseInt(document.getElementById('ln-payday').value)||0;
  if (!start || !months) { document.getElementById('ln-end-info').textContent = ''; return; }
  const tmp = { start, months, payday };
  const first = getFirstPaymentDate(tmp);
  const last = getPaymentDate(tmp, months - 1);
  const endStr = toLocalDateStr(last);
  document.getElementById('ln-end').value = endStr;
  document.getElementById('ln-end-info').innerHTML =
    `Első törlesztő: <strong>${first.toLocaleDateString('hu-HU')}</strong><br>Lejárat: <strong>${last.toLocaleDateString('hu-HU')}</strong>`;
}

function openLoanDetail(id) {
  const l = state.loans.find(x => x.id === id);
  if (!l) return;
  document.getElementById('loan-list-view').style.display = 'none';
  document.getElementById('loan-detail-view').style.display = 'block';
  document.getElementById('loan-detail-content').innerHTML = buildLoanDetailHTML(l);
}

function closeLoanDetail() {
  document.getElementById('loan-list-view').style.display = 'block';
  document.getElementById('loan-detail-view').style.display = 'none';
}

function getFirstPaymentDate(l) {
  const start = new Date(l.start);
  const payday = l.payday || start.getDate();
  const d = new Date(start.getFullYear(), start.getMonth() + 2, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(payday, last));
  return d;
}

function getPaymentDate(l, i) {
  const first = getFirstPaymentDate(l);
  const payday = l.payday || first.getDate();
  const d = new Date(first.getFullYear(), first.getMonth() + i, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(payday, last));
  return d;
}

function buildLoanDetailHTML(l) {
  const monthlyRate = l.rate / 100 / 12;
  const paidSet = state.paidInstallments[l.id] || {};

  let balance = l.orig;
  const rows = [];
  for (let i = 0; i < l.months; i++) {
    const d = getPaymentDate(l, i);
    const payment = l.monthly;
    const interest = monthlyRate > 0 ? balance * monthlyRate : 0;
    const principal = payment - interest;
    balance = Math.max(0, balance - principal);
    const isPaid = !!paidSet[i+1];
    rows.push({ idx: i+1, date: d, interest, principal, payment, balance, isPaid });
  }

  const firstUnpaidIdx = rows.find(r => !r.isPaid)?.idx ?? null;

  const paidCount  = rows.filter(r => r.isPaid).length;
  const totalPaid  = rows.filter(r => r.isPaid).reduce((a,r) => a+r.payment, 0);
  const totalInterestPaid = rows.filter(r => r.isPaid).reduce((a,r) => a+r.interest, 0);
  const remaining  = rows.filter(r => !r.isPaid).length;
  const totalLeft  = rows.filter(r => !r.isPaid).reduce((a,r) => a+r.payment, 0);
  const lastPaid = [...rows].reverse().find(r => r.isPaid);
  const currentBalance = lastPaid ? lastPaid.balance : l.orig;

  const totalRepay = rows.reduce((a, r) => a + r.payment, 0);
  const loanFee = totalRepay - l.orig;

  const tableRows = rows.map(r => {
    const isNext = r.idx === firstUnpaidIdx;
    let rowStyle = '';
    if (isNext) rowStyle = 'background:rgba(60,122,140,0.08);';
    else if (r.isPaid) rowStyle = 'opacity:0.55;';
    let statusBadge;
    if (r.isPaid) {
      statusBadge = `<span class="badge badge-green" style="cursor:pointer" title="Kattints a visszavonáshoz" onclick="toggleInstallment('${l.id}', ${r.idx})">✓ Fizetve</span>`;
    } else if (isNext) {
      statusBadge = `<span class="badge badge-cyan" style="cursor:pointer;font-weight:600" title="Kattints a befizetés rögzítéséhez" onclick="toggleInstallment('${l.id}', ${r.idx})">→ Következő (kattints)</span>`;
    } else {
      statusBadge = '<span class="badge" style="background:rgba(107,114,128,0.15);color:var(--muted)">Várható</span>';
    }
    return `<tr style="${rowStyle}">
      <td style="color:var(--muted)">${r.idx}.</td>
      <td>${r.date.toLocaleDateString('hu-HU')}</td>
      <td>${fmt(r.payment)}</td>
      <td style="color:var(--muted)">${fmt(r.principal)}</td>
      <td style="color:var(--muted)">${fmt(r.interest)}</td>
      <td class="${r.isPaid ? 'green' : 'red'}">${fmt(r.balance)}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  return `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
        <div style="font-family:var(--display);font-size:22px;font-weight:800">${l.name}</div>
      </div>
      <div style="color:var(--muted);font-size:12px">
        Folyósítva: ${l.start} &nbsp;|&nbsp; Lejárat: ${l.end} &nbsp;|&nbsp; ${l.months} hónap &nbsp;|&nbsp; Kamat: ${l.rate}% &nbsp;|&nbsp; THM: ${l.thm}%
      </div>
    </div>

    <div class="grid g4" style="margin-bottom:16px">
      <div class="card">
        <div class="card-title">Felvett összeg</div>
        <div class="stat-value">${fmt(l.orig)}</div>
      </div>
      <div class="card">
        <div class="card-title">Fennálló tartozás</div>
        <div class="stat-value red">${fmt(currentBalance)}</div>
        <div class="stat-sub">${paidCount} / ${l.months} részlet fizetve</div>
      </div>
      <div class="card">
        <div class="card-title">Eddig visszafizetve</div>
        <div class="stat-value green">${fmt(totalPaid)}</div>
        <div class="stat-sub">ebből kamat: ${fmt(totalInterestPaid)}</div>
      </div>
      <div class="card">
        <div class="card-title">Még hátralévő</div>
        <div class="stat-value yellow">${fmt(totalLeft)}</div>
        <div class="stat-sub">${remaining} részlet</div>
      </div>
    </div>

    <div class="grid g3" style="margin-bottom:16px">
      <div class="card">
        <div class="card-title">Teljes visszafizetendő</div>
        <div class="stat-value cyan">${fmt(totalRepay)}</div>
        <div class="stat-sub">${l.months} részlet összege</div>
      </div>
      <div class="card">
        <div class="card-title">Hitel díja (kamat + költség)</div>
        <div class="stat-value red">${fmt(loanFee)}</div>
        <div class="stat-sub">Visszafizetendő − felvett összeg</div>
      </div>
      <div class="card">
        <div class="card-title">Túlfizetés aránya</div>
        <div class="stat-value yellow">${l.orig ? (loanFee/l.orig*100).toFixed(1) : 0}%</div>
        <div class="stat-sub">A felvett összeghez képest</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Visszafizetési előrehaladás</div>
      <div class="progress-wrap">
        <div class="progress-label">
          <span>${paidCount} részlet fizetve (${((paidCount/l.months)*100).toFixed(1)}%)</span>
          <span style="color:var(--muted)">${remaining} részlet van még hátra</span>
        </div>
        <div class="progress-bar" style="height:10px">
          <div class="progress-fill" style="width:${(paidCount/l.months*100).toFixed(1)}%;background:var(--accent)"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="card-title" style="margin-bottom:0">Havi törlesztési ütemterv</div>
        <span style="font-size:11px;color:var(--muted)">Kattints a "Következő" gombra a befizetés rögzítéséhez</span>
      </div>
      <div class="scroll-table">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Dátum</th>
              <th>Törlesztő</th>
              <th>Tőke</th>
              <th>Kamat</th>
              <th>Maradék tőke</th>
              <th>Állapot</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function toggleInstallment(loanId, idx) {
  if (!state.paidInstallments[loanId]) state.paidInstallments[loanId] = {};
  if (state.paidInstallments[loanId][idx]) {
    delete state.paidInstallments[loanId][idx];
  } else {
    state.paidInstallments[loanId][idx] = true;
  }
  save();
  const l = state.loans.find(x => x.id === loanId);
  if (l) document.getElementById('loan-detail-content').innerHTML = buildLoanDetailHTML(l);
}

function calcRemaining(l) {
  if (!l.monthly || !l.orig) return l.orig;
  const paidSet = state.paidInstallments[l.id] || {};
  const paidCount = Object.keys(paidSet).length;
  if (paidCount === 0) return l.orig;
  const monthlyRate = l.rate / 100 / 12;
  let balance = l.orig;
  let lastPaidBalance = l.orig;
  for (let i = 0; i < l.months; i++) {
    const interest = monthlyRate > 0 ? balance * monthlyRate : 0;
    const principal = monthlyRate > 0 ? (l.monthly - interest) : (l.orig / l.months);
    balance = Math.max(0, balance - principal);
    if (paidSet[i+1]) lastPaidBalance = balance;
  }
  return Math.max(0, lastPaidBalance);
}

function addLoan() {
  const name    = document.getElementById('ln-name').value.trim();
  const orig    = parseAmount('ln-orig');
  const start   = document.getElementById('ln-start').value;
  const months  = parseInt(document.getElementById('ln-months').value)||0;
  const payday  = parseInt(document.getElementById('ln-payday').value)||0;
  const freq    = document.getElementById('ln-frequency').value;
  const rate    = parseFloat(document.getElementById('ln-rate').value)||0;
  const thm     = parseFloat(document.getElementById('ln-thm').value)||0;
  const monthly = parseAmount('ln-monthly');
  if (!name || !orig) return;
  const tmp = { start, months, payday };
  const end = (start && months) ? toLocalDateStr(getPaymentDate(tmp, months - 1))
                                : document.getElementById('ln-end').value;
  state.loans.push({ id:uid(), name, orig, start, months, payday, freq, rate, thm, monthly, end });
  save();
  ['ln-name','ln-orig','ln-start','ln-months','ln-payday','ln-rate','ln-thm','ln-monthly','ln-end'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('ln-frequency').value = 'monthly';
  document.getElementById('ln-end-info').textContent = '';
  closeModal('loan-modal');
  renderAll();
}

function deleteLoan(id) {
  state.loans = state.loans.filter(l => l.id !== id);
  if (state.paidInstallments[id]) delete state.paidInstallments[id];
  save(); renderAll();
}

const FREQ_LABEL = { monthly: 'Havi', quarterly: 'Negyedéves', yearly: 'Éves' };

function renderLoans() {
  const container = document.getElementById('loan-cards');
  let totalRemain = 0, totalMonthly = 0;

  if (!state.loans.length) {
    container.innerHTML = '<div class="card" style="color:var(--muted);text-align:center;padding:32px">Nincs rögzített hitel</div>';
  } else {
    const ordered = [...state.loans].sort((a,b) => (a.start||'').localeCompare(b.start||''));
    container.innerHTML = ordered.map(l => {
      const remain = calcRemaining(l);
      const pct = l.orig ? ((l.orig - remain) / l.orig * 100) : 0;
      const paidCount = Object.keys(state.paidInstallments[l.id] || {}).length;
      totalRemain  += remain;
      totalMonthly += l.monthly;

      let nextPayment = '—';
      const paidSet = state.paidInstallments[l.id] || {};
      if (l.start && l.months) {
        let nextIdx = null;
        for (let i = 0; i < l.months; i++) {
          if (!paidSet[i+1]) { nextIdx = i; break; }
        }
        if (nextIdx !== null) nextPayment = getPaymentDate(l, nextIdx).toLocaleDateString('hu-HU');
        else nextPayment = 'Visszafizetve ✓';
      }

      const remainCount = Math.max(0, l.months - paidCount);

      const totalRepay = l.monthly * l.months;
      const loanFee = totalRepay - l.orig;

      return `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
            <div>
              <div style="font-family:var(--display);font-size:17px;font-weight:700;cursor:pointer;color:var(--accent2);text-decoration:underline dotted" onclick="openLoanDetail('${l.id}')" title="Részletek megtekintése">${l.name}</div>
              <div style="color:var(--muted);font-size:11px;margin-top:2px">
                Folyósítva: ${l.start||'—'} &nbsp;|&nbsp; Lejárat: ${l.end||'—'} &nbsp;|&nbsp; ${paidCount}/${l.months} részlet fizetve (még ${remainCount})
              </div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="deleteLoan('${l.id}')">× Törlés</button>
          </div>

          <div class="grid g4" style="margin-bottom:16px">
            <div>
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">Felvett összeg</div>
              <div style="font-family:var(--display);font-size:16px;font-weight:700">${fmt(l.orig)}</div>
            </div>
            <div>
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">Fennálló tartozás</div>
              <div style="font-family:var(--display);font-size:16px;font-weight:700" class="red">${fmt(remain)}</div>
            </div>
            <div>
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">Havi törlesztő</div>
              <div style="font-family:var(--display);font-size:16px;font-weight:700">${fmt(l.monthly)}</div>
            </div>
            <div>
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">Visszafizetve</div>
              <div style="font-family:var(--display);font-size:16px;font-weight:700" class="green">${fmt(l.orig - remain)}</div>
            </div>
          </div>

          <div class="progress-wrap" style="margin-bottom:16px">
            <div class="progress-label">
              <span>Visszafizetve: ${pct.toFixed(1)}%</span>
              <span style="color:var(--muted)">${fmt(l.orig - remain)} / ${fmt(l.orig)}</span>
            </div>
            <div class="progress-bar" style="height:8px">
              <div class="progress-fill" style="width:${pct}%;background:var(--accent)"></div>
            </div>
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:20px;font-size:12px">
            <div><span style="color:var(--muted)">Kamat: </span><strong>${l.rate}% / év</strong></div>
            <div><span style="color:var(--muted)">THM: </span><strong>${l.thm}%</strong></div>
            <div><span style="color:var(--muted)">Futamidő: </span><strong>${l.months} hónap</strong></div>
            <div><span style="color:var(--muted)">Teljes visszafizetendő: </span><strong class="cyan">${fmt(totalRepay)}</strong></div>
            <div><span style="color:var(--muted)">Hitel díja: </span><strong class="red">${fmt(loanFee)}</strong></div>
            <div><span style="color:var(--muted)">Törlesztés: </span><strong>${FREQ_LABEL[l.freq]||'Havi'}, minden hónap ${l.payday ? l.payday + '.' : '—'}</strong></div>
            <div><span style="color:var(--muted)">Következő törlesztés: </span><strong class="cyan">${nextPayment}</strong></div>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('ln-sum-remain').textContent = fmt(totalRemain);
  document.getElementById('ln-sum-monthly').textContent = fmt(totalMonthly);
  document.getElementById('ln-sum-yearly').textContent = fmt(totalMonthly * 12);
  document.getElementById('ln-sum-count').textContent = state.loans.length + ' db';
}

const PURITY_FACTOR = { '999.9': 0.9999, '916': 0.916, '750': 0.750, '585': 0.585, 'egyéb': 1 };

function goldItemValue(item, spot) {
  const factor = PURITY_FACTOR[item.purity] ?? 1;
  return item.grams * spot * factor;
}

function addGold() {
  const name   = document.getElementById('gd-name').value.trim();
  const code   = document.getElementById('gd-code').value.trim();
  const form   = document.getElementById('gd-form').value;
  const purity = document.getElementById('gd-purity').value;
  const grams  = parseFloat(document.getElementById('gd-grams').value)||0;
  const cost   = parseAmount('gd-cost');
  const date   = document.getElementById('gd-date').value || now();
  if (!grams) return;
  state.goldItems.push({ id:uid(), name: name||'Arany', code, form, purity, grams, cost, date });
  save();
  ['gd-name','gd-code','gd-grams','gd-cost'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('gd-date').value = now();
  closeModal('gold-modal');
  renderAll();
}

function deleteGold(id) {
  state.goldItems = state.goldItems.filter(g => g.id !== id);
  save(); renderGold(); renderDashboard();
}

/* ===== ZÁLOG ===== */

function pledgeAddMonths(dateStr, months) {
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0); // hónap túlcsordulás kezelése
  return d;
}

function pledgeAddDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return null;
  d.setDate(d.getDate() + days);
  return d;
}

function calcPledgeEndDate() {
  const start = document.getElementById('pl-start').value;
  const days = parseInt(document.getElementById('pl-term').value)||0;
  const info = document.getElementById('pl-end-info');
  const endEl = document.getElementById('pl-end');
  if (!start || !days) { endEl.value = ''; info.textContent = ''; return; }
  const end = pledgeAddDays(start, days);
  if (end) {
    endEl.value = toLocalDateStr(end);
    info.textContent = `Lejárat: ${end.toLocaleDateString('hu-HU')} (${days} nap futamidő)`;
  }
}

function pledgedGoldIds(exceptPledgeId) {
  const s = new Set();
  (state.pledges||[]).forEach(p => {
    if (p.redeemed) return;
    if (exceptPledgeId && p.id === exceptPledgeId) return;
    if (Array.isArray(p.goldIds)) p.goldIds.forEach(id => s.add(id));
    else if (p.goldId) s.add(p.goldId);
  });
  return s;
}

function populatePledgeGoldSelect() {
  const box = document.getElementById('pl-gold');
  if (!box) return;
  if (!state.goldItems.length) {
    box.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:6px 8px">Nincs rögzített aranytétel</div>';
    return;
  }
  const used = pledgedGoldIds();
  const available = state.goldItems.filter(g => !used.has(g.id));
  if (!available.length) {
    box.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:6px 8px">Minden aranytétel zálogban van</div>';
    return;
  }
  box.innerHTML = available.map(g => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:12px;cursor:pointer">
      <input type="checkbox" value="${g.id}" style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0">
      <span>${g.name} — ${fmtNum(g.grams)} g${g.code ? ' ('+g.code+')' : ''}</span>
    </label>
  `).join('');
}

function updatePledgeNet() {
  const principal = parseAmount('pl-principal');
  const feePct = parseFloat(document.getElementById('pl-fee').value)||0;
  const info = document.getElementById('pl-net-info');
  if (!info) return;
  if (principal) {
    const fee = principal * feePct / 100;
    info.textContent = `Kézhez kapott: ${fmt(principal - fee)} (kölcsön ${fmt(principal)} − kezelési ${feePct}% = ${fmt(fee)})`;
  } else {
    info.textContent = '';
  }
}

function addPledge() {
  const goldIds   = [...document.querySelectorAll('#pl-gold input:checked')].map(i => i.value);
  const ticketNo  = (document.getElementById('pl-ticket').value || '').trim();
  const principal = parseAmount('pl-principal');
  const feePct    = parseFloat(document.getElementById('pl-fee').value)||0;
  const start     = document.getElementById('pl-start').value || now();
  const days      = parseInt(document.getElementById('pl-term').value)||0;
  const rate      = parseFloat(document.getElementById('pl-rate').value)||0;
  if (!principal || !days) return;
  const goldNames = goldIds.map(id => {
    const g = state.goldItems.find(x => x.id === id);
    return g ? g.name : '—';
  });
  const endD = pledgeAddDays(start, days);
  const end = endD ? toLocalDateStr(endD) : '';
  state.pledges.push({ id:uid(), goldIds, goldNames, ticketNo, principal, feePct, start, days, rate, end });
  save();
  ['pl-principal','pl-fee','pl-rate','pl-end','pl-ticket'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('pl-end-info').textContent = '';
  document.getElementById('pl-net-info').textContent = '';
  closeModal('pledge-modal');
  renderAll();
}

function deletePledge(id) {
  state.pledges = state.pledges.filter(p => p.id !== id);
  save(); renderAll();
}

let redeemPledgeId = null;

function openRedeemModal(id) {
  const p = state.pledges.find(x => x.id === id);
  if (!p) return;
  redeemPledgeId = id;
  const d = calcPledgeDebt(p);
  const ids = Array.isArray(p.goldIds) ? p.goldIds : (p.goldId ? [p.goldId] : []);
  const names = ids.map((gid,i) => {
    const g = state.goldItems.find(x => x.id === gid);
    return g ? g.name : ((p.goldNames && p.goldNames[i]) || '—');
  });
  document.getElementById('redeem-info').innerHTML =
    `<strong style="color:var(--text);font-size:14px">${names.join(', ') || '—'}</strong><br>`
    + `Jelenlegi tartozás: <strong style="color:var(--red)">${fmt(d.currentDebt)}</strong> &nbsp;|&nbsp; `
    + `Kiváltás lejáratkor: <strong>${fmt(d.totalRepay)}</strong>`;
  document.getElementById('redeem-date').value = now();
  const amtEl = document.getElementById('redeem-amount');
  amtEl.value = Math.round(d.currentDebt).toLocaleString('hu-HU');
  document.getElementById('redeem-error').style.display = 'none';
  document.getElementById('redeem-modal').style.display = 'flex';
}

function closeRedeemModal() {
  document.getElementById('redeem-modal').style.display = 'none';
  redeemPledgeId = null;
}

function confirmRedeem() {
  if (!redeemPledgeId) return;
  const p = state.pledges.find(x => x.id === redeemPledgeId);
  if (!p) { closeRedeemModal(); return; }
  const amount = parseAmount('redeem-amount');
  const date = document.getElementById('redeem-date').value || now();
  const errEl = document.getElementById('redeem-error');
  if (!amount) {
    errEl.textContent = 'Adj meg kiváltási összeget.';
    errEl.style.display = 'block';
    return;
  }
  p.redeemed = true;
  p.redeemedAmount = amount;
  p.redeemedDate = date;
  save();
  closeRedeemModal();
  renderAll();
}

// Egy zálog számai (egyszerű kamat, időarányosan felhalmozva).
// principal = kölcsön összeg (erre megy a kamat), fee = kezelési költség,
// kézhez kapott = principal - fee, visszafizetendő = principal + kamat.

function calcPledgeDebt(p) {
  const principal = (p.principal != null) ? p.principal : (p.cash || 0); // régi adat: cash = kölcsön
  const rate = p.rate || 0;
  // kezelési költség: új adat %-ban (feePct), régi adat fix összegben (fee)
  const feePct = (p.feePct != null) ? p.feePct : (principal ? (p.fee||0) / principal * 100 : 0);
  const fee = principal * feePct / 100;
  const cashReceived = principal - fee;

  // futamidő: új adat napban (days), régi adat hónapban (months)
  let termYears, elapsedYears, termLabel, elapsedLabel;
  if (p.days != null) {
    const days = p.days;
    termYears = days / 365;
    let ed = 0;
    if (p.start) ed = Math.floor((Date.now() - new Date(p.start).getTime()) / 86400000);
    ed = Math.max(0, Math.min(ed, days));
    elapsedYears = ed / 365;
    termLabel = `${days} nap`;
    elapsedLabel = `${ed} / ${days} nap`;
  } else {
    const months = p.months || 0;
    termYears = months / 12;
    let em = 0;
    if (p.start) {
      const s = new Date(p.start), t = new Date();
      em = (t.getFullYear()-s.getFullYear())*12 + (t.getMonth()-s.getMonth());
      if (t.getDate() < s.getDate()) em -= 1;
    }
    em = Math.max(0, Math.min(em, months));
    elapsedYears = em / 12;
    termLabel = `${months} hónap`;
    elapsedLabel = `${em} / ${months} hónap`;
  }

  const totalInterest = principal * rate / 100 * termYears;
  const totalRepay = principal + totalInterest;
  const accrued = principal * rate / 100 * elapsedYears;
  const currentDebt = principal + accrued;
  return { principal, feePct, fee, cashReceived, totalInterest, totalRepay, accrued, currentDebt, termLabel, elapsedLabel };
}

function pledgeTotalDebt() {
  return state.pledges.reduce((a,p) => a + (p.redeemed ? 0 : calcPledgeDebt(p).currentDebt), 0);
}

function renderPledges() {
  populatePledgeGoldSelect();
  const container = document.getElementById('pledge-cards');
  if (!container) return;

  let sumCash = 0, sumDebt = 0, sumRepay = 0, activeCount = 0;

  function pledgeCard(p) {
    const d = calcPledgeDebt(p);
    const redeemed = !!p.redeemed;
    if (!redeemed) { sumCash += d.cashReceived; sumDebt += d.currentDebt; sumRepay += d.totalRepay; activeCount++; }
    const ids = Array.isArray(p.goldIds) ? p.goldIds : (p.goldId ? [p.goldId] : []);
    const names = ids.map((id, i) => {
      const g = state.goldItems.find(x => x.id === id);
      if (g) return `${g.name} — ${fmtNum(g.grams)} g`;
      const fb = (p.goldNames && p.goldNames[i]) || p.goldName || '—';
      return `${fb} (törölt tétel)`;
    });
    const goldLabel = names.length ? names.join(', ') : (p.goldName || '—');
    const today = now();
    let badge;
    if (redeemed) badge = `<span class="badge badge-purple">kiváltva</span>`;
    else if (p.end && p.end < today) badge = `<span class="badge badge-red">lejárt</span>`;
    else badge = `<span class="badge badge-green">aktív</span>`;

    const headerBtn = redeemed
      ? `<button class="btn btn-danger btn-sm" onclick="deletePledge('${p.id}')">× Törlés</button>`
      : `<button class="btn btn-sm" onclick="openRedeemModal('${p.id}')">Kiváltás</button>`;

    const redeemRow = redeemed
      ? `<div class="alert" style="margin:0 0 16px;color:var(--purple);background:rgba(139,105,143,0.09);border-color:rgba(139,105,143,0.3)">
           ✓ Kiváltva: <strong>${p.redeemedDate||'—'}</strong> &nbsp;|&nbsp; Kiváltási összeg: <strong>${fmt(p.redeemedAmount||0)}</strong>
         </div>`
      : '';

    return `
      <div class="card" style="${redeemed?'opacity:0.7':''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
          <div>
            <div style="font-family:var(--display);font-size:17px;font-weight:700">${goldLabel} ${badge}</div>
            <div style="color:var(--muted);font-size:11px;margin-top:2px">
              ${p.ticketNo ? `Zálogjegy sorszám: <strong style="color:var(--text)">${p.ticketNo}</strong> &nbsp;|&nbsp; ` : ''}Zálogba adva: ${p.start||'—'} &nbsp;|&nbsp; Lejárat: ${p.end||'—'} &nbsp;|&nbsp; ${d.termLabel}
            </div>
          </div>
          ${headerBtn}
        </div>
        ${redeemRow}
        <div class="grid g4" style="margin-bottom:16px">
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">Kölcsön összeg</div>
            <div style="font-family:var(--display);font-size:16px;font-weight:700">${fmt(d.principal)}</div>
          </div>
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">Kézhez kapott</div>
            <div style="font-family:var(--display);font-size:16px;font-weight:700" class="cyan">${fmt(d.cashReceived)}</div>
          </div>
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">${redeemed?'Kiváltási összeg':'Jelenlegi tartozás'}</div>
            <div style="font-family:var(--display);font-size:16px;font-weight:700" class="${redeemed?'purple':'red'}">${fmt(redeemed ? (p.redeemedAmount||0) : d.currentDebt)}</div>
          </div>
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">Kiváltás lejáratkor</div>
            <div style="font-family:var(--display);font-size:16px;font-weight:700">${fmt(d.totalRepay)}</div>
          </div>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:20px;font-size:12px">
          <div><span style="color:var(--muted)">Kezelési költség: </span><strong class="red">${d.feePct}% (${fmt(d.fee)})</strong></div>
          <div><span style="color:var(--muted)">Kamat: </span><strong>${p.rate}% / év</strong></div>
          <div><span style="color:var(--muted)">Futamidő: </span><strong>${d.termLabel}</strong></div>
          <div><span style="color:var(--muted)">Eddigi kamat: </span><strong class="yellow">${fmt(d.accrued)}</strong></div>
          <div><span style="color:var(--muted)">Teljes kamat (lejáratig): </span><strong class="yellow">${fmt(d.totalInterest)}</strong></div>
          <div><span style="color:var(--muted)">Eltelt: </span><strong>${d.elapsedLabel}</strong></div>
        </div>
      </div>
    `;
  }

  if (!state.pledges.length) {
    container.innerHTML = '<div class="card" style="color:var(--muted);text-align:center;padding:32px">Nincs zálogba adott tétel</div>';
  } else {
    const active = state.pledges.filter(p => !p.redeemed);
    const redeemed = state.pledges.filter(p => p.redeemed);
    container.innerHTML = active.map(pledgeCard).join('') + redeemed.map(pledgeCard).join('');
  }

  document.getElementById('pl-sum-cash').textContent = fmt(sumCash);
  document.getElementById('pl-sum-debt').textContent = fmt(sumDebt);
  document.getElementById('pl-sum-repay').textContent = fmt(sumRepay);
  document.getElementById('pl-sum-count').textContent = activeCount + ' db';
}

async function fetchGoldSpotHuf() {
  try {
    await fetchFxRates();
    const r = await fetch('https://api.gold-api.com/price/XAU');
    const d = await r.json();
    const usdPerOunce = d.price;
    if (usdPerOunce) {
      return (usdPerOunce / 31.1035) * usdHuf;
    }
  } catch(e) {}
  return null;
}

async function fetchGoldPrice() {
  document.querySelectorAll('.refresh-status-gold').forEach(el => el.textContent = 'Frissítés…');
  await refreshAllPrices();
}

function renderGold() {
  const spot = state.goldSpot || 28000;

  let totalGrams = 0, totalCost = 0, totalValue = 0;
  const tbody = document.getElementById('gold-tbody');
  if (!tbody) return;

  const sortedGold = [...state.goldItems].sort((a,b) => (b.date||'').localeCompare(a.date||''));

  tbody.innerHTML = sortedGold.map(g => {
    const value = goldItemValue(g, spot);
    const pl = value - g.cost;
    const pledged = pledgedGoldIds().has(g.id);
    totalGrams += g.grams;
    totalCost  += g.cost;
    totalValue += value;
    return `<tr>
      <td><strong>${g.name}</strong>${pledged ? ' <span class="badge badge-purple">zálogban</span>' : ''}</td>
      <td style="color:var(--muted)">${g.code||'—'}</td>
      <td><span class="badge badge-yellow">${g.form}</span></td>
      <td>${g.purity}</td>
      <td>${fmtNum(g.grams)} g</td>
      <td style="color:var(--muted)">${g.date||'—'}</td>
      <td>${fmt(g.cost)}</td>
      <td class="cyan">${fmt(value)}</td>
      <td class="${pl>=0?'green':'red'}">${pl>=0?'+':''}${fmt(pl)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteGold('${g.id}')">×</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" style="color:var(--muted);text-align:center;padding:20px">Nincs aranytétel</td></tr>';

  const totalPL = totalValue - totalCost;
  document.getElementById('gd-total-grams').textContent = fmtNum(totalGrams) + ' g';
  document.getElementById('gd-total-cost').textContent = fmt(totalCost);
  document.getElementById('gd-total-value').textContent = fmt(totalValue);
  const plEl = document.getElementById('gd-total-pl');
  plEl.textContent = (totalPL>=0?'+':'') + fmt(totalPL);
  plEl.className = 'stat-value ' + (totalPL>=0?'green':'red');
  document.getElementById('gd-total-pl-card').className = 'card ' + (totalPL>=0?'card-stat-green':'card-stat-red');
}

function goldTotalValue() {
  const spot = state.goldSpot || 28000;
  return state.goldItems.reduce((a,g) => a + goldItemValue(g, spot), 0);
}

function goldTotalCost() {
  return state.goldItems.reduce((a,g) => a + g.cost, 0);
}

const CYCLE_LABEL = { monthly: 'Havi', quarterly: 'Negyedéves', yearly: 'Éves', weekly: 'Heti' };

const CYCLE_TO_MONTHLY = { monthly: 1, quarterly: 1/3, yearly: 1/12, weekly: 52/12 };

function serviceMonthlyCost(s) {
  return s.amount * (CYCLE_TO_MONTHLY[s.cycle] ?? 1);
}

function addService() {
  const name    = document.getElementById('sv-name').value.trim();
  const cat     = [...document.querySelectorAll('#sv-cat input:checked')].map(i => i.value);
  const amount  = parseAmount('sv-amount');
  const cycle   = document.getElementById('sv-cycle').value;
  const day     = parseInt(document.getElementById('sv-day').value)||0;
  const account = document.getElementById('sv-account').value;
  if (!name || !amount) return;
  state.services.push({ id:uid(), name, cat, amount, cycle, day, account, active:true, priceHistory: [{ date: now(), amount }] });
  save();
  ['sv-name','sv-amount','sv-day'].forEach(id => document.getElementById(id).value = '');
  document.querySelectorAll('#sv-cat input:checked').forEach(i => i.checked = false);
  closeModal('service-modal');
  renderServices();
  renderDashboard();
}

function deleteService(id) {
  state.services = state.services.filter(s => s.id !== id);
  save(); renderServices(); renderDashboard();
}

function toggleService(id) {
  const s = state.services.find(x => x.id === id);
  if (s) { s.active = !s.active; save(); renderServices(); renderDashboard(); }
}

function nextChargeDate(day) {
  if (!day) return null;
  const today = new Date();
  let d = new Date(today.getFullYear(), today.getMonth(), day);
  if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    d = new Date(today.getFullYear(), today.getMonth()+1, day);
  }
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

function renderServices() {
  const tbody = document.getElementById('services-tbody');
  if (!tbody) return;

  let totalMonthly = 0, activeCount = 0;
  let nextDate = null, nextName = '';

  tbody.innerHTML = state.services.map(s => {
    const monthly = serviceMonthlyCost(s);
    if (s.active) {
      totalMonthly += monthly;
      activeCount++;
      const nd = nextChargeDate(s.day);
      if (nd && (!nextDate || nd < nextDate)) { nextDate = nd; nextName = s.name; }
    }
    const statusBadge = s.active
      ? `<span class="badge badge-green" style="cursor:pointer" title="Kattints a szüneteltetéshez" onclick="toggleService('${s.id}')">● Aktív</span>`
      : `<span class="badge" style="background:rgba(107,114,128,0.15);color:var(--muted);cursor:pointer" title="Kattints az aktiváláshoz" onclick="toggleService('${s.id}')">⏸ Szünetel</span>`;
    return `<tr style="${s.active?'':'opacity:0.5'}">
      <td><strong>${s.name}</strong><br><span style="font-size:10px;color:var(--muted)">${Array.isArray(s.cat) ? (s.cat.join(', ') || '—') : (s.cat || '—')}</span></td>
      <td><span class="badge badge-cyan">${s.account}</span></td>
      <td>${fmt(s.amount)}${serviceTrendBadge(s)}</td>
      <td>${CYCLE_LABEL[s.cycle]||s.cycle}</td>
      <td>${s.day ? s.day + '.' : '—'}</td>
      <td class="red">${fmt(monthly)}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" onclick="openPriceModal('${s.id}')" title="Díjtörténet / áremelés-csökkenés rögzítése">📈 Díj</button>
          <button class="btn btn-danger btn-sm" onclick="deleteService('${s.id}')">×</button>
        </div>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:20px">Nincs rögzített előfizetés</td></tr>';

  document.getElementById('sv-monthly').textContent = fmt(totalMonthly);
  document.getElementById('sv-yearly').textContent = fmt(totalMonthly * 12);
  document.getElementById('sv-count').textContent = activeCount + ' db';
  const nextEl = document.getElementById('sv-next');
  if (nextEl) {
    nextEl.innerHTML = nextDate
      ? `${nextDate.toLocaleDateString('hu-HU')}<br><span style="font-size:11px;color:var(--muted)">${nextName}</span>`
      : '—';
  }
}

function serviceTrendBadge(s) {
  const hist = s.priceHistory || [];
  if (hist.length < 2) return '';
  const sorted = [...hist].sort((a,b) => a.date.localeCompare(b.date));
  const prev = sorted[sorted.length-2].amount;
  const cur = sorted[sorted.length-1].amount;
  const diff = cur - prev;
  if (!diff) return '';
  const pct = prev ? (diff/prev*100) : 0;
  const up = diff > 0;
  const color = up ? 'var(--red)' : 'var(--accent)';
  return `<div style="font-size:9.5px;color:${color};font-weight:600;margin-top:3px;white-space:nowrap">${up?'▲':'▼'} ${up?'+':''}${fmt(diff)} (${up?'+':''}${pct.toFixed(1)}%)</div>`;
}

let priceModalServiceId = null;

function openPriceModal(id) {
  const s = state.services.find(x => x.id === id);
  if (!s) return;
  priceModalServiceId = id;
  if (!s.priceHistory || !s.priceHistory.length) {
    s.priceHistory = [{ date: now(), amount: s.amount }];
    save();
  }
  document.getElementById('price-modal-title').textContent = `Díjtörténet – ${s.name}`;
  document.getElementById('pc-amount').value = '';
  document.getElementById('pc-date').value = now();
  renderPriceHistoryList(s);
  openModal('price-modal');
}

function renderPriceHistoryList(s) {
  const box = document.getElementById('price-history-list');
  if (!box) return;
  const hist = [...(s.priceHistory||[])].sort((a,b) => a.date.localeCompare(b.date));
  box.innerHTML = `
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Díjtörténet</div>
    <div style="max-height:220px;overflow-y:auto">
    ${hist.map((h,i) => {
      const prev = hist[i-1];
      let deltaHtml = '';
      if (prev) {
        const diff = h.amount - prev.amount;
        if (diff !== 0) {
          const up = diff > 0;
          const pct = prev.amount ? (diff/prev.amount*100) : 0;
          deltaHtml = `<span style="color:${up?'var(--red)':'var(--accent)'};font-weight:600;font-size:11px;margin-left:8px">${up?'▲':'▼'} ${up?'+':''}${fmt(diff)} (${up?'+':''}${pct.toFixed(1)}%)</span>`;
        }
      }
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--surface3);font-size:12.5px">
        <span style="color:var(--muted)">${h.date}</span>
        <span><strong>${fmt(h.amount)}</strong>${deltaHtml}</span>
      </div>`;
    }).join('') || '<div style="color:var(--muted);font-size:12px">Nincs rögzített díjtörténet</div>'}
    </div>
  `;
}

function addPriceChange() {
  const s = state.services.find(x => x.id === priceModalServiceId);
  if (!s) return;
  const amount = parseAmount('pc-amount');
  const date = document.getElementById('pc-date').value || now();
  if (!amount) return;
  if (!s.priceHistory || !s.priceHistory.length) s.priceHistory = [{ date, amount: s.amount }];
  s.priceHistory.push({ date, amount });
  s.priceHistory.sort((a,b) => a.date.localeCompare(b.date));
  s.amount = s.priceHistory[s.priceHistory.length-1].amount;
  save();
  document.getElementById('pc-amount').value = '';
  renderPriceHistoryList(s);
  renderServices();
  renderDashboard();
}

function servicesMonthlyTotal() {
  return state.services.filter(s => s.active).reduce((a,s) => a + serviceMonthlyCost(s), 0);
}

function daysUntil(dateStr) {
  const target = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0,0,0,0);
  return Math.round((target - today) / 86400000);
}

function buildUpcomingDatesHTML() {
  const items = [];

  // Zálogok lejárata — 1 hónapon (30 napon) belül, aktív (nem kiváltott) tételek
  state.pledges.filter(p => !p.redeemed && p.end).forEach(p => {
    const days = daysUntil(p.end);
    if (days <= 30) {
      const goldLabel = (p.goldNames && p.goldNames.length) ? p.goldNames.join(', ') : 'arany';
      items.push({
        kind: 'pledge',
        kindLabel: 'zálog',
        badgeClass: 'badge-purple',
        label: `Zálog lejárata – ${goldLabel}${p.ticketNo ? ` (${p.ticketNo})` : ''}`,
        date: p.end,
        days,
      });
    }
  });

  // Hitelrészletek — legközelebbi ki nem fizetett részlet, ha 1 héten (7 napon) belül esedékes
  state.loans.forEach(l => {
    const paidSet = state.paidInstallments[l.id] || {};
    for (let i=0; i<l.months; i++) {
      if (!paidSet[i+1]) {
        const d = getPaymentDate(l, i);
        const dateStr = toLocalDateStr(d);
        const days = daysUntil(dateStr);
        if (days <= 7) {
          items.push({
            kind: 'loan',
            kindLabel: 'hitel',
            badgeClass: 'badge-red',
            label: `Hiteltörlesztés – ${l.name}`,
            date: dateStr,
            days,
            amount: l.monthly,
          });
        }
        break;
      }
    }
  });

  // Előfizetések / szolgáltatások — 1 héten (7 napon) belül esedékes, aktív tételek
  state.services.filter(s => s.active && s.day).forEach(s => {
    const nd = nextChargeDate(s.day);
    if (nd) {
      const dateStr = toLocalDateStr(nd);
      const days = daysUntil(dateStr);
      if (days <= 7) {
        items.push({
          kind: 'service',
          kindLabel: 'szolgáltatás',
          badgeClass: 'badge-yellow',
          label: `Esedékes fizetés – ${s.name}`,
          date: dateStr,
          days,
          amount: s.amount,
        });
      }
    }
  });

  if (!items.length) {
    return '<div style="color:var(--muted);text-align:center;padding:20px;font-size:12px">Nincs közelgő fontos esemény a következő napokban</div>';
  }

  items.sort((a,b) => a.days - b.days);

  return items.map(it => {
    let daysLabel, urgencyClass;
    if (it.days < 0) { daysLabel = `Lejárt ${Math.abs(it.days)} napja`; urgencyClass = 'red'; }
    else if (it.days === 0) { daysLabel = 'Ma esedékes'; urgencyClass = 'red'; }
    else if (it.days <= 3) { daysLabel = `${it.days} nap múlva`; urgencyClass = 'red'; }
    else if (it.days <= 7) { daysLabel = `${it.days} nap múlva`; urgencyClass = 'yellow'; }
    else { daysLabel = `${it.days} nap múlva`; urgencyClass = ''; }

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);font-size:12px">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="badge ${it.badgeClass}" style="font-size:9px;padding:2px 6px">${it.kindLabel}</span>
            <span style="font-weight:600">${it.label}</span>
          </div>
          <div style="color:var(--muted);font-size:10px;margin-top:3px">${new Date(it.date+'T00:00:00').toLocaleDateString('hu-HU')}${it.amount ? ' · ' + fmt(it.amount) : ''}</div>
        </div>
        <span class="${urgencyClass}" style="font-weight:700;font-size:11px;white-space:nowrap;flex-shrink:0">${daysLabel}</span>
      </div>
    `;
  }).join('');
}

function renderDashboard() {
  const stockVal = state.stocks.reduce((a,s)=>{
    const livePrice = getLivePrice(s.ticker);
    return a + s.qty * (livePrice || s.price);
  }, 0);
  const stockCost = state.stocks.reduce((a,s)=>a+s.qty*s.avg,0);
  const goldVal = goldTotalValue();
  const coins = calcCryptoPL();
  const cryptoOpen = Object.values(coins).reduce((a,c)=>{
    const openQty = c.buys.reduce((x,b)=>x+b.qty,0);
    const livePrice = getLivePrice(Object.keys(coins).find(k=>coins[k]===c)||'');
    const openCost = c.buys.reduce((x,b)=>x+b.qty*b.price,0);
    return a + (livePrice ? openQty*livePrice : openCost);
  },0);
  const totalLoan = state.loans.reduce((a,l) => a + calcRemaining(l), 0);
  const totalPledge = pledgeTotalDebt();
  const annualDiv = state.stocks.reduce((a,s)=>{
    const cp = getLivePrice(s.ticker) || s.price;
    return a + s.qty*cp*(stockDivYield(s,cp)/100);
  },0);
  const currentValue = stockVal + goldVal + cryptoOpen;

  // Befektetett (bekerülési) költség: részvény + arany + kripto nyitott pozíció
  const cryptoOpenCost = Object.values(coins).reduce((a,c)=>
    a + c.buys.reduce((x,b)=>x+b.qty*b.price,0), 0);
  const investedCost = stockCost + goldTotalCost() + cryptoOpenCost;

  document.getElementById('d-current-value').textContent = fmt(currentValue);

  const gainPct = investedCost > 0 ? (currentValue - investedCost) / investedCost * 100 : 0;
  const pctEl = document.getElementById('d-invested-pct');
  if (investedCost > 0) {
    pctEl.textContent = (gainPct >= 0 ? '+' : '') + gainPct.toFixed(1) + '%';
    pctEl.className = gainPct >= 0 ? 'green' : 'red';
  } else {
    pctEl.textContent = '';
    pctEl.className = '';
  }
  document.getElementById('d-invested-line').textContent = 'Befektetve: ' + fmt(investedCost);

  const netWorth = stockVal + goldVal + cryptoOpen - totalLoan - totalPledge;
  const nwEl = document.getElementById('d-networth');
  nwEl.textContent = fmt(netWorth);
  const nwRound = Math.round(netWorth);
  nwEl.className = 'stat-value ' + (nwRound > 0 ? 'green' : (nwRound < 0 ? 'red' : ''));

  const qs = document.getElementById('quick-status');
  qs.innerHTML = buildUpcomingDatesHTML();

  const dm = document.getElementById('dash-monthly');
  const monthlyLoan = state.loans.reduce((a,l)=>a+l.monthly,0);
  const svcMonthly = servicesMonthlyTotal();
  const svcCount = state.services.filter(s=>s.active).length;
  const totalMonthly = monthlyLoan + svcMonthly;

  // Osztalék ráta: a havi osztalék a havi fix kiadások hány százalékát fedezi
  const monthlyDiv = annualDiv / 12;
  const divRate = totalMonthly > 0 ? monthlyDiv / totalMonthly * 100 : 0;
  const drEl = document.getElementById('d-div-rate');
  const drSub = document.getElementById('d-div-rate-sub');
  if (totalMonthly > 0) {
    drEl.textContent = divRate.toFixed(1) + '%';
    drEl.className = 'stat-value ' + (divRate >= 100 ? 'green' : (divRate >= 50 ? 'yellow' : 'red'));
    drSub.textContent = `${fmt(monthlyDiv)}/hó osztalék · ${fmt(totalMonthly)} fix kiadásból`;
  } else {
    drEl.textContent = '—';
    drEl.className = 'stat-value yellow';
    drSub.textContent = 'Nincs rögzített havi fix kiadás';
  }
  dm.innerHTML = `
    <div class="stat-value yellow" style="font-size:24px">${fmt(totalMonthly)}</div>
    <div class="stat-sub" style="margin-bottom:12px">Havi törlesztő + fix kiadások</div>
    <div class="tax-row"><span style="color:var(--muted)">Hitelek száma</span><span>${state.loans.length} db</span></div>
    <div class="tax-row"><span style="color:var(--muted)">Havi törlesztő</span><span class="red">${fmt(monthlyLoan)}</span></div>
    <div class="tax-row"><span style="color:var(--muted)">Szolgáltatások</span><span>${svcCount} db</span></div>
    <div class="tax-row"><span style="color:var(--muted)">Szolgáltatások összege</span><span class="red">${fmt(svcMonthly)}</span></div>
  `;

  drawDonut([
    { label: 'Arany', value: goldVal, color: '#C08A2E' },
    { label: 'Részvény', value: stockVal, color: '#3FA36C' },
    { label: 'Kripto', value: cryptoOpen, color: '#4FA7BD' },
    { label: 'Zálog (−)', value: totalPledge, color: '#8B6690' },
    { label: 'Hitel (−)', value: totalLoan, color: '#C24A3A' },
  ]);
}

function renderWatch() {
  const rb = document.getElementById('watch-refresh-bar');
  if (rb) rb.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <button class="btn btn-secondary btn-sm" onclick="refreshAllPrices()">Élő árfolyam frissítés</button>
      <span class="refresh-status" style="font-size:11px;color:var(--muted)"></span>
    </div>`;
  const coins = calcCryptoPL();

  const stockBox = document.getElementById('dash-stocks');
  if (stockBox) {
    if (state.stocks.length) {
      const agg = {};
      state.stocks.forEach(s=>{
        const cur = s.currency||'HUF';
        const k = s.ticker.toUpperCase()+'|'+cur;
        const live = getLivePrice(s.ticker);
        const cp = live || s.price;
        if (!agg[k]) agg[k] = { ticker:s.ticker, cur, qty:0, inv:0, val:0, lots:0, live:!!live };
        agg[k].qty += s.qty;
        agg[k].inv += s.qty*s.avg;
        agg[k].val += s.qty*cp;
        agg[k].lots++;
      });
      stockBox.innerHTML = Object.values(agg).map(a=>{
        const pl = a.val - a.inv;
        const plPct = a.inv ? pl/a.inv*100 : 0;
        const badge = a.live ? `<span class="badge badge-green">● élő</span>` : `<span class="badge badge-yellow">manuális</span>`;
        return dashTile(`${a.ticker} <span class="badge badge-cyan">${a.cur}</span>`, badge, [
          ['Mennyiség', `${fmtNum(a.qty)} db${a.lots>1?` · ${a.lots} tétel`:''}`, ''],
          ['Befektetett (Ft)', fmt(a.inv), ''],
          ['Jelenlegi érték (Ft)', fmt(a.val), 'cyan'],
          ['P&L (Ft)', `${pl>=0?'+':''}${fmt(pl)} (${plPct.toFixed(1)}%)`, pl>=0?'green':'red'],
        ]);
      }).join('');
    } else stockBox.innerHTML = emptyTile('Nincs részvény');
  }

  const cryptoBox = document.getElementById('dash-crypto');
  if (cryptoBox) {
    const entries = Object.entries(coins);
    if (entries.length) {
      cryptoBox.innerHTML = entries.map(([coin,c])=>{
        const openQty = c.buys.reduce((a,b)=>a+b.qty,0);
        const openCost = c.buys.reduce((a,b)=>a+b.qty*b.price,0);
        const live = getLivePrice(coin);
        const liveVal = live ? openQty*live : null;
        const unreal = liveVal!==null ? liveVal-openCost : null;
        const updatedAt = getLiveUpdatedAt(coin);
        const badge = live ? `<span class="badge badge-green">● élő</span>` : '';
        const rows = [
          ['Realizált P&L', fmt(c.realized), c.realized>=0?'green':'red'],
          ['Nyitott pozíció (bekerülési)', fmt(openCost), ''],
        ];
        if (liveVal!==null) {
          rows.push(['Aktuális eladási érték', fmt(liveVal), 'cyan']);
          rows.push(['Nem realizált P&L', `${unreal>=0?'+':''}${fmt(unreal)}`, unreal>=0?'green':'red']);
        }
        return dashTile(coin, badge, rows, liveVal!==null && updatedAt ? `Frissítve: ${updatedAt}` : '');
      }).join('');
    } else cryptoBox.innerHTML = emptyTile('Nincs kripto');
  }

  const goldBox = document.getElementById('dash-gold');
  const goldPledgedBox = document.getElementById('dash-gold-pledged');
  if (goldBox || goldPledgedBox) {
    const spot = state.goldSpot || 28000;
    const pledgedSet = pledgedGoldIds();

    const buildAgg = items => {
      const agg = {};
      items.forEach(g=>{
        const k = `${g.name}|${g.grams}|${g.purity}|${g.form}`;
        if (!agg[k]) agg[k] = { name:g.name, grams:g.grams, count:0, totalGrams:0, cost:0, val:0 };
        agg[k].count++;
        agg[k].totalGrams += g.grams;
        agg[k].cost += g.cost;
        agg[k].val += goldItemValue(g, spot);
      });
      return agg;
    };

    const goldTile = (a, pledgeBadge) => {
      const pl = a.val - a.cost;
      const title = `${a.name}${a.count>1?` <span class="badge badge-yellow">${a.count} db</span>`:''}`;
      return dashTile(title, pledgeBadge||'', [
        ['Darab', `${a.count} db (${fmtNum(a.grams)} g/db)`, ''],
        ['Össztömeg', `${fmtNum(a.totalGrams)} g`, ''],
        ['Vételár', fmt(a.cost), ''],
        ['Jelenlegi érték', fmt(a.val), 'cyan'],
        ['P&L', `${pl>=0?'+':''}${fmt(pl)}`, pl>=0?'green':'red'],
      ]);
    };

    if (goldBox) {
      const freeItems = state.goldItems.filter(g => !pledgedSet.has(g.id));
      if (freeItems.length) {
        goldBox.innerHTML = Object.values(buildAgg(freeItems)).map(a => goldTile(a)).join('');
      } else {
        goldBox.innerHTML = emptyTile('Nincs szabad (nem zálogba adott) aranytétel');
      }
    }

    if (goldPledgedBox) {
      const pledgedItems = state.goldItems.filter(g => pledgedSet.has(g.id));
      if (pledgedItems.length) {
        const badge = `<span class="badge badge-purple">zálogban</span>`;
        goldPledgedBox.innerHTML = Object.values(buildAgg(pledgedItems)).map(a => goldTile(a, badge)).join('');
      } else {
        goldPledgedBox.innerHTML = emptyTile('Nincs zálogban lévő aranytétel');
      }
    }
  }
}

function dashTile(title, badgeHtml, rows, footer) {
  return `<div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <span style="font-family:var(--display);font-weight:700;font-size:15px">${title}</span>
      ${badgeHtml||''}
    </div>
    ${rows.map(r=>`
      <div style="font-size:11px;color:var(--muted);margin-top:8px">${r[0]}</div>
      <div class="${r[2]||''}" style="font-weight:600;font-size:14px">${r[1]}</div>
    `).join('')}
    ${footer ? `<div style="font-size:10px;color:var(--muted);margin-top:8px">${footer}</div>` : ''}
  </div>`;
}

function emptyTile(msg) {
  return `<div class="card" style="color:var(--muted);text-align:center;padding:24px;grid-column:1/-1">${msg}</div>`;
}

function drawDonut(segments) {
  const canvas = document.getElementById('donut-canvas');
  const ctx = canvas.getContext('2d');
  const total = segments.reduce((a,s)=>a+s.value,0);
  if (!total) {
    ctx.clearRect(0,0,140,140);
    document.getElementById('donut-legend').innerHTML = '<div style="color:var(--muted);font-size:12px">Nincs adat</div>';
    return;
  }
  ctx.clearRect(0,0,140,140);
  let angle = -Math.PI/2;
  const cx=70, cy=70, r=55, inner=32;
  segments.forEach(s => {
    const slice = (s.value/total)*Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,angle,angle+slice);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    angle += slice;
  });
  ctx.beginPath();
  ctx.arc(cx,cy,inner,0,Math.PI*2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#16201a';
  ctx.fill();

  const legend = document.getElementById('donut-legend');
  legend.innerHTML = segments.map(s => {
    const pct = total ? (s.value/total*100) : 0;
    return `
    <div class="legend-item">
      <span style="color:${s.color};font-weight:700;font-size:11px;min-width:38px;flex-shrink:0">${pct.toFixed(1)}%</span>
      <span style="color:var(--muted)">${s.label}</span>
      <span style="margin-left:auto;font-weight:600">${fmt(s.value)}</span>
    </div>
  `;
  }).join('');
}

function renderAll() {
  renderStocks();
  renderCrypto();
  renderGold();
  renderServices();
  renderLoans();
  renderPledges();
  renderDashboard();
  renderWatch();
}

/* Ez a rész NEM függ a betöltött state-től, azonnal futhat oldalbetöltéskor.
   A state-függő rész (afterDataLoaded) a firebase-init.js-ből fut le,
   miután a bejelentkezés megtörtént és a Firestore-adat megérkezett. */
document.addEventListener('DOMContentLoaded', () => {
  const crD = document.getElementById('cr-date'); if (crD) crD.value = now();
  const stD = document.getElementById('st-date'); if (stD) stD.value = now();
  const gdDate = document.getElementById('gd-date'); if (gdDate) gdDate.value = now();
  const plStart = document.getElementById('pl-start'); if (plStart) { plStart.value = now(); calcPledgeEndDate(); }
  const hd = document.getElementById('header-date');
  if (hd) hd.textContent = new Date().toLocaleDateString('hu-HU', {year:'numeric',month:'long',day:'numeric',weekday:'long'});

  showTab('dashboard');
});

/* Ezt a firebase-init.js hívja meg, miután a state betöltődött a Firestore-ból. */
function afterDataLoaded() {
  if (state.stocks.length || state.crypto.length || state.goldItems.length) {
    refreshAllPrices();
  } else {
    fetchFxRates().then(() => { updateStockLabels(); renderCrypto(); });
  }
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ============================================================
   SZÁMLÁK — invoice modul
   ============================================================ */

if (!state.invoices) state.invoices = [];

/* Kifizetett számlák bevételi tételeinek szinkronizálása */
