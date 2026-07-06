VagyonMentor

Személyes vagyonkövető webalkalmazás — egy helyen tartja számon a részvényeket, kriptovalutákat, aranyat, hiteleket, zálogokat és rendszeres szolgáltatásokat/előfizetéseket.

🔗 Élő verzió: https://maszlaig.github.io/vagyonmentor/

Funkciók


Áttekintés / Dashboard — nettó vagyon, befektetett eszközök értéke, vagyonmegoszlás grafikonon
Részvény — több devizanemben (HUF, USD, EUR) rögzített pozíciók, automatikus árfolyam-átváltás
Kripto — vétel/eladás nyilvántartás, élő árfolyamadatokkal
Arany — tételes nyilvántartás forma és tisztaság szerint, aktuális spot ár alapján
Zálog — aranyfedezetű kölcsönök futamidő és kamat szerint
Hitel — törlesztőrészletek, göngyölített állapot követése
Szolgáltatások — rendszeres kiadások/előfizetések ciklus szerint
Sötét mód — napszak alapján (19:00–06:00 között) automatikusan bekapcsol
Reszponzív, mobilbarát felület


Adattárolás

Az adatok a Firebase Firestore-ban tárolódnak, e-mail/jelszó alapú bejelentkezéshez kötve — így bármelyik eszközről (telefon, gép) elérhetők ugyanazok az adatok. Minden felhasználó kizárólag a saját adatait éri el (Firestore security rules + Firebase Authentication).


A kódban szereplő Firebase apiKey nem titkos érték — ez minden kliens oldali Firebase-alkalmazásnál nyilvánosan látható, a tényleges hozzáférés-védelmet a Firestore szabályok és a bejelentkezés adja.



Technológia

Vanilla HTML / CSS / JavaScript, build-eszköz és keretrendszer nélkül. Firebase (Authentication + Firestore) a felhő-szinkronhoz.

Fájlok

FájlTartalomindex.htmlAz alkalmazás teljes felülete (fülek, modalok, bejelentkezés)script.jsAlkalmazáslogika, Firebase inicializálás, adatkezelésstyle.cssMegjelenés, reszponzív nézetek, sötét mód

Saját másolat futtatása


Hozz létre egy Firebase projektet (console.firebase.google.com)
Kapcsold be az Authentication → Email/Password bejelentkezést
Hozz létre egy Firestore Database-t, és állítsd be a hozzáférési szabályt:


   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /vaults/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }


Írd be a saját firebaseConfig-odat a script.js elején
Töltsd fel GitHub Pages-re, vagy nyisd meg helyben az index.html-t



Ez egy személyes, saját használatra készült projekt.
