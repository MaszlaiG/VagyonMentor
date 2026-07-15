# VagyonMentor

**Language / Nyelv:** [English](#english) · [Magyar](#magyar)

---

## English

> A single-user, cloud-based **personal wealth manager** — your entire net worth in one place, with live prices.

VagyonMentor tracks one signed-in user's whole portfolio: investment gold, stocks, cryptocurrency, pledged (pawned) items, loans and subscriptions. It fetches prices live, calculates profit/loss (P&L) automatically, and stores everything in the cloud (Firebase) tied to your account — accessible from any device. No build step, plain HTML/CSS/JS with no framework.

### Key features

Organised into tabs, one per asset type:

- **Overview (dashboard)** — net worth, invested-asset value, dividend rate, asset allocation (custom-drawn donut chart), monthly spend, and **upcoming important dates** (loan, pledge and subscription due dates) in one place.
- **Watchlist** — a watch list for tracked assets.
- **Gold** — investment-gold weight, cost basis, current value and P&L per item; **live gold price** (HUF).
- **Pledge** — amount received, current debt and the sum repayable at maturity, with automatic maturity and interest calculation.
- **Stocks** — invested and current value, open + realised P&L, annual dividend and a **trade log**; live stock prices with USD/HUF conversion.
- **Crypto** — trade-based bookkeeping with fees and P&L; **live crypto prices** (CoinGecko).
- **Loans** — outstanding balance, monthly/annual instalment, number of loans, with maturity calculation.
- **Subscriptions** — monthly/annual total cost of subscriptions, next charge date and **price-change history** per service.
- **Account** — profile, password change, **data export/import** (JSON backup) and a danger zone.

### Live price sources

Prices are pulled from several public sources via a CORS proxy:

| Asset | Source |
| --- | --- |
| Crypto | CoinGecko |
| Stocks | Yahoo Finance |
| FX (USD/HUF, etc.) | Frankfurter |
| Gold | gold spot API |

### Tech stack

- **Vanilla HTML / CSS / JavaScript** — no build step, no framework.
- **Firebase** — Authentication (e-mail/password) and Cloud Firestore for cloud storage.
- Custom **donut chart** and formatters (no external charting library).
- Time-of-day **automatic theme** (day/night).
- **localStorage → Firebase migration**: on first sign-in, legacy locally-stored data is copied to the cloud.

### Project structure

```
VagyonMentor/
├── index.html   # full UI (tabs, modals, sign-in)
├── script.js    # logic: state, price fetching, P&L, Firebase
└── style.css    # design
```

### Setup

1. Create a **Firebase project**, enable **Authentication → Email/Password** and **Cloud Firestore**.
2. Paste your project config into the Firebase init block in `script.js`:
   ```js
   const firebaseConfig = {
     apiKey: "…",
     authDomain: "…",
     projectId: "…",
     // …
   };
   ```
3. Set Firestore security rules so each user can access **only their own data**.
4. Deploy to any static host (e.g. GitHub Pages) — it works immediately.

### A note on your data

Data is stored in the cloud, tied to your signed-in account, so you can reach it from multiple devices. Use **Account → Export data** any time to create your own JSON backup.

---

## Magyar

> Egyszemélyes, felhőalapú **személyi vagyonkezelő** webalkalmazás — a teljes vagyonod egy helyen, élő árfolyamokkal.

Egy bejelentkezett felhasználó teljes portfólióját követi: befektetési arany, részvények, kriptovaluta, zálogtételek, hitelek és előfizetések. Az árfolyamokat élőben húzza le, automatikusan számol nyereséget/veszteséget (P&L), az adatok pedig a fiókodhoz kötve, a felhőben (Firebase) tárolódnak — bármely eszközről elérhetők. Nincs build lépés, keretrendszer nélküli tiszta HTML/CSS/JS.

### Főbb funkciók

Az alkalmazás füleken keresztül szervezi a vagyonelemeket:

- **Áttekintés (dashboard)** — nettó vagyon, befektetett eszközök értéke, osztalékráta, vagyonmegoszlás (saját rajzolt donut diagram), havi kiadás és a **közelgő fontos dátumok** (hitel-, zálog- és előfizetés-lejáratok) egy helyen.
- **Figyelő** — figyelőlista a követett eszközökhöz.
- **Arany** — befektetési arany tömeg, bekerülési ár, aktuális érték és P&L tételenként; **élő aranyárfolyam** (HUF).
- **Zálog** — kézhez kapott összeg, jelenlegi tartozás, lejáratkor visszafizetendő összeg, automatikus lejárat- és kamatszámítással.
- **Részvény** — befektetett és aktuális érték, nyitott + realizált P&L, éves osztalék és **kereskedési napló**; élő részvényárfolyam és USD/HUF átváltás.
- **Kripto** — trade-alapú nyilvántartás díjakkal és P&L-lel; **élő kriptoárak** (CoinGecko).
- **Hitel** — fennálló tartozás, havi/éves törlesztő, hitelek száma, lejárat számítással.
- **Szolgáltatások** — előfizetések havi/éves összköltsége, következő terhelés dátuma és **árváltozás-történet** szolgáltatásonként.
- **Fiók** — profiladatok, jelszómódosítás, **adatok exportja/importja** (JSON biztonsági mentés) és veszélyzóna.

### Élő árfolyamforrások

Az árakat több nyilvános forrásból, CORS-proxyn keresztül kéri le:

| Eszköz | Forrás |
| --- | --- |
| Kripto | CoinGecko |
| Részvény | Yahoo Finance |
| Deviza (USD/HUF stb.) | Frankfurter |
| Arany | arany spot API |

### Technológia

- **Vanilla HTML / CSS / JavaScript** — build lépés és keretrendszer nélkül.
- **Firebase** — Authentication (e-mail/jelszó) és Cloud Firestore a felhős tároláshoz.
- Egyedi **donut diagram** és formázók (nincs külső chart-könyvtár).
- Idő szerinti **automatikus téma** (nappal/éjszaka).
- **localStorage → Firebase migráció**: a régi, helyben tárolt adatokat első bejelentkezéskor felmásolja a felhőbe.

### Fájlszerkezet

```
VagyonMentor/
├── index.html   # teljes felület (fülek, modálok, bejelentkezés)
├── script.js    # logika: állapot, árfolyam-lekérés, P&L, Firebase
└── style.css    # dizájn
```

### Beüzemelés

1. Hozz létre egy **Firebase projektet**, kapcsold be az **Authentication → E-mail/jelszó** és a **Cloud Firestore** szolgáltatást.
2. Illeszd be a projekted konfigurációját a `script.js` Firebase-inicializáló részébe:
   ```js
   const firebaseConfig = {
     apiKey: "…",
     authDomain: "…",
     projectId: "…",
     // …
   };
   ```
3. Állíts be Firestore biztonsági szabályokat, hogy minden felhasználó **csak a saját adatait** érje el.
4. Tetszőleges statikus tárhelyre (pl. GitHub Pages) feltöltve azonnal működik.

### Megjegyzés az adatokról

Az adatok a bejelentkezett fiókodhoz kötve a felhőben tárolódnak, így több eszközről is eléred őket. A **Fiók → Adatok exportja** funkcióval bármikor készíthetsz saját JSON biztonsági mentést.
