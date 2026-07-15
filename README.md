# VagyonMentor

> Egyszemélyes, felhőalapú **személyi vagyonkezelő** webalkalmazás — a teljes vagyonod egy helyen, élő árfolyamokkal.

Egy bejelentkezett felhasználó teljes portfólióját követi: befektetési arany, részvények, kriptovaluta, zálogtételek, hitelek és előfizetések. Az árfolyamokat élőben húzza le, automatikusan számol nyereséget/veszteséget (P&L), az adatok pedig a fiókodhoz kötve, a felhőben (Firebase) tárolódnak — bármely eszközről elérhetők. Nincs build lépés, keretrendszer nélküli tiszta HTML/CSS/JS.

---

## Főbb funkciók

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

## Élő árfolyamforrások

Az árakat több nyilvános forrásból, CORS-proxyn keresztül kéri le:

| Eszköz | Forrás |
| --- | --- |
| Kripto | CoinGecko |
| Részvény | Yahoo Finance |
| Deviza (USD/HUF stb.) | Frankfurter |
| Arany | arany spot API |

## Technológia

- **Vanilla HTML / CSS / JavaScript** — build lépés és keretrendszer nélkül.
- **Firebase** — Authentication (e-mail/jelszó) és Cloud Firestore a felhős tároláshoz.
- Egyedi **donut diagram** és formázók (nincs külső chart-könyvtár).
- Idő szerinti **automatikus téma** (nappal/éjszaka).
- **localStorage → Firebase migráció**: a régi, helyben tárolt adatokat első bejelentkezéskor felmásolja a felhőbe.

## Fájlszerkezet

```
VagyonMentor/
├── index.html   # teljes felület (fülek, modálok, bejelentkezés)
├── script.js    # logika: állapot, árfolyam-lekérés, P&L, Firebase
└── style.css    # dizájn
```

## Beüzemelés

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

## Megjegyzés az adatokról

Az adatok a bejelentkezett fiókodhoz kötve a felhőben tárolódnak, így több eszközről is eléred őket. A **Fiók → Adatok exportja** funkcióval bármikor készíthetsz saját JSON biztonsági mentést.
