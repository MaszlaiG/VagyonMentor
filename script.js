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

    // Fiók oldal mezők feltöltése
    const accName = document.getElementById('acc-name');
    const accEmail = document.getElementById('acc-email');
    if (accName) accName.value = user.displayName || '';
    if (accEmail) accEmail.value = user.email || '';

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
      if (loginError) { loginError.style.color = ''; loginError.textContent = hibaSzoveg(err); }
    });
}

function resetPassword() {
  const email = document.getElementById('login-email').value.trim();
  const loginError = document.getElementById('login-error');
  if (!email) {
    if (loginError) { loginError.style.color = ''; loginError.textContent = 'Írd be az e-mail címed, oda küldjük a visszaállító linket.'; }
    return;
  }
  auth.sendPasswordResetEmail(email)
    .then(() => {
      if (loginError) { loginError.style.color = 'var(--accent)'; loginError.textContent = 'Jelszó-visszaállító e-mailt küldtünk a ' + email + ' címre. Nézd meg a postaládád (a spam mappát is).'; }
    })
    .catch(err => {
      if (loginError) { loginError.style.color = ''; loginError.textContent = hibaSzoveg(err); }
    });
}

function registerWithEmail() {
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-password').value;
  const pass2 = document.getElementById('reg-password2').value;
  const err   = document.getElementById('reg-error');
  if (!email || !pass) { if (err) err.textContent = 'Add meg az e-mail címet és a jelszót.'; return; }
  if (pass.length < 6) { if (err) err.textContent = 'A jelszónak legalább 6 karakternek kell lennie.'; return; }
  if (pass !== pass2)  { if (err) err.textContent = 'A két jelszó nem egyezik.'; return; }
  auth.createUserWithEmailAndPassword(email, pass)
    .catch(e => { if (err) err.textContent = hibaSzoveg(e); });
}

function authSlideTo(panel) {
  const slider = document.getElementById('auth-slider');
  if (!slider) return;
  if (panel === 'register') {
    slider.style.transform = 'translateX(-50%)';
    document.getElementById('login-error').textContent = '';
  } else {
    slider.style.transform = 'translateX(0)';
    document.getElementById('reg-error').textContent = '';
  }
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
    case 'auth/invalid-credential': return 'Hibás e-mail cím vagy jelszó.';
    case 'auth/email-already-in-use': return 'Ez az e-mail cím már regisztrálva van — jelentkezz be.';
    case 'auth/weak-password': return 'Túl gyenge jelszó (min. 6 karakter).';
    case 'auth/requires-recent-login': return 'A művelethez nemrégiben kell bejelentkezni. Jelentkezz ki, majd be újra.';
    default: return 'Hiba történt: ' + err.message;
  }
}

function accMsg(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : 'var(--accent)';
  if (text) setTimeout(() => { el.textContent = ''; }, 5000);
}

async function updateProfile() {
  const user = auth.currentUser;
  if (!user) return;
  const name  = (document.getElementById('acc-name').value  || '').trim();
  const email = (document.getElementById('acc-email').value || '').trim();
  if (!email) { accMsg('acc-profile-msg', 'Az e-mail cím nem lehet üres.', true); return; }
  try {
    const promises = [];
    if (name !== (user.displayName || '')) {
      promises.push(user.updateProfile({ displayName: name }));
    }
    if (email !== user.email) {
      promises.push(user.updateEmail(email));
    }
    await Promise.all(promises);
    const userLabel = document.getElementById('logged-in-as');
    if (userLabel) userLabel.textContent = auth.currentUser.email || '';
    accMsg('acc-profile-msg', '✓ Adatok elmentve.', false);
  } catch (err) {
    accMsg('acc-profile-msg', hibaSzoveg(err), true);
  }
}

async function updatePassword() {
  const user = auth.currentUser;
  if (!user) return;
  const cur   = document.getElementById('acc-cur-pass').value;
  const next  = document.getElementById('acc-new-pass').value;
  const next2 = document.getElementById('acc-new-pass2').value;
  if (!cur || !next) { accMsg('acc-pass-msg', 'Töltsd ki az összes jelszómezőt.', true); return; }
  if (next !== next2) { accMsg('acc-pass-msg', 'A két új jelszó nem egyezik.', true); return; }
  if (next.length < 6) { accMsg('acc-pass-msg', 'Az új jelszónak min. 6 karakternek kell lennie.', true); return; }
  try {
    // Újrahitelesítés a jelenlegi jelszóval
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, cur);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(next);
    document.getElementById('acc-cur-pass').value = '';
    document.getElementById('acc-new-pass').value = '';
    document.getElementById('acc-new-pass2').value = '';
    accMsg('acc-pass-msg', '✓ Jelszó sikeresen módosítva.', false);
  } catch (err) {
    accMsg('acc-pass-msg', hibaSzoveg(err), true);
  }
}

function switchAccount() {
  if (!confirm('A fiókváltáshoz kijelentkeztetünk — utána más fiókkal is bejelentkezhetsz. Folytatod?')) return;
  auth.signOut();
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
let goldSpotLive = false;

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

/* ---- Pénzügyi kimutatás (automatikus PDF) ----
   A dashboard-dal egyező számításokból egy új fülön egyből a kész PDF-et
   jeleníti meg a böngésző PDF-nézegetőjében (ahol meg is tekinthető és
   letölthető), nyomtatási ablak nélkül. Minden oldalon „Vagyon Mentor"
   fejléc és lap alján középen oldalszám; a ki nem férő táblázatok új
   oldalon kezdődnek (html2pdf + jsPDF). */
function generateFinancialReport() {
  const esc = escHtml;
  const spot = state.goldSpot || 28000;
  const neg = n => (n > 0 ? '−' : '') + fmt(n);
  const pl = (n, pct) => `<span class="${n>=0?'pos':'neg'}">${n>=0?'+':''}${fmt(n)}${pct!=null&&isFinite(pct)?` (${n>=0?'+':''}${pct.toFixed(1)}%)`:''}</span>`;

  // --- Arany ---
  const goldRows = state.goldItems.map(g => {
    const val = goldItemValue(g, spot);
    const c = g.cost || 0;
    return { g, val, cost: c, pl: val - c, plPct: c ? (val - c) / c * 100 : null };
  });
  const goldVal = goldRows.reduce((a,r)=>a+r.val,0);
  const goldCost = goldRows.reduce((a,r)=>a+r.cost,0);
  const goldPL = goldVal - goldCost;

  // --- Részvények (tickerenként, HUF) ---
  const stGroups = {};
  state.stocks.forEach(s => { (stGroups[s.ticker] = stGroups[s.ticker] || []).push(s); });
  const stockRows = Object.entries(stGroups).map(([ticker, lots]) => {
    const first = lots[0];
    const price = getLivePrice(ticker) || first.price;
    let qty = 0, invHuf = 0;
    lots.forEach(l => { qty += l.qty; invHuf += l.qty * l.avg; });
    const curHuf = qty * price;
    const divYield = stockDivYield(first, price);
    const annualDiv = stockIsCash(first) ? curHuf * divYield / 100 : 0;
    return { ticker, name: first.name || '', qty, avgHuf: qty ? invHuf/qty : 0, priceHuf: price,
             invHuf, curHuf, pl: curHuf - invHuf, plPct: invHuf ? (curHuf - invHuf)/invHuf*100 : null, annualDiv };
  }).sort((a,b)=>b.curHuf - a.curHuf);
  const stockVal = stockRows.reduce((a,r)=>a+r.curHuf,0);
  const stockCost = stockRows.reduce((a,r)=>a+r.invHuf,0);
  const stockPL = stockVal - stockCost;
  const annualDiv = annualStockDividendHuf();

  // --- Kripto (nyitott pozíció coinonként, HUF) ---
  const coins = calcCryptoPL();
  const cryptoRows = Object.entries(coins).map(([coin, c]) => {
    const openQty = c.buys.reduce((a,b)=>a+b.qty,0);
    if (openQty <= 0) return null;
    const openCost = c.buys.reduce((a,b)=>a+b.qty*b.price,0);
    const live = getLivePrice(coin);
    const curVal = live ? openQty * live : openCost;
    return { coin, qty: openQty, avgHuf: openCost/openQty, priceHuf: live || openCost/openQty,
             invHuf: openCost, curHuf: curVal, pl: curVal - openCost, plPct: openCost ? (curVal-openCost)/openCost*100 : null };
  }).filter(Boolean).sort((a,b)=>b.curHuf - a.curHuf);
  const cryptoVal = cryptoRows.reduce((a,r)=>a+r.curHuf,0);
  const cryptoCost = cryptoRows.reduce((a,r)=>a+r.invHuf,0);
  const cryptoPL = cryptoVal - cryptoCost;

  // --- Hitelek ---
  const loanRows = state.loans.map(l => ({ l, remaining: calcRemaining(l) }));
  const totalLoan = loanRows.reduce((a,r)=>a+r.remaining,0);
  const loanOrig = state.loans.reduce((a,l)=>a+(l.orig||0),0);
  const monthlyLoan = state.loans.reduce((a,l)=>a+(l.monthly||0),0);

  // --- Zálog ---
  const pledgeRows = state.pledges.map(p => ({ p, d: calcPledgeDebt(p) }));
  const totalPledge = pledgeTotalDebt();
  const pledgePrincipal = pledgeRows.reduce((a,r)=>a+(r.d.principal||0),0);
  const pledgeRepay = pledgeRows.reduce((a,r)=>a+(r.d.totalRepay||0),0);

  // --- Szolgáltatások (aktív) ---
  const svcRows = state.services.filter(s=>s.active).map(s => ({ s, monthly: serviceMonthlyCost(s), next: nextChargeDate(s.day) }));
  const svcMonthly = svcRows.reduce((a,r)=>a+r.monthly,0);

  // --- Összesítők (a dashboard logikája szerint) ---
  const currentValue = stockVal + goldVal + cryptoVal;
  const investedCost = stockCost + goldCost + cryptoCost;
  const unrealPL = currentValue - investedCost;
  const totalLiab = totalLoan + totalPledge;
  const netWorth = currentValue - totalLiab;
  const totalMonthly = monthlyLoan + svcMonthly;
  const share = v => currentValue > 0 ? (v / currentValue * 100).toFixed(1) + '%' : '—';

  // --- Fiók infó ---
  let acctName = '', acctEmail = '';
  try { acctName = (document.getElementById('acc-name') || {}).value || ''; } catch(e){}
  try { acctEmail = (document.getElementById('acc-email') || {}).value || ''; } catch(e){}
  try { if (!acctEmail && typeof auth !== 'undefined' && auth.currentUser) acctEmail = auth.currentUser.email || ''; } catch(e){}

  const dt = new Date();
  const genStr = dt.toLocaleString('hu-HU');
  const pad = x => String(x).padStart(2,'0');
  const dateFile = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
  const priceNote = goldSpotLive ? 'élő árfolyamok alapján' : 'utolsó ismert árfolyamok alapján';

  const tbl = (head, body, foot) =>
    `<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="20" class="muted" style="text-align:center;padding:14px">Nincs rögzített tétel.</td></tr>`}</tbody>${foot?`<tfoot>${foot}</tfoot>`:''}</table>`;

  // Összefoglaló
  const sumItem = (lbl, val, cls) => `<div class="sum-item"><span class="lbl">${lbl}</span><span class="val ${cls||''}">${val}</span></div>`;
  const summaryHtml = `<div class="summary">
    ${sumItem('Nettó vagyon', fmt(netWorth), netWorth>=0?'pos':'neg')}
    ${sumItem('Befektetett eszközök értéke', fmt(currentValue))}
    ${sumItem('Bekerülési (befektetett) költség', fmt(investedCost))}
    ${sumItem('Nem realizált eredmény', pl(unrealPL, investedCost>0?unrealPL/investedCost*100:null))}
    ${sumItem('Összes tartozás (hitel + zálog)', fmt(totalLiab))}
    ${sumItem('Havi fix kiadás (törlesztő + előfizetés)', fmt(totalMonthly))}
    ${sumItem('Éves osztalék (becsült)', fmt(annualDiv), 'gold')}
    ${sumItem('Havi osztalék (becsült)', fmt(annualDiv/12), 'gold')}
  </div>`;

  // Vagyonmegoszlás
  const allocHtml = tbl(
    `<th>Tétel</th><th class="num">Érték</th><th class="num">Arány</th>`,
    `<tr><td>Arany</td><td class="num">${fmt(goldVal)}</td><td class="num">${share(goldVal)}</td></tr>
     <tr><td>Részvény</td><td class="num">${fmt(stockVal)}</td><td class="num">${share(stockVal)}</td></tr>
     <tr><td>Kripto</td><td class="num">${fmt(cryptoVal)}</td><td class="num">${share(cryptoVal)}</td></tr>
     <tr class="subtotal"><td>Befektetett eszközök összesen</td><td class="num">${fmt(currentValue)}</td><td class="num">100%</td></tr>
     <tr><td>Hitel</td><td class="num neg">${neg(totalLoan)}</td><td class="num muted">—</td></tr>
     <tr><td>Zálog</td><td class="num neg">${neg(totalPledge)}</td><td class="num muted">—</td></tr>`,
    `<tr><td>Nettó vagyon</td><td class="num ${netWorth>=0?'pos':'neg'}">${fmt(netWorth)}</td><td></td></tr>`
  );

  // Arany
  const goldBody = goldRows.map(r => `<tr>
    <td>${esc(r.g.name||'Arany')}</td><td>${esc(r.g.code||'—')}</td><td>${esc(r.g.form||'—')}</td><td>${esc(r.g.purity||'—')}</td>
    <td class="num">${fmtNum(r.g.grams)}</td><td class="num">${fmt(r.cost)}</td><td class="num">${fmt(r.val)}</td><td class="num">${pl(r.pl, r.plPct)}</td>
  </tr>`).join('');
  const goldHtml = tbl(
    `<th>Megnevezés</th><th>Kód</th><th>Forma</th><th>Tisztaság</th><th class="num">Tömeg (g)</th><th class="num">Bekerülés</th><th class="num">Jelenlegi érték</th><th class="num">Eredmény</th>`,
    goldBody,
    goldRows.length ? `<tr><td colspan="5">Összesen</td><td class="num">${fmt(goldCost)}</td><td class="num">${fmt(goldVal)}</td><td class="num">${pl(goldPL, goldCost?goldPL/goldCost*100:null)}</td></tr>` : ''
  );

  // Részvények
  const stockBody = stockRows.map(r => `<tr>
    <td><strong>${esc(r.ticker)}</strong></td><td>${esc(r.name||'—')}</td><td class="num">${fmtNum(r.qty)}</td>
    <td class="num">${fmt(r.avgHuf)}</td><td class="num">${fmt(r.priceHuf)}</td><td class="num">${fmt(r.invHuf)}</td>
    <td class="num">${fmt(r.curHuf)}</td><td class="num">${pl(r.pl, r.plPct)}</td><td class="num gold">${fmt(r.annualDiv)}</td>
  </tr>`).join('');
  const stockHtml = tbl(
    `<th>Ticker</th><th>Név</th><th class="num">Db</th><th class="num">Átlag vételár</th><th class="num">Jelenlegi ár</th><th class="num">Befektetett</th><th class="num">Jelenlegi érték</th><th class="num">Eredmény</th><th class="num">Éves osztalék</th>`,
    stockBody,
    stockRows.length ? `<tr><td colspan="5">Összesen</td><td class="num">${fmt(stockCost)}</td><td class="num">${fmt(stockVal)}</td><td class="num">${pl(stockPL, stockCost?stockPL/stockCost*100:null)}</td><td class="num gold">${fmt(annualDiv)}</td></tr>` : ''
  );

  // Kripto
  const cryptoBody = cryptoRows.map(r => `<tr>
    <td><strong>${esc(r.coin)}</strong></td><td class="num">${fmtNum(r.qty)}</td><td class="num">${fmt(r.avgHuf)}</td>
    <td class="num">${fmt(r.priceHuf)}</td><td class="num">${fmt(r.invHuf)}</td><td class="num">${fmt(r.curHuf)}</td><td class="num">${pl(r.pl, r.plPct)}</td>
  </tr>`).join('');
  const cryptoHtml = tbl(
    `<th>Coin</th><th class="num">Db</th><th class="num">Átlag vételár</th><th class="num">Jelenlegi ár</th><th class="num">Befektetett</th><th class="num">Jelenlegi érték</th><th class="num">Eredmény</th>`,
    cryptoBody,
    cryptoRows.length ? `<tr><td colspan="4">Összesen</td><td class="num">${fmt(cryptoCost)}</td><td class="num">${fmt(cryptoVal)}</td><td class="num">${pl(cryptoPL, cryptoCost?cryptoPL/cryptoCost*100:null)}</td></tr>` : ''
  );

  // Hitelek
  const loanBody = loanRows.map(r => `<tr>
    <td>${esc(r.l.name||'—')}</td><td class="num">${fmt(r.l.orig)}</td><td class="num">${fmt(r.l.monthly)}</td>
    <td class="num">${r.l.rate?r.l.rate+'%':'—'}</td><td class="num">${fmt(r.remaining)}</td><td class="num">${esc(r.l.end||'—')}</td>
  </tr>`).join('');
  const loanHtml = tbl(
    `<th>Név</th><th class="num">Eredeti összeg</th><th class="num">Havi törlesztő</th><th class="num">Kamat</th><th class="num">Hátralévő tartozás</th><th class="num">Lejárat</th>`,
    loanBody,
    loanRows.length ? `<tr><td>Összesen</td><td class="num">${fmt(loanOrig)}</td><td class="num">${fmt(monthlyLoan)}</td><td></td><td class="num">${fmt(totalLoan)}</td><td></td></tr>` : ''
  );

  // Zálog
  const pledgeBody = pledgeRows.map(r => `<tr>
    <td>${esc(r.p.ticketNo||'—')}</td><td>${esc((r.p.goldNames&&r.p.goldNames.length)?r.p.goldNames.join(', '):'—')}</td>
    <td class="num">${fmt(r.d.principal)}</td><td class="num">${fmt(r.d.cashReceived)}</td><td class="num">${fmt(r.d.currentDebt)}</td>
    <td class="num">${fmt(r.d.totalRepay)}</td><td class="num">${esc(r.p.end||'—')}</td>
  </tr>`).join('');
  const pledgeHtml = tbl(
    `<th>Zálogjegy</th><th>Fedezet</th><th class="num">Kölcsön</th><th class="num">Kézhez kapott</th><th class="num">Jelenlegi tartozás</th><th class="num">Visszafizetendő</th><th class="num">Lejárat</th>`,
    pledgeBody,
    pledgeRows.length ? `<tr><td colspan="2">Összesen</td><td class="num">${fmt(pledgePrincipal)}</td><td></td><td class="num">${fmt(totalPledge)}</td><td class="num">${fmt(pledgeRepay)}</td><td></td></tr>` : ''
  );

  // Szolgáltatások
  const svcBody = svcRows.map(r => {
    const cat = Array.isArray(r.s.cat) ? r.s.cat.join(', ') : (r.s.cat || '');
    return `<tr>
      <td>${esc(r.s.name||'—')}</td><td class="muted">${esc(cat||'—')}</td><td class="num">${fmt(r.s.amount)}</td>
      <td>${esc(CYCLE_LABEL[r.s.cycle]||r.s.cycle||'—')}</td><td class="num">${fmt(r.monthly)}</td><td class="num">${r.next?r.next.toLocaleDateString('hu-HU'):'—'}</td>
    </tr>`;
  }).join('');
  const svcHtml = tbl(
    `<th>Név</th><th>Kategória</th><th class="num">Összeg</th><th>Ciklus</th><th class="num">Havi költség</th><th class="num">Köv. terhelés</th>`,
    svcBody,
    svcRows.length ? `<tr><td colspan="4">Havi összesen</td><td class="num">${fmt(svcMonthly)}</td><td class="num muted">${fmt(svcMonthly*12)}/év</td></tr>` : ''
  );

  const html = `<!doctype html><html lang="hu"><head><meta charset="utf-8">
<title>VagyonMentor_penzugyi_kimutatas_${dateFile}</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1c1c1c;margin:0;background:#eceae4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc{max-width:840px;margin:0 auto;background:#fff;padding:34px 40px}
h1{font-size:22px;margin:0 0 2px}
.brand{color:#b8873a;font-weight:700;letter-spacing:.5px;font-size:12px;text-transform:uppercase;margin-bottom:10px}
.meta{color:#666;font-size:11.5px;margin-bottom:6px;line-height:1.6}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:#b8873a;border-bottom:2px solid #e6e0d4;padding-bottom:6px;margin:28px 0 12px}
table{width:100%;border-collapse:collapse;font-size:11.5px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #efefef}
th{color:#999;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.4px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tfoot td{font-weight:700;border-top:2px solid #ddd;border-bottom:none;background:#faf7f1}
tr.subtotal td{font-weight:700;border-top:1px solid #ddd;background:#faf9f6}
.pos{color:#1a7f4b}.neg{color:#b23b2e}.muted{color:#999}.gold{color:#b8873a}
.summary{display:grid;grid-template-columns:repeat(2,1fr);gap:0 28px}
.sum-item{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid #f1f1f1;font-size:12.5px}
.sum-item .lbl{color:#555}.sum-item .val{font-weight:700;white-space:nowrap}
section{margin-bottom:6px}
thead{display:table-header-group}
tr{page-break-inside:avoid}
footer{margin-top:30px;padding-top:12px;border-top:1px solid #eee;color:#999;font-size:10px;line-height:1.6}
#vm-loader{position:fixed;inset:0;z-index:9999;background:#eceae4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-size:15px;color:#555}
#vm-loader .spin{width:34px;height:34px;border:3px solid #d8d2c6;border-top-color:#b8873a;border-radius:50%;animation:vmspin 0.8s linear infinite}
@keyframes vmspin{to{transform:rotate(360deg)}}
@media print{body{background:#fff}.no-print{display:none!important}.doc{max-width:none;padding:0}@page{size:A4;margin:14mm}}
</style>
<script src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js"></script>
</head>
<body>
<div id="vm-loader"><div class="spin"></div><div>Kimutatás készítése…</div></div>
<div class="doc">
  <div class="brand">VagyonMentor</div>
  <h1>Pénzügyi kimutatás</h1>
  <div class="meta">
    Készült: ${esc(genStr)}${acctName?` &nbsp;·&nbsp; ${esc(acctName)}`:''}${acctEmail?` &nbsp;·&nbsp; ${esc(acctEmail)}`:''}<br>
    Minden érték HUF-ban, a ${priceNote}. A részvény- és kriptoárfolyamok HUF-ra átváltva.
  </div>

  <section><h2>Összefoglaló</h2>${summaryHtml}</section>
  <section><h2>Vagyonmegoszlás</h2>${allocHtml}</section>
  <section><h2>Arany</h2>${goldHtml}</section>
  <section><h2>Részvények</h2>${stockHtml}</section>
  <section><h2>Kripto</h2>${cryptoHtml}</section>
  <section><h2>Hitelek</h2>${loanHtml}</section>
  <section><h2>Zálog</h2>${pledgeHtml}</section>
  <section><h2>Előfizetések / szolgáltatások</h2>${svcHtml}</section>

  <footer>
    Ez a kimutatás tájékoztató jellegű, a VagyonMentor alkalmazásban rögzített adatokból és az utolsó lekért árfolyamokból készült. Nem minősül pénzügyi tanácsadásnak vagy hivatalos elszámolásnak. A pontos, naprakész értékekért frissítsd az élő árfolyamokat a kimutatás előtt.
  </footer>
</div>
<script>
(function(){
  var loader=document.getElementById('vm-loader');
  function msg(t){ if(loader){ loader.innerHTML='<div style="max-width:340px;text-align:center;line-height:1.55">'+t+'</div>'; } }
  var waited=0;
  function run(){
    if(typeof html2pdf==='undefined'){
      waited+=150;
      if(waited>12000){ msg('A PDF-készítő könyvtár nem töltődött be. Ellenőrizd az internetkapcsolatot, majd próbáld újra.'); return; }
      setTimeout(run,150); return;
    }
    var el=document.querySelector('.doc');
    var opt={
      margin:[17,10,15,10],
      filename:'VagyonMentor_penzugyi_kimutatas_${dateFile}.pdf',
      image:{type:'jpeg',quality:0.98},
      html2canvas:{scale:2,backgroundColor:'#ffffff',useCORS:true},
      jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},
      pagebreak:{mode:['css','legacy'],avoid:['section','tr']}
    };
    html2pdf().set(opt).from(el).toPdf().get('pdf').then(function(pdf){
      var total=pdf.internal.getNumberOfPages();
      var pw=pdf.internal.pageSize.getWidth();
      var ph=pdf.internal.pageSize.getHeight();
      for(var i=1;i<=total;i++){
        pdf.setPage(i);
        pdf.setFont('helvetica','bold'); pdf.setFontSize(10); pdf.setTextColor(184,135,58);
        pdf.text('Vagyon Mentor', pw/2, 9, {align:'center'});
        pdf.setDrawColor(228,222,210); pdf.setLineWidth(0.2); pdf.line(10,11.5,pw-10,11.5);
        pdf.setFont('helvetica','normal'); pdf.setFontSize(8.5); pdf.setTextColor(150,150,150);
        pdf.text(i+' / '+total, pw/2, ph-6, {align:'center'});
      }
      try { pdf.setProperties({ title:'VagyonMentor penzugyi kimutatas ${dateFile}' }); } catch(e){}
      // A blobot ebben az ablakban hozzuk létre és iframe-be ágyazzuk,
      // hogy a cím ne vonódjon vissza (nem navigálunk el).
      var url=URL.createObjectURL(pdf.output('blob'));
      document.body.innerHTML='';
      document.body.style.margin='0';
      var f=document.createElement('iframe');
      f.src=url;
      f.setAttribute('style','position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff');
      f.setAttribute('title','Pénzügyi kimutatás');
      document.body.appendChild(f);
    }).catch(function(){ msg('Nem sikerült a PDF elkészítése. Zárd be az ablakot és próbáld újra.'); });
  }
  run();
})();
</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('A kimutatás megnyitásához engedélyezd a felugró ablakokat ehhez az oldalhoz.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
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

/* Yahoo osztaléktörténet → gördülő 12 havi osztalék/részvény (natív deviza).
   Az utolsó 365 nap kifizetéseit összegzi; ha van, ez a trailing éves osztalék. */
async function fetchStockDividendInfo(ticker) {
  try {
    const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
    for (const host of hosts) {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2y&events=div&_=${Date.now()}`;
      const data = await fetchJsonViaProxies(url);
      const divs = data?.chart?.result?.[0]?.events?.dividends;
      if (divs) {
        const list = Object.values(divs).filter(d => d && typeof d.amount === 'number').sort((a,b)=>a.date-b.date);
        if (!list.length) continue;
        const nowSec = Date.now()/1000;
        // Hónap-térkép: minden naptári hónaphoz a legutóbbi (utolsó ~15 hó) kifizetés összege
        const byMonth = {};
        list.forEach(d => {
          if (d.date >= nowSec - 460*24*3600) {
            const m = new Date(d.date*1000).getMonth() + 1;
            byMonth[m] = d.amount; // a későbbi felülírja → a legfrissebb marad
          }
        });
        // Havi fizető felismerése: ha az elmúlt évben ≥10 kifizetés volt, minden hónapot kitöltünk
        const paymentsLastYear = list.filter(d => d.date >= nowSec - 365*24*3600).length;
        if (paymentsLastYear >= 10) {
          const lastAmt = list[list.length - 1].amount;
          for (let m = 1; m <= 12; m++) byMonth[m] = lastAmt;
        }
        // Éves osztalék = a hónap-térkép összege (aktuális futó ütem), hogy a
        // részvény oldali "Éves osztalék" és a naptár összege megegyezzen.
        const annual = Object.values(byMonth).reduce((a,v)=>a+v, 0);
        if (annual > 0 || Object.keys(byMonth).length) return { annual, byMonth };
      }
    }
    return null;
  } catch(e) { return null; }
}

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
    // Hiányzó teljes nevek pótlása coinonként (a részvények mintájára)
    for (const sym of cryptoTickers) {
      const hasName = state.crypto.some(c => c.coin.toUpperCase() === sym && c.name);
      if (!hasName) {
        const nm = await resolveCryptoName(sym);
        if (nm) state.crypto.forEach(c => { if (c.coin.toUpperCase() === sym && !c.name) c.name = nm; });
      }
    }
  }

  const failedTickers = [];
  const divInfoCache = {};
  const nameCache = {};
  for (const s of state.stocks) {
    const ticker = s.ticker.toUpperCase();
    const price = await fetchStockPriceHuf(s.ticker, s.currency);
    if (price) {
      priceCache[ticker] = { price, updatedAt: new Date().toLocaleTimeString('hu-HU') };
      s.price = price;
    } else if (!failedTickers.includes(ticker)) {
      failedTickers.push(ticker);
    }
    // Hiányzó teljes név pótlása a tickerből (Yahoo kereső)
    if (!s.name) {
      if (!(ticker in nameCache)) nameCache[ticker] = await resolveTicker(s.ticker);
      const r = nameCache[ticker];
      if (r && r.name) s.name = r.name;
    }
    // Osztalék automatikus követése (éves összeg + fizetési hónapok)
    if (s.divAuto && (s.divType || 'cash') === 'cash') {
      if (!(ticker in divInfoCache)) divInfoCache[ticker] = await fetchStockDividendInfo(s.ticker);
      const info = divInfoCache[ticker];
      if (info) { s.divAnnualNative = info.annual; s.divByMonthNative = info.byMonth; }
    }
  }

  if (state.goldItems && state.goldItems.length) {
    const gp = await fetchGoldSpotHuf();
    if (gp) {
      state.goldSpot = Math.round(gp);
      goldSpotLive = true;
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
  document.querySelectorAll('.header-nav button').forEach(b => b.classList.remove('active'));
  const tab = document.getElementById('tab-' + id);
  if (tab) tab.classList.add('active');
  const activeBtn = document.querySelector('.header-nav button[data-tab="' + id + '"]');
  if (activeBtn) {
    activeBtn.classList.add('active');
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
  const btn = document.getElementById('hamburger-btn');
  const open = nav.classList.toggle('open');
  if (btn) btn.classList.toggle('open', open);
  if (open) {
    // Kattintás a nav-on kívülre → bezár
    setTimeout(() => document.addEventListener('click', navOutsideClick), 0);
  } else {
    document.removeEventListener('click', navOutsideClick);
  }
}

function navOutsideClick(e) {
  const nav = document.getElementById('main-nav');
  const btn = document.getElementById('hamburger-btn');
  if (nav && !nav.contains(e.target) && btn && !btn.contains(e.target)) {
    closeNav();
  }
}

function closeNav() {
  const nav = document.getElementById('main-nav');
  const btn = document.getElementById('hamburger-btn');
  if (nav) nav.classList.remove('open');
  if (btn) btn.classList.remove('open');
  document.removeEventListener('click', navOutsideClick);
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

async function resolveTicker(query) {
  const q = (query || '').trim();
  if (!q) return null;
  try {
    const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
    for (const host of hosts) {
      const url = `https://${host}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0&_=${Date.now()}`;
      const data = await fetchJsonViaProxies(url);
      const quotes = (data && data.quotes) || [];
      const best = quotes.find(x => x.symbol && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF'))
                || quotes.find(x => x.symbol);
      if (best && best.symbol) return { symbol: best.symbol.toUpperCase(), name: best.longname || best.shortname || q };
    }
    return null;
  } catch(e) { return null; }
}

async function addStock() {
  const ticker = (document.getElementById('st-name').value || '').trim().toUpperCase();
  const qty = parseFloat(document.getElementById('st-qty').value)||0;
  const currency = document.getElementById('st-currency').value;
  const avgNative = parseFloat(document.getElementById('st-avg').value)||0;
  const buyDate = document.getElementById('st-date').value || now();
  const msg = document.getElementById('st-add-msg');
  const btn = document.getElementById('st-add-btn');
  const setMsg = (t, c) => { if (msg) { msg.textContent = t; msg.style.color = c || 'var(--muted)'; } };

  if (!ticker || !qty || !avgNative) { setMsg('Adj meg tickert, darabszámot és vételi árat.', 'var(--red)'); return; }

  if (btn) btn.disabled = true;
  setMsg('Adatok lekérése…');

  // Best-effort teljes név a tickerhez (nem kötelező)
  let name = '';
  try { const r = await resolveTicker(ticker); if (r && r.name) name = r.name; } catch(e) {}

  const fxRate = await fxRateForDate(currency, buyDate);
  const avg = avgNative * fxRate;
  state.stocks.push({
    id: uid(),
    ticker,
    name,
    qty, avg, avgNative,
    price: avg,             // kezdő érték; az élő frissítés felülírja
    divYield: null,
    divType: 'cash',        // osztalék automatikus felismerése (0, ha nem fizet)
    divAuto: true,
    currency, buyDate
  });
  save();

  document.getElementById('st-name').value = '';
  document.getElementById('st-qty').value = '';
  document.getElementById('st-avg').value = '';
  document.getElementById('st-date').value = now();
  setMsg('');
  if (btn) btn.disabled = false;
  closeModal('stock-modal');
  renderAll();
  refreshAllPrices();     // azonnal lehúzza az árat és az osztalékot az új tételhez
}

function deleteStock(id) {
  state.stocks = state.stocks.filter(s=>s.id!==id);
  save(); renderAll();
}

/* ---- Részvény eladása (a kriptó Eladás mintájára) ---- */
let stockSellId = null;
function openStockSell(id) {
  const s = state.stocks.find(x => x.id === id);
  if (!s) return;
  stockSellId = id;
  const cur = s.currency || 'HUF';
  const rate = rateForCurrency(cur);
  const avgN = (s.avgNative != null) ? s.avgNative : (rate ? s.avg / rate : s.avg);
  const liveHuf = getLivePrice(s.ticker) || s.price;
  const curPriceN = rate ? liveHuf / rate : liveHuf;
  const sym = cur === 'HUF' ? 'Ft' : cur;
  document.getElementById('ss-info').innerHTML =
    `<strong style="color:var(--text);font-size:14px">${s.ticker}</strong>${s.name ? ' · ' + escHtml(s.name) : ''} · elérhető: <strong style="color:var(--accent2)">${fmtNum(s.qty)}</strong> db · átlagár: ${fmtCur(avgN, cur)}`;
  document.getElementById('ss-price-label').textContent = `Eladási ár / db (${sym})`;
  document.getElementById('ss-qty').value = s.qty;
  document.getElementById('ss-price').value = curPriceN ? curPriceN.toFixed(2) : '';
  document.getElementById('ss-date').value = now();
  document.getElementById('ss-error').style.display = 'none';
  updateStockSalePL();
  openModal('stock-sale-modal');
}
function updateStockSalePL() {
  const s = state.stocks.find(x => x.id === stockSellId);
  if (!s) return;
  const cur = s.currency || 'HUF';
  const rate = rateForCurrency(cur);
  const avgN = (s.avgNative != null) ? s.avgNative : (rate ? s.avg / rate : s.avg);
  const qty = parseFloat(document.getElementById('ss-qty').value) || 0;
  const price = parseFloat(document.getElementById('ss-price').value) || 0;
  const plN = qty * (price - avgN);
  const el = document.getElementById('ss-pl');
  if (el) el.innerHTML = `Eredmény (P&L): <strong class="${plN>=0?'green':'red'}">${plN>=0?'+':''}${fmtCur(plN, cur)}</strong>`;
}
async function confirmStockSell() {
  const s = state.stocks.find(x => x.id === stockSellId);
  if (!s) return;
  const cur = s.currency || 'HUF';
  const qty = parseFloat(document.getElementById('ss-qty').value) || 0;
  const priceNative = parseFloat(document.getElementById('ss-price').value) || 0;
  const date = document.getElementById('ss-date').value || now();
  const errEl = document.getElementById('ss-error');
  if (!qty || !priceNative) { errEl.textContent = 'Adj meg eladott mennyiséget és eladási árat.'; errEl.style.display = 'block'; return; }
  if (qty > s.qty + 1e-9) { errEl.textContent = `Legfeljebb ${fmtNum(s.qty)} db adható el.`; errEl.style.display = 'block'; return; }
  const fxRate = await fxRateForDate(cur, date);
  const priceHuf = priceNative * fxRate;
  const costHuf = qty * s.avg;
  const proceedsHuf = qty * priceHuf;
  const rate = rateForCurrency(cur);
  const avgN = (s.avgNative != null) ? s.avgNative : (rate ? s.avg / rate : s.avg);
  if (!state.stockSales) state.stockSales = [];
  state.stockSales.push({
    id: uid(), ticker: s.ticker, name: s.name || '', qty,
    avgNative: avgN, priceNative, currency: cur,
    proceedsHuf, costHuf, pl: proceedsHuf - costHuf, date
  });
  s.qty -= qty;
  if (s.qty <= 1e-9) state.stocks = state.stocks.filter(x => x.id !== s.id);
  save();
  closeModal('stock-sale-modal');
  stockSellId = null;
  renderAll();
}
function deleteStockFromSale() {
  if (!stockSellId) return;
  if (!confirm('Biztosan törlöd ezt a részvénytételt (eladás rögzítése nélkül)?')) return;
  state.stocks = state.stocks.filter(x => x.id !== stockSellId);
  save();
  closeModal('stock-sale-modal');
  stockSellId = null;
  renderAll();
}

// Visszaadja a részvény éves osztalékhozamát %-ban.
// Új adat: s.divYield (%). Régi adat: s.div (Ft/részvény) -> hozammá számolva.

function stockDivYield(s, currentPrice) {
  // Automatikus követés: a Yahoo-ról behúzott gördülő éves osztalék (natív) alapján
  if (s.divAuto && s.divAnnualNative != null && currentPrice) {
    const rate = rateForCurrency(s.currency || 'HUF');
    return s.divAnnualNative * rate / currentPrice * 100;
  }
  if (s.divYield != null) return s.divYield;
  return (s.div && currentPrice) ? (s.div / currentPrice * 100) : 0;
}

/* Régi (típus nélküli) tételeket kifizetőnek tekintjük. A visszaforgató
   (acc) részvény nem fizet készpénz-osztalékot, így nem adóztatjuk. */
function stockIsCash(s) { return (s.divType || 'cash') === 'cash'; }
function stockPaysNoDiv(s) { return s.divType === 'none'; }
function stockTypeShort(s) {
  if (s.divAuto) {
    const y = stockDivYield(s, getLivePrice(s.ticker) || s.price);
    return y > 0 ? 'Dist' : '—';
  }
  const t = s.divType || 'cash';
  if (t === 'cash') return 'Dist';
  if (t === 'acc') return 'Acc';
  return '—';
}

const DIV_MONTHS_SET = { '1': [1,4,7,10], '2': [2,5,8,11], '3': [3,6,9,12] };
const MONTH_ABBR = ['', 'Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];

function stockDivFreqLabel(s) {
  if (s.divAuto) return 'Osztalék automatikusan követve (Yahoo)';
  if (stockPaysNoDiv(s)) return 'Nem fizet osztalékot';
  if (!stockIsCash(s)) return 'Visszaforgató (akkumulációs)';
  const f = s.divFreq || 'yearly';
  if (f === 'monthly') return 'Havonta';
  if (f === 'quarterly') {
    const set = DIV_MONTHS_SET[s.divMonths || '3'] || DIV_MONTHS_SET['3'];
    return 'Negyedévente (' + set.map(m => MONTH_ABBR[m]).join(', ') + ')';
  }
  return 'Évente';
}

/* Éves készpénz-osztalék összesen (HUF) — csak a kifizető részvények. */
function annualStockDividendHuf() {
  return state.stocks.reduce((a, s) => {
    if (!stockIsCash(s)) return a;
    const cp = getLivePrice(s.ticker) || s.price;
    return a + s.qty * cp * (stockDivYield(s, cp) / 100);
  }, 0);
}

/* Osztalék-hónapok választó megjelenítése csak negyedéves gyakoriságnál */
function updateStockDivMonths() {
  const freq = document.getElementById('st-divfreq');
  const wrap = document.getElementById('st-divmonths-wrap');
  if (freq && wrap) wrap.style.display = (freq.value === 'quarterly') ? '' : 'none';
}

/* Ha a részvény nem fizet osztalékot, a hozam/gyakoriság mezők eltűnnek */
function updateStockDivType() {
  const type = (document.getElementById('st-divtype') || {}).value;
  const isNone = (type === 'none');
  const isCash = (type === 'cash');
  const divWrap  = document.getElementById('st-div-wrap');
  const freqWrap = document.getElementById('st-divfreq-wrap');
  const monWrap  = document.getElementById('st-divmonths-wrap');
  const autoWrap = document.getElementById('st-divauto-wrap');
  if (divWrap)  divWrap.style.display  = isNone ? 'none' : '';
  if (freqWrap) freqWrap.style.display = isNone ? 'none' : '';
  if (autoWrap) autoWrap.style.display = isCash ? '' : 'none';
  if (isNone) {
    if (monWrap) monWrap.style.display = 'none';
    const divInput = document.getElementById('st-div');
    if (divInput) divInput.value = '';
  } else {
    updateStockDivMonths();
  }
}

function renderStocks() {
  const tbody = document.getElementById('stock-tbody');

  document.getElementById('stock-refresh-bar').innerHTML = '';

  if (!state.stocks.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="color:var(--muted);text-align:center;padding:20px">Nincs részvény</td></tr>';
    document.getElementById('st-sum-invested').textContent = fmt(0);
    document.getElementById('st-sum-current').textContent = fmt(0);
    const plEl0 = document.getElementById('st-sum-pl');
    plEl0.textContent = fmt(0);
    plEl0.className = 'stat-value';
    document.getElementById('st-sum-pl-card').className = 'card card-stat-dark';
    document.getElementById('st-sum-div').textContent = fmt(0);
    return;
  }

  // Csoportosítás tickerenként (több vétel egy sorba, átlagos vételár)
  const groups = {};
  state.stocks.forEach(s => { (groups[s.ticker] = groups[s.ticker] || []).push(s); });

  let totalInvested=0, totalCurrent=0, totalDiv=0;
  const groupArr = Object.entries(groups).map(([ticker, lots]) => {
    const first = lots[0];
    const cur = first.currency || 'HUF';
    const rate = rateForCurrency(cur);
    const currentPriceHuf = getLivePrice(ticker) || first.price;

    let qty=0, invHuf=0, invN=0;
    lots.forEach(l => {
      qty += l.qty;
      invHuf += l.qty * l.avg;
      const avgN = (l.avgNative != null) ? l.avgNative : (rate ? l.avg/rate : l.avg);
      invN += l.qty * avgN;
    });
    const currentHuf = qty * currentPriceHuf;
    const divYield = stockDivYield(first, currentPriceHuf);
    totalInvested += invHuf;
    totalCurrent += currentHuf;
    totalDiv += stockIsCash(first) ? currentHuf * divYield / 100 : 0;

    const avgN = qty ? invN/qty : 0;
    const curPriceN = rate ? currentPriceHuf/rate : currentPriceHuf;
    const currentN = qty * curPriceN;
    const plN = currentN - invN;
    const plPct = invN ? plN/invN*100 : 0;
    const annualDivN = stockIsCash(first) ? currentN * divYield / 100 : 0;
    return { ticker, first, lots, cur, qty, avgN, curPriceN, investedN: invN, currentN, plN, plPct, annualDivN, divYield, currentHuf };
  }).sort((a,b) => b.currentHuf - a.currentHuf);

  tbody.innerHTML = groupArr.map(g => {
    const s = g.first;
    return `
      <tr style="cursor:pointer" onclick="openStockDetail('${g.ticker}')">
        <td>
          <strong>${g.ticker}</strong>
          ${s.name ? `<div style="font-size:10px;color:var(--muted)">${escHtml(s.name)}</div>` : ''}
          <div style="font-size:10px;color:var(--muted);margin-top:2px">${g.lots.length} vétel ›</div>
        </td>
        <td><span class="badge ${stockTypeShort(s)==='Dist'?'badge-green':'badge-gray'}" title="${stockDivFreqLabel(s)}">${stockTypeShort(s)}</span></td>
        <td>${fmtNum(g.qty)}</td>
        <td>${fmtCur(g.avgN, g.cur)}</td>
        <td>${fmtCur(g.curPriceN, g.cur)}</td>
        <td>${fmtCur(g.investedN, g.cur)}</td>
        <td><strong>${fmtCur(g.currentN, g.cur)}</strong></td>
        <td class="${g.plN>=0?'green':'red'}" style="font-weight:500">${g.plN>=0?'+':''}${fmtCur(g.plN, g.cur)} <span style="font-size:10px">(${g.plPct.toFixed(1)}%)</span></td>
        <td class="yellow">${fmtCur(g.annualDivN, g.cur)}</td>
        <td>${g.divYield.toFixed(2)}%${s.divAuto ? ' <span style="font-size:9px;color:var(--accent2)" title="Automatikusan a Yahoo-ról">auto</span>' : ''}</td>
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

  renderDividendCalendar();

  // Ha nyitva van egy részvény részletnézete, frissítjük
  if (_openStockTicker) {
    const dv = document.getElementById('stock-detail-view');
    if (dv && dv.style.display !== 'none') {
      if (groups[_openStockTicker]) {
        const c = document.getElementById('stock-detail-content');
        if (c) c.innerHTML = buildStockDetailHTML(_openStockTicker);
      } else {
        closeStockDetail();
      }
    }
  }
}

let _openStockTicker = null;

/* Fizetési hónap-térkép kézi (nem auto) osztalékfizető részvényhez:
   {hónap: osztalék/részvény natív devizában} */
function manualDivMonthMap(s) {
  if (!stockIsCash(s) || s.divAuto) return null;
  const priceHuf = getLivePrice(s.ticker) || s.price;
  const rate = rateForCurrency(s.currency || 'HUF');
  const priceN = rate ? priceHuf/rate : priceHuf;
  const yieldPct = stockDivYield(s, priceHuf);
  const annualPerShareN = priceN * yieldPct / 100;
  if (annualPerShareN <= 0) return null;
  const freq = s.divFreq || 'yearly';
  let months;
  if (freq === 'monthly') months = [1,2,3,4,5,6,7,8,9,10,11,12];
  else if (freq === 'quarterly') months = (DIV_MONTHS_SET[s.divMonths || '3'] || DIV_MONTHS_SET['3']);
  else months = [12];
  const perPayment = annualPerShareN / months.length;
  const map = {};
  months.forEach(m => map[m] = perPayment);
  return map;
}

function renderDividendCalendar() {
  const targets = ['div-calendar', 'div-calendar-dash'].map(id => document.getElementById(id)).filter(Boolean);
  if (!targets.length) return;
  const setHtml = (html) => targets.forEach(el => { el.innerHTML = html; });
  const monthNames = ['Január','Február','Március','Április','Május','Június','Július','Augusztus','Szeptember','Október','November','December'];

  // tickerenkénti aggregálás
  const groups = {};
  state.stocks.forEach(s => { (groups[s.ticker] = groups[s.ticker] || []).push(s); });

  const byMonth = {}; for (let m=1; m<=12; m++) byMonth[m] = [];
  let anyData = false;
  Object.entries(groups).forEach(([ticker, lots]) => {
    const first = lots[0];
    if (!stockIsCash(first)) return;
    const qty = lots.reduce((a,l)=>a+l.qty, 0);
    const rate = rateForCurrency(first.currency || 'HUF');
    const monthMap = (first.divAuto && first.divByMonthNative) ? first.divByMonthNative : manualDivMonthMap(first);
    if (!monthMap) return;
    const monthCount = Object.keys(monthMap).length; // 12=havi, 4=negyedéves, 1=éves
    Object.entries(monthMap).forEach(([m, perShareN]) => {
      const amountHuf = perShareN * qty * rate;
      if (amountHuf > 0) { byMonth[+m].push({ ticker, amountHuf, monthCount }); anyData = true; }
    });
  });

  if (!anyData) {
    setHtml('<div style="color:var(--muted);font-size:12px;padding:8px 0">Még nincs ismert osztalék-ütemezés. Frissíts (élő árfolyam), hogy a rendszer lehúzza az osztalékfizető részvények fizetési hónapjait.</div>');
    return;
  }

  const grandTotal = Object.values(byMonth).reduce((a, arr) => a + arr.reduce((x,i)=>x+i.amountHuf, 0), 0);
  setHtml(
    `<div style="font-size:11px;color:var(--muted);margin-bottom:12px">Éves osztalék összesen: <strong class="yellow">${fmt(grandTotal)}</strong> (a jelenlegi pozíciók és a legutóbbi kifizetések alapján)</div>` +
    `<div class="div-cal-grid">` +
    monthNames.map((name, i) => {
      const m = i+1;
      const items = byMonth[m].sort((a,b)=> (b.monthCount - a.monthCount) || (b.amountHuf - a.amountHuf));
      const total = items.reduce((a,x)=>a+x.amountHuf, 0);
      const active = items.length > 0;
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:11px;${active?'':'opacity:0.45'}">
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 6px;margin-bottom:${active?'8px':'0'}">
          <span style="font-weight:700;font-size:12px">${name}</span>
          <span class="yellow" style="font-weight:700;font-size:12px;white-space:nowrap;margin-left:auto">${active?fmt(total):'—'}</span>
        </div>
        ${items.map(x=>`<div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px;gap:6px"><span style="font-weight:600">${x.ticker}</span><span style="color:var(--muted);white-space:nowrap">${fmt(x.amountHuf)}</span></div>`).join('')}
      </div>`;
    }).join('') +
    `</div>`
  );
}

function openStockDetail(ticker) {
  if (!state.stocks.some(s => s.ticker === ticker)) return;
  _openStockTicker = ticker;
  const lv = document.getElementById('stock-list-view');
  const dv = document.getElementById('stock-detail-view');
  const addBtn = document.getElementById('stock-add-btn');
  if (lv) lv.style.display = 'none';
  if (dv) dv.style.display = 'block';
  if (addBtn) addBtn.style.display = 'none';
  const c = document.getElementById('stock-detail-content');
  if (c) c.innerHTML = buildStockDetailHTML(ticker);
}
function closeStockDetail() {
  _openStockTicker = null;
  const lv = document.getElementById('stock-list-view');
  const dv = document.getElementById('stock-detail-view');
  const addBtn = document.getElementById('stock-add-btn');
  if (lv) lv.style.display = 'block';
  if (dv) dv.style.display = 'none';
  if (addBtn) addBtn.style.display = '';
}

function sellCurrentStock() {
  if (!_openStockTicker) return;
  // A legrégebbi nyitott tételt kínáljuk fel eladásra (FIFO); több tétel esetén
  // a következő eladáskor a soron következő legrégebbi jön
  const lots = state.stocks
    .filter(s => s.ticker === _openStockTicker)
    .sort((a, b) => (a.buyDate || '').localeCompare(b.buyDate || ''));
  if (lots.length) openStockSell(lots[0].id);
}

function buildStockDetailHTML(ticker) {
  const lots = state.stocks.filter(s => s.ticker === ticker);
  if (!lots.length) return '';
  const first = lots[0];
  const cur = first.currency || 'HUF';
  const rate = rateForCurrency(cur);
  const currentPriceHuf = getLivePrice(ticker) || first.price;
  const curPriceN = rate ? currentPriceHuf/rate : currentPriceHuf;

  let totQty=0, totInvHuf=0, totInvN=0, totCurHuf=0;
  const rowsHtml = [...lots].sort((a,b)=>(a.buyDate||'').localeCompare(b.buyDate||'')).map(l => {
    const invHuf = l.qty * l.avg;
    const avgN = (l.avgNative != null) ? l.avgNative : (rate ? l.avg/rate : l.avg);
    const invN = l.qty * avgN;
    const curN = l.qty * curPriceN;
    const curHuf = l.qty * currentPriceHuf;
    const plN = curN - invN;
    const plPct = invN ? plN/invN*100 : 0;
    totQty += l.qty; totInvHuf += invHuf; totInvN += invN; totCurHuf += curHuf;
    return `<tr>
      <td style="color:var(--muted)">${l.buyDate||'—'}</td>
      <td>${fmtNum(l.qty)}</td>
      <td>${fmtCur(avgN, cur)}</td>
      <td>${fmtCur(invN, cur)}</td>
      <td class="cyan">${fmtCur(curN, cur)}</td>
      <td class="${plN>=0?'green':'red'}">${plN>=0?'+':''}${fmtCur(plN, cur)} <span style="font-size:10px">(${plPct.toFixed(1)}%)</span></td>
      <td><button class="btn btn-sm btn-secondary" onclick="deleteStock('${l.id}')">Téves rögzítés</button></td>
    </tr>`;
  }).join('');

  const avgN = totQty ? totInvN/totQty : 0;
  const totPLHuf = totCurHuf - totInvHuf;
  const totPLN = rate ? totPLHuf/rate : totPLHuf;
  const totCurN = rate ? totCurHuf/rate : totCurHuf;
  const totPLPct = totInvHuf ? totPLHuf/totInvHuf*100 : 0;
  const divYield = stockDivYield(first, currentPriceHuf);
  const annualDivHuf = stockIsCash(first) ? totCurHuf * divYield / 100 : 0;
  const typeShort = stockTypeShort(first);
  const liveBadge = getLivePrice(ticker) ? '<span class="badge badge-green">● élő</span>' : '';
  const box = (label, val, cls) => `<div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">${label}</div><div class="${cls||''}" style="font-family:var(--display);font-size:16px;font-weight:700">${val}</div></div>`;

  return `
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
        <div style="font-family:var(--display);font-size:20px;font-weight:700">${ticker}</div>
        <span class="badge ${typeShort==='Dist'?'badge-green':'badge-gray'}" title="${stockDivFreqLabel(first)}">${typeShort}</span>
        ${liveBadge}
      </div>
      <div style="color:var(--muted);font-size:12px;margin-bottom:18px">${first.name?escHtml(first.name)+' &nbsp;|&nbsp; ':''}${lots.length} vétel &nbsp;|&nbsp; ${cur}</div>

      <div class="grid g4" style="margin-bottom:20px">
        ${box('Összes mennyiség', fmtNum(totQty))}
        ${box('Befektetett', fmtCur(totInvN, cur))}
        ${box('P&L', `${totPLN>=0?'+':''}${fmtCur(totPLN, cur)} (${totPLPct.toFixed(1)}%)`, totPLN>=0?'green':'red')}
        ${box('Éves osztalék', fmt(annualDivHuf), 'yellow')}
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:20px;font-size:12px;margin-bottom:20px;padding-top:16px;border-top:1px solid var(--border)">
        <div><span style="color:var(--muted)">Átlag vételár: </span><strong>${fmtCur(avgN, cur)}</strong></div>
        <div><span style="color:var(--muted)">Jelenlegi ár: </span><strong>${fmtCur(curPriceN, cur)}</strong></div>
        <div><span style="color:var(--muted)">Jelenlegi érték: </span><strong class="cyan">${fmtCur(totCurN, cur)}</strong></div>
        <div><span style="color:var(--muted)">Osztalékhozam: </span><strong>${divYield.toFixed(2)}%${first.divAuto?' (auto)':''}</strong></div>
      </div>

      <div class="card-title" style="margin-bottom:12px">Vételek</div>
      <div class="scroll-table">
        <table>
          <thead><tr><th>Vétel dátuma</th><th>Db</th><th>Vételár</th><th>Befektetett</th><th>Jelenlegi érték</th><th>P&amp;L</th><th></th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function resolveCryptoName(coin) {
  const sym = (coin || '').trim().toUpperCase();
  if (!sym) return '';
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(sym)}`);
    const data = await r.json();
    const coins = (data && data.coins) || [];
    const knownId = COINGECKO_ID_MAP[sym];
    // 1) ha ismerjük a CoinGecko id-t, azt keressük; 2) pontos szimbólum-egyezés
    // (a találatok piaci kap. szerint rendezettek); 3) végül az első találat
    let best = knownId ? coins.find(c => c.id === knownId) : null;
    if (!best) best = coins.find(c => (c.symbol || '').toUpperCase() === sym);
    if (!best) best = coins[0];
    return best ? (best.name || '') : '';
  } catch (e) { return ''; }
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
  // Teljes név automatikus lekérése a coin szimbólumából (a részvények mintájára)
  const name = await resolveCryptoName(coin);
  const fxRate = await fxRateForDate(currency, date);
  const price = priceNative * fxRate;
  const fee = feeNative * fxRate;
  state.crypto.push({ id:uid(), coin, name, type, qty, price, date, fee, currency });
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

  document.getElementById('cr-open').textContent = fmt(totalOpen);
  const totalPL = totalRealized + (totalLiveOpen - totalOpen);
  const plEl = document.getElementById('cr-pl');
  plEl.textContent = (totalPL>=0?'+':'') + fmt(totalPL);
  plEl.className = 'stat-value ' + (totalPL>=0?'green':'red');
  document.getElementById('cr-pl-card').className = 'card ' + (totalPL>=0?'card-stat-green':'card-stat-red');

  const liveOpenEl = document.getElementById('cr-live-open');
  if (liveOpenEl) {
    liveOpenEl.innerHTML = `<div class="stat-value cyan">${fmt(totalLiveOpen)}</div>`;
  }

  // Coin → teljes név / deviza / legutóbbi vétel dátuma / vételek száma
  const nameMap = {}, coinCur = {}, coinLastDate = {}, coinBuyCount = {};
  state.crypto.forEach(t => {
    if (t.name) nameMap[t.coin] = t.name;
    if (!coinCur[t.coin]) coinCur[t.coin] = t.currency || 'HUF';
    if (t.type === 'buy') {
      coinBuyCount[t.coin] = (coinBuyCount[t.coin] || 0) + 1;
      if (!coinLastDate[t.coin] || (t.date||'') > coinLastDate[t.coin]) coinLastDate[t.coin] = t.date || '';
    }
  });

  // PORTFÓLIÓ — coinonként aggregált pozíció, saját devizanemben (a részvények mintájára)
  const holdingsBody = document.getElementById('crypto-holdings-tbody');
  if (holdingsBody) {
    // Nyitott pozíciók coinonként, jelenlegi érték szerint csökkenő sorrendben (a részvények mintájára)
    const rows = Object.entries(coins).map(([coin, c]) => {
      const openQty = c.buys.reduce((a,b)=>a+b.qty,0);
      if (openQty <= 0) return null;
      const openCostHuf = c.buys.reduce((a,b)=>a+b.qty*b.price,0);
      const liveHuf = getLivePrice(coin);
      const curPriceHuf = liveHuf || (openCostHuf / openQty);
      const curValHuf = openQty * curPriceHuf;

      const cur = coinCur[coin] || 'HUF';
      const rate = rateForCurrency(cur);
      const openCostN = rate ? openCostHuf/rate : openCostHuf;
      const avgN = openCostN / openQty;
      const curPriceN = rate ? curPriceHuf/rate : curPriceHuf;
      const curValN = rate ? curValHuf/rate : curValHuf;
      const plN = curValN - openCostN;
      const plPct = openCostN ? plN/openCostN*100 : 0;

      return { coin, openQty, avgN, curPriceN, openCostN, curValN, plN, plPct, cur, curValHuf };
    }).filter(Boolean).sort((a,b) => b.curValHuf - a.curValHuf);

    holdingsBody.innerHTML = rows.map(r => `<tr style="cursor:pointer" onclick="openCryptoDetail('${r.coin}')">
        <td>
          <strong>${r.coin}</strong>${nameMap[r.coin]?`<div style="font-size:10px;color:var(--muted)">${escHtml(nameMap[r.coin])}</div>`:''}
          <div style="font-size:10px;color:var(--muted);margin-top:2px">${coinBuyCount[r.coin]||0} vétel ›</div>
        </td>
        <td>${fmtNum(r.openQty)}</td>
        <td>${fmtCur(r.avgN, r.cur)}</td>
        <td>${fmtCur(r.curPriceN, r.cur)}</td>
        <td>${fmtCur(r.openCostN, r.cur)}</td>
        <td><strong>${fmtCur(r.curValN, r.cur)}</strong></td>
        <td class="${r.plN>=0?'green':'red'}" style="font-weight:500">${r.plN>=0?'+':''}${fmtCur(r.plN, r.cur)} <span style="font-size:10px">(${r.plPct.toFixed(1)}%)</span></td>
      </tr>`).join('') || '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:20px">Nincs kriptó pozíció</td></tr>';
  }

  // Hozam — a nyitott pozíció megtérülése
  const unrealPct = totalOpen > 0 ? (totalLiveOpen - totalOpen) / totalOpen * 100 : 0;
  const yEl = document.getElementById('cr-yield');
  if (yEl) {
    if (totalOpen > 0) {
      yEl.textContent = (unrealPct>=0?'+':'') + unrealPct.toFixed(1) + '%';
      yEl.className = 'stat-value ' + (unrealPct>=0?'green':'red');
      const yc = document.getElementById('cr-yield-card');
      if (yc) yc.className = 'card ' + (unrealPct>=0?'card-stat-green':'card-stat-red');
    } else {
      yEl.textContent = '—';
      yEl.className = 'stat-value';
    }
  }

  // Per-coin HUF adatok (megoszlás + statisztika)
  const coinStats = [];
  Object.entries(coins).forEach(([coin, c]) => {
    const openQty = c.buys.reduce((a,b)=>a+b.qty,0);
    if (openQty <= 0) return;
    const openCost = c.buys.reduce((a,b)=>a+b.qty*b.price,0);
    const live = getLivePrice(coin);
    const curVal = live ? openQty*live : openCost;
    const pl = curVal - openCost;
    const plPct = openCost ? pl/openCost*100 : 0;
    coinStats.push({ coin, curVal, openCost, pl, plPct });
  });

  // Kripto megoszlás (sávok, HUF alapon)
  const allocEl = document.getElementById('crypto-allocation');
  if (allocEl) {
    const totalVal = coinStats.reduce((a,s)=>a+s.curVal, 0);
    if (!coinStats.length || totalVal <= 0) {
      allocEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:10px 0">Nincs nyitott pozíció</div>';
    } else {
      const palette = ['#C08A2E','#3FA36C','#4FA7BD','#8B6690','#C24A3A','#B8873A','#6E8B3D','#B0703A'];
      // Oszlopok száma a rögzített kriptók száma szerint:
      // 5-nél több → 2 oszlop (szélesebb, olvashatóbb sávok); 1-nél több → 3 oszlop; egyébként 1
      const n = coinStats.length;
      const cols = n > 5 ? 2 : (n > 1 ? 3 : 1);
      const colCls = cols === 2 ? 'g2' : (cols === 3 ? 'g3' : '');
      const gridStyle = 'gap:11px 18px' + (cols === 1 ? ';grid-template-columns:1fr' : '');
      allocEl.innerHTML = `<div class="grid ${colCls}" style="${gridStyle}">` +
        [...coinStats].sort((a,b)=>b.curVal-a.curVal).map((s,i)=>{
        const color = palette[i % palette.length];
        const share = s.curVal/totalVal*100;
        return `<div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:4px">
            <span><strong style="color:${color}">${s.coin}</strong> <span style="color:var(--muted)">${share.toFixed(1)}%</span></span>
            <span class="cyan" style="font-weight:600">${fmt(s.curVal)}</span>
          </div>
          <div class="progress-bar" style="height:6px"><div class="progress-fill" style="width:${share}%;background:${color}"></div></div>
        </div>`;
      }).join('') + `</div>`;
    }
  }

  // Statisztika
  const statsEl = document.getElementById('crypto-stats');
  if (statsEl) {
    if (!coinStats.length) {
      statsEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:10px 0">Nincs nyitott pozíció</div>';
    } else {
      let best = coinStats[0], worst = coinStats[0];
      coinStats.forEach(s => { if (s.plPct > best.plPct) best = s; if (s.plPct < worst.plPct) worst = s; });
      const avgPct = coinStats.reduce((a,s)=>a+s.plPct, 0) / coinStats.length;
      const perfCell = s => `${s.coin} <span class="${s.plPct>=0?'green':'red'}">${s.plPct>=0?'+':''}${s.plPct.toFixed(1)}%</span>`;
      statsEl.innerHTML = `
        <div class="tax-row"><span style="color:var(--muted)">Coinok száma</span><span>${coinStats.length} db</span></div>
        <div class="tax-row"><span style="color:var(--muted)">Legjobb teljesítő</span><span>${perfCell(best)}</span></div>
        <div class="tax-row"><span style="color:var(--muted)">Leggyengébb teljesítő</span><span>${perfCell(worst)}</span></div>
        <div class="tax-row"><span style="color:var(--muted)">Átlagos hozam</span><span class="${avgPct>=0?'green':'red'}">${avgPct>=0?'+':''}${avgPct.toFixed(1)}%</span></div>
      `;
    }
  }

  // Ha nyitva van egy kripto részletnézete, frissítjük (a részvények mintájára)
  if (_openCryptoCoin) {
    const dv = document.getElementById('crypto-detail-view');
    if (dv && dv.style.display !== 'none') {
      const stillOpen = state.crypto.some(t => t.coin === _openCryptoCoin && t.type === 'buy');
      if (stillOpen) {
        const c = document.getElementById('crypto-detail-content');
        if (c) c.innerHTML = buildCryptoDetailHTML(_openCryptoCoin);
      } else {
        closeCryptoDetail();
      }
    }
  }
}

let _openCryptoCoin = null;

function openCryptoDetail(coin) {
  if (!state.crypto.some(t => t.coin === coin)) return;
  _openCryptoCoin = coin;
  const lv = document.getElementById('crypto-list-view');
  const dv = document.getElementById('crypto-detail-view');
  const addBtn = document.getElementById('crypto-add-btn');
  if (lv) lv.style.display = 'none';
  if (dv) dv.style.display = 'block';
  if (addBtn) addBtn.style.display = 'none';
  const c = document.getElementById('crypto-detail-content');
  if (c) c.innerHTML = buildCryptoDetailHTML(coin);
}

function closeCryptoDetail() {
  _openCryptoCoin = null;
  const lv = document.getElementById('crypto-list-view');
  const dv = document.getElementById('crypto-detail-view');
  const addBtn = document.getElementById('crypto-add-btn');
  if (lv) lv.style.display = 'block';
  if (dv) dv.style.display = 'none';
  if (addBtn) addBtn.style.display = '';
}

function sellCurrentCrypto() {
  if (_openCryptoCoin) openSellModal(_openCryptoCoin);
}

function buildCryptoDetailHTML(coin) {
  const trades = state.crypto.filter(t => t.coin === coin);
  if (!trades.length) return '';

  // Nyitott pozíció FIFO szerint (a részvény-részletnézet mintájára)
  const c = calcCryptoPL()[coin] || { buys: [], realized: 0, fees: 0 };
  const openQty = c.buys.reduce((a,b)=>a+b.qty,0);
  const openCostHuf = c.buys.reduce((a,b)=>a+b.qty*b.price,0);
  const liveHuf = getLivePrice(coin);
  const curPriceHuf = liveHuf || (openQty ? openCostHuf/openQty : 0);
  const curValHuf = openQty * curPriceHuf;

  const cur = (trades.find(t=>t.currency)||{}).currency || 'HUF';
  const rate = rateForCurrency(cur);
  const toN = v => rate ? v/rate : v;

  const openCostN = toN(openCostHuf);
  const avgN = openQty ? openCostN/openQty : 0;
  const curPriceN = toN(curPriceHuf);
  const curValN = toN(curValHuf);
  const openPLN = curValN - openCostN;
  const openPLPct = openCostN ? openPLN/openCostN*100 : 0;

  const name = (trades.find(t=>t.name)||{}).name || '';
  const liveBadge = liveHuf ? '<span class="badge badge-green">● élő</span>' : '';
  const box = (label, val, cls) => `<div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">${label}</div><div class="${cls||''}" style="font-family:var(--display);font-size:16px;font-weight:700">${val}</div></div>`;

  // Nyitott vételi tételek FIFO-remainder szerint, dátummal (a részvény "Vételek" táblázat mintájára)
  const lots = [];
  [...trades].sort((a,b)=>(a.date||'').localeCompare(b.date||'')).forEach(t => {
    if (t.type === 'buy') {
      lots.push({ id: t.id, qty: t.qty, price: t.price, date: t.date });
    } else {
      let rem = t.qty;
      while (rem > 1e-12 && lots.length) {
        const lot = lots[0];
        const used = Math.min(rem, lot.qty);
        lot.qty -= used;
        rem -= used;
        if (lot.qty <= 1e-12) lots.shift();
      }
    }
  });

  const lotsHtml = lots.map(l => {
    const priceN = toN(l.price);
    const invN = toN(l.qty * l.price);
    const valN = toN(l.qty * curPriceHuf);
    const plN = valN - invN;
    const plPct = invN ? plN/invN*100 : 0;
    return `<tr>
      <td style="color:var(--muted)">${l.date||'—'}</td>
      <td>${fmtNum(l.qty)}</td>
      <td>${fmtCur(priceN, cur)}</td>
      <td>${fmtCur(invN, cur)}</td>
      <td class="cyan">${fmtCur(valN, cur)}</td>
      <td class="${plN>=0?'green':'red'}">${plN>=0?'+':''}${fmtCur(plN, cur)} <span style="font-size:10px">(${plPct.toFixed(1)}%)</span></td>
      <td><button class="btn btn-sm btn-secondary" onclick="deleteCryptoTrade('${l.id}')">Téves rögzítés</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:16px">Nincs nyitott vétel</td></tr>';

  return `
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
        <div style="font-family:var(--display);font-size:20px;font-weight:700">${coin}</div>
        ${liveBadge}
      </div>
      <div style="color:var(--muted);font-size:12px;margin-bottom:18px">${name?escHtml(name)+' &nbsp;|&nbsp; ':''}${lots.length} vétel &nbsp;|&nbsp; ${cur}</div>

      <div class="grid g4" style="margin-bottom:20px">
        ${box('Összes mennyiség', fmtNum(openQty))}
        ${box('Befektetett', fmtCur(openCostN, cur))}
        ${box('Jelenlegi érték', fmtCur(curValN, cur), 'cyan')}
        ${box('P&L', `${openPLN>=0?'+':''}${fmtCur(openPLN, cur)} (${openPLPct.toFixed(1)}%)`, openPLN>=0?'green':'red')}
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:20px;font-size:12px;margin-bottom:20px;padding-top:16px;border-top:1px solid var(--border)">
        <div><span style="color:var(--muted)">Átlag vételár: </span><strong>${fmtCur(avgN, cur)}</strong></div>
        <div><span style="color:var(--muted)">Jelenlegi ár: </span><strong>${fmtCur(curPriceN, cur)}</strong></div>
      </div>

      <div class="card-title" style="margin-bottom:12px">Vételek</div>
      <div class="scroll-table">
        <table>
          <thead><tr><th>Vétel dátuma</th><th>Db</th><th>Vételár</th><th>Befektetett</th><th>Jelenlegi érték</th><th>P&amp;L</th><th></th></tr></thead>
          <tbody>${lotsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
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
  const laBtn = document.getElementById('loan-add-btn');
  if (laBtn) laBtn.style.display = 'none';
  document.getElementById('loan-detail-content').innerHTML = buildLoanDetailHTML(l);
}

function closeLoanDetail() {
  document.getElementById('loan-list-view').style.display = 'block';
  document.getElementById('loan-detail-view').style.display = 'none';
  const laBtn = document.getElementById('loan-add-btn');
  if (laBtn) laBtn.style.display = '';
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
  let totalRemain = 0, totalMonthly = 0, sumOrig = 0, sumRepayAll = 0;

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
      sumOrig      += l.orig;
      sumRepayAll  += l.monthly * l.months;

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
  // Hitelek díja: felvett − teljes visszafizetendő; alatta: felvett − jelenlegi tartozás
  const lnFeeTotal = sumOrig - sumRepayAll;
  const lnFeeSoFar = sumOrig - totalRemain;
  const lnFeeEl = document.getElementById('ln-sum-fee');
  lnFeeEl.textContent = fmt(lnFeeTotal);
  lnFeeEl.className = 'stat-value ' + (lnFeeTotal < 0 ? 'red' : 'green');
  const lnFeeSubEl = document.getElementById('ln-sum-fee-sofar');
  if (lnFeeSubEl) lnFeeSubEl.textContent = `Eddig: ${fmt(lnFeeSoFar)}`;
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
  // A zálogba adás napja az 1. nap (inkluzív számolás), ezért days - 1.
  const end = pledgeAddDays(start, days - 1);
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
    updatePledgeGoldSummary();
    return;
  }
  const used = pledgedGoldIds();
  const available = state.goldItems.filter(g => !used.has(g.id));
  if (!available.length) {
    box.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:6px 8px">Minden aranytétel zálogban van</div>';
    updatePledgeGoldSummary();
    return;
  }
  box.innerHTML = available.map(g => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:12px;cursor:pointer">
      <input type="checkbox" value="${g.id}" onchange="updatePledgeGoldSummary()" style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0">
      <span>${g.name} — ${fmtNum(g.grams)} g${g.code ? ' ('+g.code+')' : ''}</span>
    </label>
  `).join('');
  updatePledgeGoldSummary();
}

// A lenyitható aranytétel-választó összegző feliratának frissítése
function updatePledgeGoldSummary() {
  const summary = document.getElementById('pl-gold-summary');
  if (!summary) return;
  const n = document.querySelectorAll('#pl-gold input:checked').length;
  summary.querySelector('.pl-gold-summary-text').textContent =
    n ? `${n} aranytétel kiválasztva` : 'Válassz aranytételt…';
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
  const thm       = parseFloat(document.getElementById('pl-thm').value)||0;
  if (!principal || !days) return;
  const goldNames = goldIds.map(id => {
    const g = state.goldItems.find(x => x.id === id);
    return g ? g.name : '—';
  });
  // A zálogba adás napja az 1. nap (inkluzív számolás), ezért days - 1.
  const endD = pledgeAddDays(start, days - 1);
  const end = endD ? toLocalDateStr(endD) : '';
  state.pledges.push({ id:uid(), goldIds, goldNames, ticketNo, principal, feePct, start, days, rate, thm, end });
  save();
  ['pl-principal','pl-fee','pl-rate','pl-thm','pl-end','pl-ticket'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('pl-end-info').textContent = '';
  document.getElementById('pl-net-info').textContent = '';
  const goldDd = document.querySelector('.pl-gold-dd'); if (goldDd) goldDd.removeAttribute('open');
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
    // A zálogház 360 napos évvel számol (napi kamat = éves kamat / 360).
    termYears = days / 360;
    let ed = 0;
    if (p.start) ed = Math.floor((Date.now() - new Date(p.start).getTime()) / 86400000);
    ed = Math.max(0, Math.min(ed, days));
    elapsedYears = ed / 360;
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

let _openPledgeId = null;
function openPledgeDetail(id) {
  const p = state.pledges.find(x => x.id === id);
  if (!p) return;
  _openPledgeId = id;
  const lv = document.getElementById('pledge-list-view');
  const dv = document.getElementById('pledge-detail-view');
  const addBtn = document.getElementById('pledge-add-btn');
  if (lv) lv.style.display = 'none';
  if (dv) dv.style.display = 'block';
  if (addBtn) addBtn.style.display = 'none';
  const c = document.getElementById('pledge-detail-content');
  if (c) c.innerHTML = buildPledgeDetailHTML(p);
}

function closePledgeDetail() {
  _openPledgeId = null;
  const lv = document.getElementById('pledge-list-view');
  const dv = document.getElementById('pledge-detail-view');
  const addBtn = document.getElementById('pledge-add-btn');
  if (lv) lv.style.display = 'block';
  if (dv) dv.style.display = 'none';
  if (addBtn) addBtn.style.display = '';
}

function buildPledgeDetailHTML(p) {
  const d = calcPledgeDebt(p);
  const spot = state.goldSpot || 28000;
  const ids = Array.isArray(p.goldIds) ? p.goldIds : (p.goldId ? [p.goldId] : []);
  let totGrams = 0, totCost = 0, totVal = 0, liveCount = 0;
  const rowsHtml = ids.map((id, i) => {
    const g = state.goldItems.find(x => x.id === id);
    if (!g) {
      const fb = (p.goldNames && p.goldNames[i]) || p.goldName || '—';
      return `<tr><td colspan="9" style="color:var(--muted)">${escHtml(fb)} (törölt tétel)</td></tr>`;
    }
    liveCount++;
    const val = goldItemValue(g, spot);
    const pl = val - g.cost;
    const plPct = g.cost ? pl/g.cost*100 : 0;
    totGrams += g.grams; totCost += g.cost; totVal += val;
    return `<tr>
      <td><strong>${escHtml(g.name)}</strong></td>
      <td style="color:var(--muted)">${g.code||'—'}</td>
      <td><span class="badge badge-yellow">${g.form}</span></td>
      <td>${g.purity}</td>
      <td>${fmtNum(g.grams)} g</td>
      <td style="color:var(--muted)">${g.date||'—'}</td>
      <td>${fmt(g.cost)}</td>
      <td class="cyan">${fmt(val)}</td>
      <td class="${pl>=0?'green':'red'}">${pl>=0?'+':''}${fmt(pl)} <span style="font-size:10px">(${pl>=0?'+':''}${plPct.toFixed(1)}%)</span></td>
    </tr>`;
  }).join('');
  const totPL = totVal - totCost;

  const redeemed = !!p.redeemed;
  let statusBadge;
  if (redeemed) statusBadge = `<span class="badge badge-purple">kiváltva</span>`;
  else if (p.end && p.end < now()) statusBadge = `<span class="badge badge-red">lejárt</span>`;
  else statusBadge = `<span class="badge badge-green">aktív</span>`;

  return `
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
        <div style="font-family:var(--display);font-size:20px;font-weight:700">Zálogjegy: ${p.ticketNo ? escHtml(p.ticketNo) : '—'}</div>
        ${statusBadge}
      </div>
      <div style="color:var(--muted);font-size:12px;margin-bottom:18px">Zálogba adva: ${p.start||'—'} &nbsp;|&nbsp; Lejárat: ${p.end||'—'}</div>

      <div class="grid g4" style="margin-bottom:20px">
        <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">Kölcsön összeg</div><div style="font-family:var(--display);font-size:16px;font-weight:700">${fmt(d.principal)}</div></div>
        <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">Kézhez kapott</div><div class="cyan" style="font-family:var(--display);font-size:16px;font-weight:700">${fmt(d.cashReceived)}</div></div>
        <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">${redeemed?'Kiváltási összeg':'Jelenlegi tartozás'}</div><div class="${redeemed?'purple':'red'}" style="font-family:var(--display);font-size:16px;font-weight:700">${fmt(redeemed ? (p.redeemedAmount||0) : d.currentDebt)}</div></div>
        <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:4px">Kiváltás lejáratkor</div><div style="font-family:var(--display);font-size:16px;font-weight:700">${fmt(d.totalRepay)}</div></div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:20px;font-size:12px;margin-bottom:20px;padding-top:16px;border-top:1px solid var(--border)">
        <div><span style="color:var(--muted)">Kezelési költség: </span><strong class="red">${d.feePct}% (${fmt(d.fee)})</strong></div>
        <div><span style="color:var(--muted)">Kamat: </span><strong>${p.rate}% / év</strong></div>
        <div><span style="color:var(--muted)">THM: </span><strong>${p.thm ? p.thm + '%' : '—'}</strong></div>
        <div><span style="color:var(--muted)">Futamidő: </span><strong>${d.termLabel}</strong></div>
        <div><span style="color:var(--muted)">Eddigi kamat: </span><strong class="yellow">${fmt(d.accrued)}</strong></div>
        <div><span style="color:var(--muted)">Teljes kamat (lejáratig): </span><strong class="yellow">${fmt(d.totalInterest)}</strong></div>
        <div><span style="color:var(--muted)">Eltelt: </span><strong>${d.elapsedLabel}</strong></div>
      </div>

      <div class="card-title" style="margin-bottom:12px">Zálogban lévő aranytételek</div>
      <div class="scroll-table">
        <table>
          <thead><tr><th>Megnevezés</th><th>Kód</th><th>Forma</th><th>Tisztaság</th><th>Tömeg</th><th>Vétel dátuma</th><th>Vételár</th><th>Jelenlegi érték</th><th>P&amp;L</th></tr></thead>
          <tbody>
            ${rowsHtml}
            <tr style="border-top:2px solid var(--border2)">
              <td colspan="4"><strong>Összesen (${liveCount} tétel)</strong></td>
              <td><strong>${fmtNum(totGrams)} g</strong></td>
              <td></td>
              <td><strong>${fmt(totCost)}</strong></td>
              <td class="cyan"><strong>${fmt(totVal)}</strong></td>
              <td class="${totPL>=0?'green':'red'}"><strong>${totPL>=0?'+':''}${fmt(totPL)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
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
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="badge badge-purple" style="font-size:13px;padding:4px 11px;cursor:pointer" onclick="openPledgeDetail('${p.id}')" title="Kattints a zálogban lévő aranyak részletezéséhez" onmouseover="this.style.filter='brightness(1.12)'" onmouseout="this.style.filter=''">${p.ticketNo ? escHtml(p.ticketNo) : '—'} ›</span>
              ${badge}
            </div>
            <div style="color:var(--muted);font-size:11px;margin-top:4px">
              Zálogba adva: ${p.start||'—'} &nbsp;|&nbsp; Lejárat: ${p.end||'—'} &nbsp;|&nbsp; ${d.termLabel}
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
          <div><span style="color:var(--muted)">THM: </span><strong>${p.thm ? p.thm + '%' : '—'}</strong></div>
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
  // Zálog díja: kapott − visszafizetendő; alatta: kapott − jelenlegi tartozás
  const feeTotal = sumCash - sumRepay;
  const feeSoFar = sumCash - sumDebt;
  const feeEl = document.getElementById('pl-sum-fee');
  feeEl.textContent = fmt(feeTotal);
  feeEl.className = 'stat-value ' + (feeTotal < 0 ? 'red' : 'green');
  const feeSubEl = document.getElementById('pl-sum-fee-sofar');
  if (feeSubEl) feeSubEl.textContent = `Eddig: ${fmt(feeSoFar)}`;

  // Ha épp egy zálog részletnézete nyitva van, frissítsük az adatait
  if (_openPledgeId) {
    const dv = document.getElementById('pledge-detail-view');
    if (dv && dv.style.display !== 'none') {
      const p = state.pledges.find(x => x.id === _openPledgeId);
      if (p) { const c = document.getElementById('pledge-detail-content'); if (c) c.innerHTML = buildPledgeDetailHTML(p); }
      else closePledgeDetail();
    }
  }
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

function pledgeForGold(goldId) {
  return (state.pledges||[]).find(pl => !pl.redeemed && (
    (Array.isArray(pl.goldIds) && pl.goldIds.includes(goldId)) || pl.goldId === goldId)) || null;
}

function pledgeTicketForGold(goldId) {
  const p = pledgeForGold(goldId);
  return p ? (p.ticketNo || '') : '';
}

function renderGold() {
  const spot = state.goldSpot || 28000;

  let totalGrams = 0, totalCost = 0, totalValue = 0;
  const tbody = document.getElementById('gold-tbody');
  const pbody = document.getElementById('gold-pledged-tbody');
  if (!tbody) return;

  const sortedGold = [...state.goldItems].sort((a,b) =>
    (a.grams - b.grams) || (a.date||'').localeCompare(b.date||''));

  const pledgedSet = pledgedGoldIds();

  const commonCells = (g, value, pl) => `
      <td><strong>${g.name}</strong></td>
      <td style="color:var(--muted)">${g.code||'—'}</td>
      <td><span class="badge badge-yellow">${g.form}</span></td>
      <td>${g.purity}</td>
      <td>${fmtNum(g.grams)} g</td>
      <td style="color:var(--muted)">${g.date||'—'}</td>
      <td>${fmt(g.cost)}</td>
      <td class="cyan">${fmt(value)}</td>
      <td class="${pl>=0?'green':'red'}">${pl>=0?'+':''}${fmt(pl)}</td>`;

  const freeRows = [], pledgedRows = [];
  sortedGold.forEach(g => {
    const value = goldItemValue(g, spot);
    const pl = value - g.cost;
    totalGrams += g.grams;
    totalCost  += g.cost;
    totalValue += value;
    if (pledgedSet.has(g.id)) {
      const ticket = pledgeTicketForGold(g.id);
      pledgedRows.push(`<tr>${commonCells(g, value, pl)}<td><span class="badge badge-purple">${ticket ? escHtml(ticket) : '—'}</span></td></tr>`);
    } else {
      freeRows.push(`<tr>${commonCells(g, value, pl)}<td><button class="btn btn-sm" onclick="openGoldSell('${g.id}')">Eladás</button></td></tr>`);
    }
  });

  tbody.innerHTML = freeRows.join('') || '<tr><td colspan="10" style="color:var(--muted);text-align:center;padding:20px">Nincs eladható aranytétel</td></tr>';
  if (pbody) pbody.innerHTML = pledgedRows.join('') || '<tr><td colspan="10" style="color:var(--muted);text-align:center;padding:20px">Nincs zálogosított aranytétel</td></tr>';

  const totalPL = totalValue - totalCost;
  document.getElementById('gd-total-grams').textContent = fmtNum(totalGrams) + ' g';
  document.getElementById('gd-total-cost').textContent = fmt(totalCost);
  document.getElementById('gd-total-value').textContent = fmt(totalValue);
  const plEl = document.getElementById('gd-total-pl');
  plEl.textContent = (totalPL>=0?'+':'') + fmt(totalPL);
  plEl.className = 'stat-value ' + (totalPL>=0?'green':'red');
  document.getElementById('gd-total-pl-card').className = 'card ' + (totalPL>=0?'card-stat-green':'card-stat-red');
}

/* ---- Aranytétel eladása (a kriptó Eladás mintájára) ---- */
let goldSellId = null;
function openGoldSell(id) {
  const g = state.goldItems.find(x => x.id === id);
  if (!g) return;
  goldSellId = id;
  const spot = state.goldSpot || 28000;
  const value = goldItemValue(g, spot);
  document.getElementById('gs-info').innerHTML =
    `<strong style="color:var(--text);font-size:14px">${escHtml(g.name)}</strong> · ${fmtNum(g.grams)} g · vételár: ${fmt(g.cost)} · becsült érték: <strong style="color:var(--accent2)">${fmt(value)}</strong>`;
  document.getElementById('gs-price').value = Math.round(value).toLocaleString('hu-HU');
  document.getElementById('gs-date').value = now();
  updateGoldSalePL();
  openModal('gold-sale-modal');
}
function updateGoldSalePL() {
  const g = state.goldItems.find(x => x.id === goldSellId);
  if (!g) return;
  const price = parseAmount('gs-price');
  const pl = price - g.cost;
  const el = document.getElementById('gs-pl');
  if (el) el.innerHTML = `Eredmény (P&L): <strong class="${pl>=0?'green':'red'}">${pl>=0?'+':''}${fmt(pl)}</strong>`;
}
function confirmGoldSell() {
  const g = state.goldItems.find(x => x.id === goldSellId);
  if (!g) return;
  const price = parseAmount('gs-price');
  const date = document.getElementById('gs-date').value || now();
  if (!price) return;
  if (!state.goldSales) state.goldSales = [];
  state.goldSales.push({ id: uid(), goldId: g.id, name: g.name, grams: g.grams, cost: g.cost, salePrice: price, pl: price - g.cost, date });
  state.goldItems = state.goldItems.filter(x => x.id !== g.id);
  save();
  closeModal('gold-sale-modal');
  goldSellId = null;
  renderAll();
}
function deleteGoldFromSale() {
  if (!goldSellId) return;
  if (!confirm('Biztosan törlöd ezt az aranytételt (eladás rögzítése nélkül)?')) return;
  state.goldItems = state.goldItems.filter(x => x.id !== goldSellId);
  save();
  closeModal('gold-sale-modal');
  goldSellId = null;
  renderAll();
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
  if (!name || !amount) return;
  state.services.push({ id:uid(), name, cat, amount, cycle, day, active:true });
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
  const charges = [];

  tbody.innerHTML = state.services.map(s => {
    const monthly = serviceMonthlyCost(s);
    if (s.active) {
      totalMonthly += monthly;
      activeCount++;
      const nd = nextChargeDate(s.day);
      if (nd) charges.push({ date: nd, name: s.name, amount: s.amount });
    }
    const statusBadge = s.active
      ? `<span class="badge badge-green" style="cursor:pointer" title="Kattints a szüneteltetéshez" onclick="toggleService('${s.id}')">● Aktív</span>`
      : `<span class="badge" style="background:rgba(107,114,128,0.15);color:var(--muted);cursor:pointer" title="Kattints az aktiváláshoz" onclick="toggleService('${s.id}')">⏸ Szünetel</span>`;
    return `<tr style="${s.active?'':'opacity:0.5'}">
      <td><strong>${s.name}</strong><br><span style="font-size:10px;color:var(--muted)">${Array.isArray(s.cat) ? (s.cat.join(', ') || '—') : (s.cat || '—')}</span></td>
      <td>${fmt(s.amount)}</td>
      <td>${CYCLE_LABEL[s.cycle]||s.cycle}</td>
      <td>${s.day ? s.day + '.' : '—'}</td>
      <td class="red">${fmt(monthly)}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" onclick="openPriceModal('${s.id}')" title="Ár módosítása">✎ Ár</button>
          <button class="btn btn-danger btn-sm" onclick="deleteService('${s.id}')">×</button>
        </div>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:20px">Nincs rögzített szolgáltatás</td></tr>';

  document.getElementById('sv-monthly').textContent = fmt(totalMonthly);
  document.getElementById('sv-yearly').textContent = fmt(totalMonthly * 12);
  document.getElementById('sv-count').textContent = activeCount + ' db';
  const nextEl = document.getElementById('sv-next');
  if (nextEl) {
    if (!charges.length) {
      nextEl.innerHTML = '—';
    } else {
      const minTime = Math.min(...charges.map(c => c.date.getTime()));
      const due = charges.filter(c => c.date.getTime() === minTime);
      const dateStr = new Date(minTime).toLocaleDateString('hu-HU');
      const dayTotal = due.reduce((a,c) => a + c.amount, 0);
      nextEl.innerHTML = `${dateStr}`
        + `<div style="font-size:11px;color:var(--muted);font-weight:400;margin-top:3px;line-height:1.4">${due.map(c => escHtml(c.name)).join(', ')}</div>`
        + (due.length > 1 ? `<div style="font-size:11px;color:var(--muted);font-weight:600;margin-top:2px">Aznap összesen: ${fmt(dayTotal)}</div>` : '');
    }
  }
}

let priceEditId = null;

function openPriceModal(id) {
  const s = state.services.find(x => x.id === id);
  if (!s) return;
  priceEditId = id;
  document.getElementById('pc-service-name').innerHTML =
    `<strong style="color:var(--text)">${escHtml(s.name)}</strong> jelenlegi díja: ${fmt(s.amount)}`;
  document.getElementById('pc-amount').value = Math.round(s.amount).toLocaleString('hu-HU');
  openModal('price-modal');
}

function savePrice() {
  const s = state.services.find(x => x.id === priceEditId);
  if (!s) return;
  const amount = parseAmount('pc-amount');
  if (!amount) { closeModal('price-modal'); return; }
  s.amount = amount;
  save();
  closeModal('price-modal');
  priceEditId = null;
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
        if (days <= 14) {
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
      if (days <= 14) {
        items.push({
          kind: 'service',
          kindLabel: 'szolgáltatás',
          badgeClass: 'badge-yellow',
          label: s.name,
          date: dateStr,
          days,
          amount: s.amount,
        });
      }
    }
  });

  if (!items.length) {
    return '<div style="color:var(--muted);text-align:center;padding:20px;font-size:12px">Nincs közelgő kiadás a következő napokban</div>';
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
  const annualDiv = annualStockDividendHuf();
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
  } else {
    drEl.textContent = '—';
    drEl.className = 'stat-value yellow';
  }
  // A százalék alatt a hónapra vetített osztalék (HUF)
  drSub.textContent = `${fmt(monthlyDiv)}/hó osztalék`;
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
  ], { label: 'Nettó vagyon', value: fmtCompact(netWorth) + ' Ft' });

  /* ===== Bővített kimutatások ===== */
  const spot = state.goldSpot || 28000;
  const goldCost = goldTotalCost();
  const totalLiab = totalLoan + totalPledge;
  const unrealPL = currentValue - investedCost;

  const setTxt = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  const setCls = (id,c) => { const el=document.getElementById(id); if(el) el.className=c; };

  setTxt('d-invested-line', `Befektetve: ${fmt(investedCost)}`);

  setTxt('d-total-liab', fmt(totalLiab));
  setTxt('d-total-liab-sub', `Hitel ${fmt(totalLoan)} · Zálog ${fmt(totalPledge)}`);

  // Portfólió Ráta: a teljes tartozás (Hitel+Zálog) a befektetett eszközök jelenlegi értékének %-a
  const portfolioRate = currentValue > 0 ? (totalLiab / currentValue * 100) : 0;
  const prEl = document.getElementById('d-portfolio-rate');
  if (prEl) {
    if (currentValue > 0) {
      prEl.textContent = portfolioRate.toFixed(1) + '%';
      prEl.className = 'stat-value ' + (portfolioRate <= 50 ? 'green' : (portfolioRate <= 100 ? 'yellow' : 'red'));
      setCls('d-portfolio-rate-card', 'card ' + (portfolioRate <= 50 ? 'card-stat-green' : (portfolioRate <= 100 ? 'card-stat-yellow' : 'card-stat-red')));
    } else {
      prEl.textContent = '—';
      prEl.className = 'stat-value';
      setCls('d-portfolio-rate-card', 'card card-stat-dark');
    }
  }
  setTxt('d-portfolio-rate-sub', `${fmt(totalLiab)} tartozás / ${fmt(currentValue)} eszköz`);

  setTxt('d-unreal-pl', (unrealPL>=0?'+':'') + fmt(unrealPL));
  setCls('d-unreal-pl', 'stat-value ' + (unrealPL>=0?'green':'red'));
  setCls('d-unreal-card', 'card ' + (unrealPL>=0?'card-stat-green':'card-stat-red'));
  setTxt('d-unreal-pl-sub', investedCost>0 ? `${unrealPL>=0?'+':''}${(unrealPL/investedCost*100).toFixed(1)}% a bekerülésen` : '');

  // Eszközbontás táblázat (Arany, Részvény, Kripto)
  const bt = document.getElementById('d-breakdown-tbody');
  if (bt) {
    const classes = [
      { label:'Arany',    inv:goldCost,       val:goldVal },
      { label:'Részvény', inv:stockCost,      val:stockVal },
      { label:'Kripto',   inv:cryptoOpenCost, val:cryptoOpen },
    ];
    const denom = currentValue || 1;
    bt.innerHTML = classes.map(c=>{
      const pl = c.val - c.inv;
      const share = c.val/denom*100;
      return `<tr>
        <td><strong>${c.label}</strong></td>
        <td>${fmt(c.inv)}</td>
        <td class="cyan">${fmt(c.val)}</td>
        <td class="${pl>=0?'green':'red'}">${pl>=0?'+':''}${fmt(pl)}</td>
        <td>${share.toFixed(1)}%</td>
      </tr>`;
    }).join('') + `<tr style="border-top:2px solid var(--border2)">
      <td><strong>Összesen</strong></td>
      <td><strong>${fmt(investedCost)}</strong></td>
      <td class="cyan"><strong>${fmt(currentValue)}</strong></td>
      <td class="${unrealPL>=0?'green':'red'}"><strong>${unrealPL>=0?'+':''}${fmt(unrealPL)}</strong></td>
      <td>100%</td>
    </tr>`;
  }

  // Havi pénzáramlás (hitel + szolgáltatás narancssárga, összesítő sor nélkül)
  const cf = document.getElementById('d-cashflow');
  if (cf) {
    const netMonthly = monthlyDiv - totalMonthly;
    cf.innerHTML = `
      <div class="tax-row"><span style="color:var(--muted)">Bevétel — osztalék / hó</span><span class="green">${fmt(monthlyDiv)}</span></div>
      <div class="tax-row"><span style="color:var(--muted)">Hiteltörlesztő / hó</span><span style="color:var(--accent3);font-weight:600">${fmt(monthlyLoan)}</span></div>
      <div class="tax-row"><span style="color:var(--muted)">Szolgáltatások / hó</span><span style="color:var(--accent3);font-weight:600">${fmt(svcMonthly)}</span></div>
      <div class="tax-row" style="border-top:2px solid var(--border2)"><span><strong>Nettó havi egyenleg</strong></span><span class="${netMonthly>=0?'green':'red'}"><strong>${netMonthly>=0?'+':''}${fmt(netMonthly)}</strong></span></div>
      <div style="font-size:11px;color:var(--muted);margin-top:10px">Osztalékfedezet a fix kiadásokra: <strong>${totalMonthly>0?divRate.toFixed(1)+'%':'—'}</strong></div>
    `;
  }

  // Portfólió statisztika (Arany, Részvény, Kripto, Zálog, Hitel, Szolgáltatás)
  const ps = document.getElementById('d-portfolio-stats');
  if (ps) {
    const goldGrams = state.goldItems.reduce((a,g)=>a+g.grams, 0);
    const coinCount = Object.values(coins).filter(c=>c.buys.reduce((x,b)=>x+b.qty,0)>0).length;
    const activePledges = (state.pledges||[]).filter(p=>!p.redeemed).length;
    ps.innerHTML = `
      <div class="tax-row"><span style="color:var(--muted)">Aranytételek</span><span>${state.goldItems.length} db · ${fmtNum(goldGrams)} g</span></div>
      <div class="tax-row"><span style="color:var(--muted)">Részvénytételek</span><span>${state.stocks.length} db</span></div>
      <div class="tax-row"><span style="color:var(--muted)">Kripto pozíciók</span><span>${coinCount} db</span></div>
      <div class="tax-row"><span style="color:var(--muted)">Zálogok</span><span>${activePledges} db</span></div>
      <div class="tax-row"><span style="color:var(--muted)">Aktív hitelek</span><span>${state.loans.length} db</span></div>
      <div class="tax-row"><span style="color:var(--muted)">Aktív szolgáltatások</span><span>${svcCount} db</span></div>
    `;
  }

  // Legnagyobb pozíciók
  const th = document.getElementById('d-top-holdings');
  if (th) {
    const holdings = [];
    const stAgg = {};
    state.stocks.forEach(s=>{ const cp=getLivePrice(s.ticker)||s.price; stAgg[s.ticker]=(stAgg[s.ticker]||0)+s.qty*cp; });
    Object.entries(stAgg).forEach(([t,v])=> holdings.push({ name:t, cls:'Részvény', badge:'badge-green', value:v }));
    Object.entries(coins).forEach(([coin,c])=>{
      const oq=c.buys.reduce((x,b)=>x+b.qty,0);
      if (oq>0) { const lp=getLivePrice(coin); const v=lp?oq*lp:c.buys.reduce((x,b)=>x+b.qty*b.price,0); holdings.push({ name:coin, cls:'Kripto', badge:'badge-cyan', value:v }); }
    });
    const gAgg = {};
    state.goldItems.forEach(g=>{ gAgg[g.name]=(gAgg[g.name]||0)+goldItemValue(g, spot); });
    Object.entries(gAgg).forEach(([n,v])=> holdings.push({ name:n, cls:'Arany', badge:'badge-yellow', value:v }));
    holdings.sort((a,b)=>b.value-a.value);
    const top = holdings.slice(0, 6);
    if (!top.length) {
      th.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px 0">Még nincs pozíció</div>';
    } else {
      const maxV = top[0].value || 1;
      th.innerHTML = top.map(h=>`
        <div style="margin-bottom:11px">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:4px">
            <span style="min-width:0"><span class="badge ${h.badge}" style="font-size:9px">${h.cls}</span> <strong>${escHtml(h.name)}</strong></span>
            <span class="cyan" style="font-weight:600;white-space:nowrap">${fmt(h.value)}</span>
          </div>
          <div class="progress-bar" style="height:5px"><div class="progress-fill" style="width:${h.value/maxV*100}%;background:var(--accent2)"></div></div>
        </div>
      `).join('');
    }
  }

  renderDividendCalendar();
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
        return dashTile(`${a.ticker}`, badge, [
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
        const badge = live ? `<span class="badge badge-green">● élő</span>` : '';
        const rows = [
          ['Mennyiség', fmtNum(openQty) + ' db', ''],
          ['Nyitott pozíció (bekerülési)', fmt(openCost), ''],
        ];
        if (liveVal!==null) {
          rows.push(['Aktuális eladási érték', fmt(liveVal), 'cyan']);
          const unrealPct = openCost ? unreal/openCost*100 : 0;
          rows.push(['Nem realizált P&L', `${unreal>=0?'+':''}${fmt(unreal)} (${unreal>=0?'+':''}${unrealPct.toFixed(1)}%)`, unreal>=0?'green':'red']);
        }
        return dashTile(coin, badge, rows, '');
      }).join('');
    } else cryptoBox.innerHTML = emptyTile('Nincs kripto');
  }

  const goldBox = document.getElementById('dash-gold');
  const goldPledgedBox = document.getElementById('dash-gold-pledged');
  if (goldBox || goldPledgedBox) {
    const spot = state.goldSpot || 28000;
    const pledgedSet = pledgedGoldIds();
    const goldLiveBadge = goldSpotLive ? '<span class="badge badge-green">● élő</span>' : '';

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

    const goldTile = (a, pledgeBadge, pledge) => {
      const pl = a.val - a.cost;
      const plPct = a.cost ? pl/a.cost*100 : 0;
      const plStr = `${pl>=0?'+':''}${fmt(pl)} (${pl>=0?'+':''}${plPct.toFixed(1)}%)`;
      const darab = `${a.count} db${a.grams != null ? ` (${fmtNum(a.grams)} g/db)` : ''}`;
      let rows;
      if (pledge) {
        const fee = pledge.debt - pledge.loan;                 // a kölcsön díja (pozitív)
        const feePct = pledge.loan ? fee/pledge.loan*100 : 0;
        rows = [
          ['Darab', darab, ''],
          ['Össztömeg', `${fmtNum(a.totalGrams)} g`, ''],
          ['Vételár', fmt(a.cost), ''],
          ['Kézhez kapott', fmt(pledge.loan), ''],
          ['Jelenlegi érték', fmt(a.val), 'cyan'],
          ['Jelenlegi tartozás', fmt(pledge.debt), 'yellow'],
          ['P&L', plStr, pl>=0?'green':'red'],
          ['Kölcsön díja', `${fmt(fee)} (${feePct.toFixed(1)}%)`, 'red'],
        ];
      } else {
        rows = [
          ['Darab', darab, ''],
          ['Össztömeg', `${fmtNum(a.totalGrams)} g`, ''],
          ['Vételár', fmt(a.cost), ''],
          ['Jelenlegi érték', fmt(a.val), 'cyan'],
          ['P&L', plStr, pl>=0?'green':'red'],
        ];
      }
      return dashTile(`${a.name}`, pledgeBadge||'', rows);
    };

    if (goldBox) {
      const freeItems = state.goldItems.filter(g => !pledgedSet.has(g.id));
      if (freeItems.length) {
        goldBox.innerHTML = Object.values(buildAgg(freeItems)).map(a => goldTile(a, goldLiveBadge)).join('');
      } else {
        goldBox.innerHTML = emptyTile('Nincs szabad (nem zálogba adott) aranytétel');
      }
    }

    if (goldPledgedBox) {
      const pledgedItems = state.goldItems.filter(g => pledgedSet.has(g.id));
      if (pledgedItems.length) {
        // ZÁLOGJEGYENKÉNT csoportosítunk (nem arany-tömeg szerint):
        // egy zálog = egy csempe, benne a záloghoz tartozó összes arany összegezve.
        const byPledge = {};
        pledgedItems.forEach(g => {
          const p = pledgeForGold(g.id);
          const key = p ? p.id : ('none_' + g.id);
          if (!byPledge[key]) byPledge[key] = { pledge:p, names:new Set(), gramsSet:new Set(), count:0, totalGrams:0, cost:0, val:0 };
          const grp = byPledge[key];
          grp.names.add(g.name);
          grp.gramsSet.add(g.grams);
          grp.count++;
          grp.totalGrams += g.grams;
          grp.cost += g.cost;
          grp.val += goldItemValue(g, spot);
        });
        goldPledgedBox.innerHTML = Object.values(byPledge).map(grp => {
          const ticket = (grp.pledge && grp.pledge.ticketNo) ? grp.pledge.ticketNo : '—';
          const a = {
            name: '',
            count: grp.count,
            grams: (grp.gramsSet.size === 1) ? [...grp.gramsSet][0] : null,
            totalGrams: grp.totalGrams,
            cost: grp.cost,
            val: grp.val,
          };
          let pledgeInfo = null;
          if (grp.pledge) { const d = calcPledgeDebt(grp.pledge); pledgeInfo = { loan: d.cashReceived, debt: d.currentDebt }; }
          return goldTile(a, `<span class="badge badge-purple">${escHtml(ticket)}</span>` + (goldLiveBadge ? ' ' + goldLiveBadge : ''), pledgeInfo);
        }).join('');
      } else {
        goldPledgedBox.innerHTML = emptyTile('Nincs zálogban lévő aranytétel');
      }
    }
  }
}

function dashTile(title, badgeHtml, rows, footer) {
  return `<div class="card" style="padding:14px;display:flex;flex-direction:column;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-family:var(--display);font-weight:700;font-size:15px;line-height:1.2">${title}</span>
      ${badgeHtml||''}
    </div>
    <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;align-content:start">
    ${rows.map(r=>`
      <div style="min-width:0">
        <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:0.3px;line-height:1.25">${r[0]}</div>
        <div class="${r[2]||''}" style="font-weight:700;font-size:13px;line-height:1.25;font-variant-numeric:tabular-nums">${r[1]}</div>
      </div>
    `).join('')}
    </div>
    ${footer ? `<div style="font-size:10px;color:var(--muted);margin-top:10px;padding-top:8px;border-top:1px solid var(--surface3)">${footer}</div>` : ''}
  </div>`;
}

function emptyTile(msg) {
  return `<div class="card" style="color:var(--muted);text-align:center;padding:24px;grid-column:1/-1">${msg}</div>`;
}

let _donutSegments = [], _donutTotal = 0, _donutCenter = null;

function _cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/* Rövid, kompakt pénzformátum a donut közepére (1,35 M Ft) */
function fmtCompact(n) {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a >= 1e9) return sign + (a/1e9).toFixed(2).replace('.', ',') + ' Mrd';
  if (a >= 1e6) return sign + (a/1e6).toFixed(2).replace('.', ',') + ' M';
  if (a >= 1e3) return sign + Math.round(a/1e3) + ' e';
  return sign + Math.round(a);
}

function drawDonut(segments, center) {
  _donutSegments = segments || [];
  _donutTotal = _donutSegments.reduce((a,s)=>a+s.value, 0);
  _donutCenter = center || null;
  renderDonutCanvas(-1);
  renderDonutLegend();
}

function renderDonutCanvas(hi) {
  const canvas = document.getElementById('donut-canvas');
  if (!canvas) return;
  const size = 190;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size/2, cy = size/2, r = 70, lw = 22;

  // háttér-gyűrű (track)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.lineWidth = lw;
  ctx.strokeStyle = _cssVar('--surface2', 'rgba(0,0,0,0.06)');
  ctx.stroke();

  const total = _donutTotal;
  if (total > 0) {
    const gap = 0.045; // rés a szeletek közt (radián)
    let angle = -Math.PI/2;
    _donutSegments.forEach((s, i) => {
      const slice = (s.value/total) * Math.PI*2;
      if (slice <= 0) return;
      const start = angle + gap/2;
      const end = angle + slice - gap/2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, Math.max(start + 0.001, end));
      ctx.lineWidth = (hi === i) ? lw + 5 : lw;
      ctx.lineCap = 'round';
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = (hi === -1 || hi === i) ? 1 : 0.25;
      ctx.stroke();
      ctx.globalAlpha = 1;
      angle += slice;
    });
  }

  // közép-felirat
  let big = '', small = '';
  if (hi >= 0 && _donutSegments[hi]) {
    big = total ? (_donutSegments[hi].value/total*100).toFixed(1) + '%' : '0%';
    small = _donutSegments[hi].label;
  } else if (_donutCenter) {
    big = _donutCenter.value;
    small = _donutCenter.label;
  } else if (!total) {
    small = 'Nincs adat';
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (big) {
    ctx.fillStyle = (hi >= 0 && _donutSegments[hi]) ? _donutSegments[hi].color : _cssVar('--text', '#17171A');
    ctx.font = '700 17px "Hanken Grotesk", system-ui, sans-serif';
    ctx.fillText(big, cx, cy - (small ? 8 : 0));
  }
  if (small) {
    ctx.fillStyle = _cssVar('--muted', '#666');
    ctx.font = '600 9px "Space Mono", ui-monospace, monospace';
    ctx.fillText(small.toUpperCase(), cx, cy + (big ? 12 : 0));
  }
}

function renderDonutLegend() {
  const legend = document.getElementById('donut-legend');
  if (!legend) return;
  const total = _donutTotal;
  if (!total) {
    legend.innerHTML = '<div style="color:var(--muted);font-size:12px">Nincs adat</div>';
    return;
  }
  legend.innerHTML = _donutSegments.map((s, i) => {
    const pct = s.value/total*100;
    return `
    <div class="legend-item" onmouseenter="donutHover(${i})" onmouseleave="donutHover(-1)"
      style="cursor:default;border-radius:7px;padding:3px 6px;margin:0 -6px;transition:background .12s,opacity .12s">
      <span style="color:${s.color};font-weight:800;font-size:13px;min-width:44px;flex-shrink:0;letter-spacing:-0.3px">${pct.toFixed(1)}%</span>
      <span style="color:var(--muted)">${s.label}</span>
      <span style="margin-left:auto;font-weight:600">${fmt(s.value)}</span>
    </div>`;
  }).join('');
}

function donutHover(i) {
  renderDonutCanvas(i);
  const legend = document.getElementById('donut-legend');
  if (!legend) return;
  Array.from(legend.children).forEach((el, idx) => {
    el.style.opacity = (i === -1 || i === idx) ? '1' : '0.4';
    el.style.background = (i === idx) ? 'var(--surface2)' : 'transparent';
  });
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
  if (hd) {
    const d = new Date();
    const dateLine = d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
    const dayLine  = d.toLocaleDateString('hu-HU', { weekday: 'long' });
    hd.innerHTML = `<span style="display:block">${dateLine}</span><span style="display:block;opacity:0.7">${dayLine}</span>`;
  }

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
