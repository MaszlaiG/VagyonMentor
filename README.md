# VagyonMentor

**Language / Nyelv:** [English](#english) · [Magyar](#magyar)

---

## English

> A single-account, cloud-based **personal wealth manager** — your entire net worth in one place, with live prices. Built as a dependency-free, no-build web app that runs on phone, tablet and desktop alike.

VagyonMentor tracks the full portfolio of one signed-in user: investment gold, stocks, cryptocurrency, pledged (pawned) items, loans and subscriptions. It fetches prices live, calculates profit/loss (P&L) automatically, and stores everything in the cloud (Firebase) tied to your account — so it is reachable from any device. There is no build step and no framework: plain HTML, CSS and JavaScript.

### Key features

The app is organised into tabs, one per asset type:

- **Overview (dashboard)** — net worth, invested-asset value, dividend rate, portfolio rate, unrealised P&L, total liabilities, asset allocation (custom-drawn donut chart), monthly spend, monthly cash flow, dividend-tax breakdown, and **upcoming important dates** (loan, pledge and subscription due dates) in one place.
- **Watchlist** — a watch list for tracked assets.
- **Gold** — investment-gold weight, cost basis, current value and per-item P&L; sell flow with automatic P&L; **live gold price** in HUF.
- **Pledge** — amount received, current debt and the sum repayable at maturity, with automatic maturity and interest calculation; can reference specific gold items.
- **Stocks** — invested and current value, open + realised P&L, annual dividend and a **trade log**; live stock prices with native-currency → HUF conversion.
- **Crypto** — trade-based bookkeeping with fees and realised/open P&L; **live crypto prices** (CoinGecko).
- **Loans** — outstanding balance, monthly/annual instalment, number of loans, with maturity calculation.
- **Subscriptions** — monthly/annual total cost, next charge date and **price-change history** per service.
- **Account** — profile, password change, tax-rate settings, module (tab) visibility, **data export/import** (JSON backup) and a danger zone.

### Responsive & adaptive UI

The interface is optimised for phone, tablet and desktop, with the working rule that **nothing overflows the screen horizontally — wide content becomes scrollable instead**:

- **No page-level horizontal overflow** at any width. Wide elements (data tables) scroll inside their own container rather than pushing the viewport sideways.
- **Fluid breakpoints:** content is capped at a comfortable max width; grids reflow from 4 → 2 → 1 columns as space shrinks (tablet ≤ 1024 px, phone ≤ 680 px, with further compaction at ≤ 440 px and ≤ 380 px, plus tablet-specific tuning in the 681–1024 px range).
- **Header:** sticky and stable while scrolling; on phones the full nav collapses into a hamburger menu.
- **Forms & cards** reflow to fewer columns; long, unbreakable strings (e-mails, tickers) wrap instead of stretching their card.
- **Mobile inputs** render at a 16 px font size to suppress iOS auto-zoom on focus.
- **Modals** are top-aligned and scrollable on small screens, and use dynamic viewport units (`100dvh`, with a `100vh` fallback) so the mobile browser's collapsing chrome never clips their content.
- **Touch niceties:** momentum scrolling and overscroll containment on horizontal scrollers; images and canvas are capped to their container width.

### Live price sources

Prices are pulled from public APIs through a chain of key-less CORS proxies (with cache-busting):

| Asset | Source |
| --- | --- |
| Crypto | CoinGecko (`api.coingecko.com`) |
| Stocks | Yahoo Finance (`query1/2.finance.yahoo.com`) |
| FX (USD/HUF, EUR/HUF) | Frankfurter (ECB reference rates) |
| Gold | gold-api.com (XAU spot) |

Stock dividends are tracked automatically from Yahoo's dividend history (rolling 12-month amount and payout months), and FX rates are also resolved *per trade date* for accurate historical conversion.

### Architecture & data model

- **State** is a single in-memory object persisted to **one Firestore document per user**: `vaults/{uid}`.
- **Writes are debounced (~600 ms)** and use `merge` semantics, so rapid edits (e.g. while typing) don't cause excessive writes.
- **Offline persistence** is enabled, so the app stays fast and keeps working on a poor connection.
- On first sign-in, a **one-time localStorage → Firestore migration** copies any legacy locally-stored data to the cloud.
- The **theme switches automatically by time of day** (dark 19:00–06:00, light otherwise), re-checked periodically while the app stays open.

### Tech stack

- **Vanilla HTML / CSS / JavaScript** — no build step, no framework, no runtime dependencies.
- **Firebase** — Authentication (e-mail/password) and Cloud Firestore for cloud storage, with offline persistence.
- Custom **donut chart** (HTML canvas) and number/currency formatters — no external charting library.
- **Responsive, mobile-first CSS** with time-of-day automatic theming.

### Project structure

```
VagyonMentor/
├── index.html   # full UI (tabs, modals, sign-in)
├── script.js    # logic: state, price fetching, P&L, Firebase
└── style.css    # design + responsive layout
```

### Setup

1. Create a **Firebase project**, enable **Authentication → Email/Password** and **Cloud Firestore**.
2. Paste your project config into the Firebase init block at the top of `script.js`:
   ```js
   const firebaseConfig = {
     apiKey: "…",
     authDomain: "…",
     projectId: "…",
     // …
   };
   ```
3. Set Firestore security rules so each user can access **only their own document**:
   ```
   match /vaults/{uid} {
     allow read, write: if request.auth != null && request.auth.uid == uid;
   }
   ```
4. Deploy to any static host (e.g. GitHub Pages) — it works immediately, no build required.

### Browser requirements

A modern evergreen browser (recent Chrome, Edge, Firefox or Safari). The UI uses `backdrop-filter`, CSS custom properties and dynamic viewport units (`dvh`) with graceful fallbacks, and ES2020+ JavaScript.

### A note on your data

Data is stored in the cloud, tied to your signed-in account, so you can reach it from multiple devices. Use **Account → Export data** any time to create your own JSON backup.

---

## Magyar

> Egyfiókos, felhőalapú **személyi vagyonkezelő** webalkalmazás — a teljes vagyonod egy helyen, élő árfolyamokkal. Függőség és build lépés nélküli webalkalmazás, amely telefonon, tableten és asztali gépen egyaránt működik.

Egy bejelentkezett felhasználó teljes portfólióját követi: befektetési arany, részvények, kriptovaluta, zálogtételek, hitelek és előfizetések. Az árfolyamokat élőben húzza le, automatikusan számol nyereséget/veszteséget (P&L), az adatok pedig a fiókodhoz kötve, a felhőben (Firebase) tárolódnak — így bármely eszközről elérhetők. Nincs build lépés és nincs keretrendszer: tiszta HTML, CSS és JavaScript.

### Főbb funkciók

Az alkalmazás füleken keresztül szervezi a vagyonelemeket:

- **Áttekintés (dashboard)** — nettó vagyon, befektetett eszközök értéke, osztalékráta, portfólióráta, nem realizált P&L, összes kötelezettség, vagyonmegoszlás (saját rajzolt donut diagram), havi kiadás, havi pénzáramlás, osztalék-adó bontás és a **közelgő fontos dátumok** (hitel-, zálog- és előfizetés-lejáratok) egy helyen.
- **Figyelő** — figyelőlista a követett eszközökhöz.
- **Arany** — befektetési arany tömeg, bekerülési ár, aktuális érték és P&L tételenként; eladási folyamat automatikus P&L-lel; **élő aranyárfolyam** (HUF).
- **Zálog** — kézhez kapott összeg, jelenlegi tartozás, lejáratkor visszafizetendő összeg, automatikus lejárat- és kamatszámítással; konkrét aranytételekhez köthető.
- **Részvény** — befektetett és aktuális érték, nyitott + realizált P&L, éves osztalék és **kereskedési napló**; élő részvényárfolyam, natív deviza → HUF átváltással.
- **Kripto** — trade-alapú nyilvántartás díjakkal, realizált/nyitott P&L-lel; **élő kriptoárak** (CoinGecko).
- **Hitel** — fennálló tartozás, havi/éves törlesztő, hitelek száma, lejárat-számítással.
- **Szolgáltatások** — előfizetések havi/éves összköltsége, következő terhelés dátuma és **árváltozás-történet** szolgáltatásonként.
- **Fiók** — profiladatok, jelszómódosítás, adókulcs-beállítások, modulok (fülek) láthatósága, **adatok exportja/importja** (JSON biztonsági mentés) és veszélyzóna.

### Reszponzív, adaptív felület

A felület telefonra, tabletre és asztali gépre optimalizált, azzal az alapelvvel, hogy **semmi nem lóg ki vízszintesen a képernyőn — a széles tartalom inkább görgethető lesz**:

- **Nincs oldalszintű vízszintes túllógás** semmilyen szélességen. A széles elemek (adattáblák) a saját konténerükön belül görgethetők, nem tolják oldalra a nézetet.
- **Rugalmas töréspontok:** a tartalom kényelmes maximális szélességen belül marad; a rácsok 4 → 2 → 1 oszlopra rendeződnek át, ahogy fogy a hely (tablet ≤ 1024 px, telefon ≤ 680 px, további tömörítés ≤ 440 px és ≤ 380 px alatt, plusz tablet-specifikus finomítás a 681–1024 px sávban).
- **Fejléc:** görgetéskor is rögzített és stabil; telefonon a teljes navigáció hamburger-menüvé csukódik össze.
- **Űrlapok és kártyák** kevesebb oszlopra rendeződnek; a hosszú, tördelhetetlen szövegek (e-mailek, tickerek) tördelnek, nem feszítik szét a kártyát.
- **Mobil beviteli mezők** 16 px betűmérettel jelennek meg, hogy iOS-en ne nagyítson be automatikusan fókuszáláskor.
- **Modálok** kis képernyőn felülre igazítva és görgethetők, és dinamikus nézetegységet (`100dvh`, `100vh` tartalékkal) használnak, így a mobil böngésző eltűnő fejléc-sávja nem vágja le a tartalmat.
- **Érintés-finomságok:** lendületes görgetés és „bennragadó" görgetés (overscroll containment) a vízszintes görgetőkön; a képek és a canvas a konténerük szélességére vannak korlátozva.

### Élő árfolyamforrások

Az árakat nyilvános API-kból, kulcs nélküli CORS-proxyk láncán át kéri le (cache-megkerüléssel):

| Eszköz | Forrás |
| --- | --- |
| Kripto | CoinGecko (`api.coingecko.com`) |
| Részvény | Yahoo Finance (`query1/2.finance.yahoo.com`) |
| Deviza (USD/HUF, EUR/HUF) | Frankfurter (EKB referencia-árfolyamok) |
| Arany | gold-api.com (XAU spot) |

A részvényosztalékokat automatikusan a Yahoo osztaléktörténetéből követi (gördülő 12 havi összeg és fizetési hónapok), a devizaárfolyamokat pedig *az adott kereskedési naphoz* is feloldja a pontos történeti átváltáshoz.

### Architektúra és adatmodell

- Az **állapot** egyetlen memóriabeli objektum, amely **felhasználónként egyetlen Firestore dokumentumba** kerül: `vaults/{uid}`.
- Az **írások késleltetve (~600 ms), `merge` szemantikával** történnek, így a gyors szerkesztés (pl. gépelés közben) nem okoz felesleges írásokat.
- Be van kapcsolva az **offline gyorsítótár**, így az app gyors marad, és rossz kapcsolat mellett is működik.
- Első bejelentkezéskor egy **egyszeri localStorage → Firestore migráció** felmásolja a régi, helyben tárolt adatokat a felhőbe.
- A **téma napszak szerint automatikusan vált** (19:00–06:00 sötét, egyébként világos), nyitva hagyott appnál időnként újraellenőrizve.

### Technológia

- **Vanilla HTML / CSS / JavaScript** — build lépés, keretrendszer és futásidejű függőség nélkül.
- **Firebase** — Authentication (e-mail/jelszó) és Cloud Firestore a felhős tároláshoz, offline gyorsítótárral.
- Egyedi **donut diagram** (HTML canvas) és szám-/pénznem-formázók — nincs külső chart-könyvtár.
- **Reszponzív, mobil-first CSS** napszak szerinti automatikus témával.

### Fájlszerkezet

```
VagyonMentor/
├── index.html   # teljes felület (fülek, modálok, bejelentkezés)
├── script.js    # logika: állapot, árfolyam-lekérés, P&L, Firebase
└── style.css    # dizájn + reszponzív elrendezés
```

### Beüzemelés

1. Hozz létre egy **Firebase projektet**, kapcsold be az **Authentication → E-mail/jelszó** és a **Cloud Firestore** szolgáltatást.
2. Illeszd be a projekted konfigurációját a `script.js` tetején lévő Firebase-inicializáló blokkba:
   ```js
   const firebaseConfig = {
     apiKey: "…",
     authDomain: "…",
     projectId: "…",
     // …
   };
   ```
3. Állíts be Firestore biztonsági szabályokat, hogy minden felhasználó **csak a saját dokumentumát** érje el:
   ```
   match /vaults/{uid} {
     allow read, write: if request.auth != null && request.auth.uid == uid;
   }
   ```
4. Tetszőleges statikus tárhelyre (pl. GitHub Pages) feltöltve azonnal működik, build nélkül.

### Böngésző-követelmények

Modern, folyamatosan frissülő böngésző (friss Chrome, Edge, Firefox vagy Safari). A felület `backdrop-filter`-t, CSS egyedi tulajdonságokat és dinamikus nézetegységeket (`dvh`) használ elegáns tartalékokkal, valamint ES2020+ JavaScriptet.

### Megjegyzés az adatokról

Az adatok a bejelentkezett fiókodhoz kötve a felhőben tárolódnak, így több eszközről is eléred őket. A **Fiók → Adatok exportja** funkcióval bármikor készíthetsz saját JSON biztonsági mentést.
