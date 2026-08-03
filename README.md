# IdeaHub

Interná webová aplikácia na správu interných zlepšovacích nápadov, určená pre zamestnancov na podávanie, posudzovanie, schvaľovanie, realizáciu a sledovanie nápadov v rámci organizácie.

## Funkcie

### Základná funkcionalita
- **Podávanie nápadov**: Zamestnanci môžu podať zlepšovací nápad s názvom, popisom, prínosmi, odhadom náročnosti, štítkami a cieľovým oddelením
- **Posúdenie a schválenie**: Pokročilí používatelia a administrátori môžu podané nápady posúdiť, schváliť alebo zamietnuť
- **Realizácia nápadov**: Schválený nápad si môže prevziať a realizovať ktorýkoľvek používateľ
- **Kroky priebehu**: Riešiteľ môže k rozpracovanému nápadu zapisovať poznámky o priebehu
- **Sledovanie dokončenia**: Používateľ môže svoj prevzatý nápad označiť za dokončený
- **Časová os aktivity**: Úplná auditná stopa všetkých akcií vykonaných nad každým nápadom
- **Pohľady podľa stavu**: Samostatné stránky pre moje nápady a pre schválené, rozpracované a dokončené nápady

### Prehľad a analytika
- Štatistiky v reálnom čase (podané, schválené, rozpracované, dokončené, zamietnuté)
- Počty nápadov podľa oddelení
- Grafy mesačných trendov dokončených nápadov v čase
- Priemerné časové metriky (od podania po schválenie, od schválenia po dokončenie)
- Rebríček najaktívnejších prispievateľov (pokročilí používatelia a administrátori)
- Bežní používatelia vidia štatistiky obmedzené na vlastné nápady

### Reporting
- Pokročilé filtrovanie (stav, oddelenie, dátumový rozsah, autor, riešiteľ, štítky)
- Stránkovanie a export do CSV na ďalšiu analýzu
- Komplexné reportovacie rozhranie

### Oddelenia (len administrátor)
- Správa zoznamu cieľových oddelení (vytvorenie, premenovanie, zmena poradia, zmazanie)
- Notifikačné e-mailové adresy a ID Webex priestorov (rooms) pre každé oddelenie

### Notifikácie (e-mail a Webex)
- Dva nezávislé, súbežne fungujúce kanály: e-mail (SMTP) a Webex (správy bota); administrátor môže zapnúť ktorýkoľvek z nich alebo oba
- Administrátorom spravovaná SMTP konfigurácia na stránke **Nastavenia e-mailu** (server, adresa odosielateľa, jazyk notifikácií, voliteľná šablóna predmetu), uložená v databáze so šifrovaným SMTP heslom
- Administrátorom spravovaná konfigurácia Webexu na stránke **Nastavenia Webexu** (prístupový token bota uložený šifrovane, jazyk správ). Notifikácie o životnom cykle pre autora sú vždy súkromné 1:1 správy od bota; notifikácie o novom nápade pre oddelenie sa navyše môžu posielať do Webex priestorov, ktoré administrátor priradí jednotlivým oddeleniam (bot musí byť členom každého takého priestoru)
- Notifikácia o novom nápade sa odosiela na notifikačné adresy cieľového oddelenia (e-mailom a/alebo 1:1 správou vo Webexe) a do Webex priestorov nastavených pre dané oddelenie, a to cez každý zapnutý kanál (best-effort — problémy s doručením nikdy neblokujú požiadavku)
- Notifikácie o životnom cykle jednotlivého nápadu: autor sa môže prihlásiť na odber (prepínač na formulári na vytvorenie nápadu aj na detaile nápadu, zobrazuje sa len ak je zapnutý aspoň jeden kanál) a dostávať upozornenia, keď je jeho nápad schválený, zamietnutý, prevzatý, dokončený alebo keď k nemu pribudne krok priebehu. Zmena, ktorú vykoná sám autor, mu nikdy notifikáciu nepošle; doručovanie je best-effort rovnako ako pri notifikáciách pre oddelenie
- Testovacie tlačidlá (testovací e-mail / testovacia správa vo Webexe) na overenie oboch konfigurácií

### Viacjazyčnosť
- Dvojjazyčné rozhranie — slovenčina (predvolená) a angličtina, prepínateľné v hornej lište a zapamätané v prehliadači
- E-mailové notifikácie používajú jazyk nastavený administrátorom

### Správa používateľov (len administrátor)
- Vytváranie, úprava a mazanie používateľov
- Riadenie prístupu podľa rolí (Používateľ, Pokročilý používateľ, Administrátor)
- Štatistiky používateľa (podané nápady, pridelené nápady)

### Bezpečnosť a autentifikácia
- Autentifikácia založená na reláciách s hashovaním hesiel cez bcrypt (relácie uložené v MongoDB s 7-dňovým TTL)
- Voliteľné podnikové SSO cez OIDC authorization-code flow s PKCE (pozri [Jednotné prihlásenie (SSO)](#jednotné-prihlásenie-sso))
- Samoobslužná zmena hesla pre lokálne kontá
- Riadenie prístupu podľa rolí (RBAC)
- Ochrana proti CSRF pomocou overovania vlastnej hlavičky
- Bezpečnostné hlavičky (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Validácia vstupov pomocou Zod vrátane vynútenia formátu ObjectId
- Ochrana proti CSV injection pri exportoch reportov
- Zneplatnenie relácií pri zmene roly alebo e-mailu
- Korektné ukončenie servera (SIGTERM/SIGINT)
- Ochrana administrátora pred sebou samým (nemôže zmazať vlastné konto ani si zmeniť rolu)
- Rate limiting na API a prísnejšie limity na citlivých endpointoch (prihlásenie, zmena hesla, SSO, podanie nápadu)

## Technológie

### Backend
- **Runtime**: Node.js 22+
- **Framework**: Express.js
- **Databáza**: MongoDB s Prisma ORM
- **Autentifikácia**: express-session (session store v MongoDB) s bcrypt; openid-client pre SSO/OIDC
- **E-mail**: Nodemailer s SMTP nastaveniami spravovanými administrátorom
- **Webex**: Webex REST API (1:1 správy bota a príspevky do skupinových priestorov) cez natívny fetch, nastavenia spravuje administrátor
- **Bezpečnosť**: Helmet, express-rate-limit
- **Validácia**: Zod
- **Testovanie**: Jest + Supertest

### Frontend
- **Framework**: Vue 3 (Composition API)
- **UI knižnica**: Vuetify 3
- **Správa stavu**: Pinia
- **Routovanie**: Vue Router
- **Viacjazyčnosť**: vue-i18n (slovenčina a angličtina)
- **Grafy**: Chart.js s vue-chartjs
- **HTTP klient**: Axios
- **Build nástroj**: Vite
- **Testovanie**: Vitest

### DevOps
- **Kontajnerizácia**: Docker a Docker Compose
- **Reverzný proxy**: Nginx (pre frontend v produkcii)
- **E2E testovanie**: Playwright
- **CI**: GitHub Actions (workflow pre backend, frontend a E2E testy)

## Štruktúra projektu

```
idea-hub/
├── backend/                 # Express.js backend
│   ├── prisma/
│   │   ├── schema.prisma   # Schéma databázy
│   │   └── seed.ts         # Skript na naplnenie databázy
│   ├── src/
│   │   ├── __tests__/      # Jest unit/route testy (mockovaná Prisma)
│   │   ├── __integration__/# Jest integračné testy (reálna MongoDB)
│   │   ├── config/         # Konfigurácia pošty a SSO
│   │   ├── lib/            # Prisma klient
│   │   ├── middleware/     # Middleware pre autentifikáciu a RBAC
│   │   ├── routes/         # API routy (auth, sso, ideas, users, reports, departments, mail-settings, webex-settings)
│   │   ├── types/          # TypeScript typy
│   │   ├── utils/          # Validácia, mailer a šablóny, bootstrap, prune SSO používateľov
│   │   └── index.ts        # Vstupný bod servera
│   ├── Dockerfile
│   └── package.json
├── frontend/               # Vue 3 frontend
│   ├── src/
│   │   ├── __tests__/     # Vitest unit testy
│   │   ├── api/           # Moduly API klienta
│   │   ├── components/    # Znovupoužiteľné komponenty
│   │   ├── i18n/          # Jazykové katalógy (sk, en)
│   │   ├── layouts/       # Komponenty rozloženia
│   │   ├── pages/         # Komponenty stránok
│   │   ├── plugins/       # Nastavenie Vuetify
│   │   ├── router/        # Konfigurácia Vue Router
│   │   ├── stores/        # Pinia stores
│   │   ├── styles/        # Globálne štýly
│   │   ├── types/         # TypeScript typy
│   │   ├── App.vue
│   │   └── main.ts
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── e2e/                    # Playwright E2E testy (spúšťajú si vlastné servery + mock IdP)
├── dev/                    # Vývojárske a testovacie kity (Keycloak SSO kit, testovanie pošty, onboarding IAM)
├── docs/                   # Runbook na nasadenie a projektová dokumentácia
├── .github/workflows/      # CI (testy, E2E, PR kontroly)
├── playwright.config.ts
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
└── README.md
```

## Predpoklady

- **Node.js** 22.12 alebo vyšší
- **npm** alebo **yarn**
- **MongoDB** 7.x (alebo použite Docker)
- **Docker** a **Docker Compose** (pre kontajnerizované nasadenie)

## Začíname

### Možnosť 1: Docker (odporúčané)

Najjednoduchší spôsob, ako začať. Docker sa postará o všetky závislosti a nastavenie.

1. **Naklonujte repozitár**
   ```bash
   git clone <repository-url>
   cd idea-hub
   ```

2. **Vytvorte súbor s premennými prostredia**
   ```bash
   cp .env.example .env
   ```

   Upravte `.env` a v prípade potreby zmeňte hodnoty:
   ```env
   # MongoDB teraz beží s autentifikáciou. docker-compose z týchto hodnôt vytvorí
   # root používateľa mongod a zostaví DATABASE_URL backendu s prihlasovacími údajmi.
   MONGO_ROOT_USER=root
   MONGO_ROOT_PASSWORD=example-dev-password
   # Pri backende bežiacom na hostiteľovi (debug vo VS Code) DATABASE_URL smeruje na
   # localhost; vnútri docker-compose backend pristupuje k Mongu na hoste `mongodb`
   # a URL s prihlasovacími údajmi sa automaticky zostaví z
   # MONGO_ROOT_USER/MONGO_ROOT_PASSWORD.
   DATABASE_URL="mongodb://root:example-dev-password@localhost:27017/ideahub?replicaSet=rs0&authSource=admin&directConnection=true"
   SESSION_SECRET="your-super-secret-session-key-change-in-production"
   # Povinné, pretože nižšie je NODE_ENV=production: kľúč AES-256-GCM, ktorým sa
   # šifruje SMTP heslo nastavené administrátorom. Bez neho backend pri štarte
   # okamžite zlyhá a `docker compose up` sa hneď zastaví. Vygenerujte ho príkazom
   # v bezpečnostnej poznámke nižšie. (Vývoj na hostiteľovi s NODE_ENV=development
   # si namiesto toho vygeneruje dočasný kľúč.)
   MAIL_SETTINGS_KEY="your-64-hex-char-key-change-in-production"
   NODE_ENV="production"
   BACKEND_PORT=3001
   VITE_API_URL="http://localhost:3001"
   ```

   > **Bezpečnosť — pred AKÝMKOĽVEK zdieľaným alebo produkčným nasadením:**
   > - **Vygenerujte silný `SESSION_SECRET`** (nikdy nenasadzujte zástupnú hodnotu vyššie):
   >   ```bash
   >   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   >   ```
   > - **Vygenerujte `MAIL_SETTINGS_KEY`** rovnakým spôsobom (64 hex znakov). Je
   >   **povinný mimo vývojového prostredia** — backend bez neho odmietne
   >   naštartovať a oba compose súbory okamžite zlyhajú, ak nie je nastavený.
   >   Šifruje SMTP heslo a token Webex bota, ktoré administrátor neskôr nastaví na
   >   stránkach **Nastavenia e-mailu** / **Nastavenia Webexu**; nemeňte ho, inak sa
   >   predtým uložené tajomstvá stanú nedešifrovateľnými.
   > - **Nastavte `ADMIN_EMAIL` / `ADMIN_PASSWORD` na jedinečné, neprednastavené
   >   hodnoty.** Pri prvom spustení sa z nich vytvorí úvodný administrátor;
   >   použite dlhé, náhodné heslo (12+ znakov — aplikácia vynucuje minimálne
   >   12 znakov pre heslá spravované administrátorom).
   > - Zástupné hodnoty tu a demo kontá nižšie sú **len pre lokálny vývoj**.

3. **Zostavte a spustite kontajnery**
   ```bash
   docker-compose up -d
   ```

   > **Autentifikácia MongoDB (jednorazový krok pri aktualizácii).** Mongo teraz
   > beží ako replica set s autentifikáciou (interný keyFile sa pri prvom štarte
   > automaticky vygeneruje do pomenovaného volume). Autentifikácia sa nastaví len
   > na **čistom** dátovom volume, takže ak **aktualizujete existujúce nasadenie**,
   > ktorého Mongo volume vznikol pred touto zmenou, volume raz **znovu vytvorte**:
   > ```bash
   > docker compose down -v && docker compose up -d
   > ```
   > `down -v` **zmaže všetky dáta Monga v danom volume** — tu je to zámer, pretože
   > volume bez autentifikácie treba postaviť nanovo. Pri čerstvom klone netreba
   > nič navyše.

4. **Naplňte databázu** (len prvýkrát)
   ```bash
   docker-compose exec backend npm run prisma:seed
   ```

5. **Otvorte aplikáciu**
   - Frontend: http://localhost
   - Backend API: http://localhost:3001
   - MongoDB: localhost:27017

6. **Prihláste sa demo kontami** *(vytvorí ich `prisma:seed` — LEN PRE LOKÁLNY VÝVOJ)*
   - **Administrátor**: admin@ideahub.com / admin123
   - **Pokročilý používateľ**: power@ideahub.com / power123
   - **Používatelia**: john@ideahub.com, jane@ideahub.com, bob@ideahub.com / user123

   Seed vytvorí aj dve oddelenia (Všeobecné, Marketing) a ukážkové nápady vo všetkých stavoch.

   > **Upozornenie:** Ide o všeobecne známe predvolené prihlasovacie údaje, ktoré
   > vytvára seed skript. Nikdy nespúšťajte `prisma:seed` proti zdieľanej alebo
   > produkčnej databáze a pred sprístupnením aplikácie zmeňte všetky predvolené
   > administrátorské údaje.

### Možnosť 2: Lokálny vývoj

Pre aktívny vývoj bez Dockeru.

#### Nastavenie backendu

1. **Nainštalujte závislosti**
   ```bash
   cd backend
   npm install
   ```

2. **Nastavte prostredie**
   ```bash
   cp ../.env.example ../.env
   ```

   Upravte `DATABASE_URL` tak, aby smeroval na vašu lokálnu MongoDB:
   ```env
   DATABASE_URL="mongodb://localhost:27017/ideahub"
   ```

3. **Vygenerujte Prisma klienta**
   ```bash
   npm run prisma:generate
   ```

4. **Nahrajte schému do databázy**
   ```bash
   npx prisma db push
   ```

5. **Naplňte databázu**
   ```bash
   npm run prisma:seed
   ```

6. **Spustite vývojový server**
   ```bash
   npm run dev
   ```

   Backend pobeží na http://localhost:3001

#### Nastavenie frontendu

1. **Nainštalujte závislosti**
   ```bash
   cd frontend
   npm install
   ```

2. **Spustite vývojový server**
   ```bash
   npm run dev
   ```

   Frontend pobeží na http://localhost:5173

## Dostupné skripty

### Koreň repozitára

```bash
npm run dev              # Spustí backend aj frontend vo vývojovom režime (concurrently)
npm run build            # Zostaví backend aj frontend
npm run test             # Spustí unit testy backendu + frontendu
npm run test:backend     # Len testy backendu
npm run test:frontend    # Len testy frontendu
npm run test:e2e         # Playwright E2E sada (spúšťa si vlastné servery)
npm run prisma:generate  # Vygeneruje Prisma klienta
npm run prisma:seed      # Naplní databázu testovacími dátami
npm run docker:build     # Zostaví Docker obrazy
npm run docker:up        # Spustí Docker kontajnery
npm run docker:down      # Zastaví Docker kontajnery
npm run docker:logs      # Sleduje logy Docker kontajnerov
```

### Backend

```bash
npm run dev              # Spustí vývojový server s hot reload
npm run build            # Skompiluje TypeScript do JavaScriptu
npm run start            # Spustí produkčný server
npm run test             # Spustí Jest unit/route testy (databáza netreba)
npm run test:integration # Spustí integračné testy (vyžaduje bežiacu MongoDB)
npm run prisma:generate  # Vygeneruje Prisma klienta
npm run prisma:migrate   # Spustí migrácie databázy
npm run prisma:seed      # Naplní databázu testovacími dátami
npm run prisma:studio    # Otvorí Prisma Studio (GUI databázy)
```

### Frontend

```bash
npm run dev              # Spustí Vite vývojový server
npm run build            # Skontroluje typy a zostaví produkčný build
npm run preview          # Náhľad produkčného buildu
npm run test             # Spustí Vitest unit testy
npm run test:watch       # Vitest v režime watch
```

## Dokumentácia API

### Endpointy autentifikácie

- `GET /api/auth/config` – Verejné: či je SSO zapnuté (`{ ssoEnabled }`)
- `POST /api/auth/login` – Prihlásenie e-mailom a heslom (len lokálne kontá)
- `POST /api/auth/logout` – Odhlásenie aktuálneho používateľa (pri SSO reláciách môže vrátiť `redirectTo` pre RP-initiated logout)
- `POST /api/auth/change-password` – Zmena vlastného hesla (len lokálne kontá)
- `GET /api/auth/me` – Informácie o prihlásenom používateľovi
- `GET /api/auth/sso/login` – Začiatok OIDC prihlásenia (presmeruje na podnikový IAM)
- `GET /api/auth/sso/callback` – OIDC redirect URI; dokončí prihlásenie a nastaví reláciu

### Endpoint options

- `GET /api/options` – Pre prihlásených: zjednotené runtime príznaky UI v tvare `{ mailEnabled, webexEnabled, ssoShowLogout }` (ktorýkoľvek prihlásený používateľ). `mailEnabled` / `webexEnabled` (kanál je efektívne zapnutý) spolu riadia prepínač notifikácií pri nápade — zobrazí sa, ak je aspoň jeden `true`; `ssoShowLogout` (`SSO_SHOW_LOGOUT`) opäť sprístupní tlačidlo odhlásenia pre SSO používateľov. Vracia iba tieto booleovské hodnoty — žiadnu administrátorskú konfiguráciu.

### Endpointy nápadov

- `GET /api/ideas` – Zoznam všetkých nápadov (s filtrami a stránkovaním)
- `GET /api/ideas/:id` – Jeden nápad vrátane udalostí a krokov priebehu
- `POST /api/ideas` – Vytvorenie nového nápadu (pri nastavenej pošte odošle e-mail cieľovému oddeleniu)
- `PATCH /api/ideas/:id` – Úprava nápadu (len autor, kým je v stave SUBMITTED)
- `PATCH /api/ideas/:id/approve` – Schválenie nápadu (Pokročilý používateľ/Administrátor)
- `PATCH /api/ideas/:id/reject` – Zamietnutie nápadu (Pokročilý používateľ/Administrátor)
- `PATCH /api/ideas/:id/claim` – Prevzatie nápadu a začiatok práce na ňom
- `PATCH /api/ideas/:id/complete` – Označenie nápadu za dokončený (len riešiteľ)
- `PATCH /api/ideas/:id/notify` – Prepnutie odberu notifikácií o životnom cykle pre autora (len autor, v ľubovoľnom stave)
- `POST /api/ideas/:id/steps` – Pridanie kroku priebehu k rozpracovanému nápadu (len riešiteľ)
- `DELETE /api/ideas/:id` – Zmazanie nápadu (len administrátor)

### Endpointy reportov

- `GET /api/reports/summary` – Súhrnné štatistiky pre prehľad (bežní používatelia: len vlastné nápady)
- `GET /api/reports/by-department` – Počty nápadov podľa oddelení (bežní používatelia: len vlastné nápady)
- `GET /api/reports/monthly-trend` – Mesačný trend dokončených nápadov (bežní používatelia: len vlastné nápady)
- `GET /api/reports/top-contributors` – Najaktívnejší prispievatelia (Pokročilý používateľ/Administrátor)
- `GET /api/reports/filtered` – Filtrované nápady so stránkovaním (vrátane exportu do CSV)

### Endpointy oddelení

- `GET /api/departments` – Zoznam oddelení (notifikačné e-maily a ID Webex priestorov vidia len administrátori)
- `POST /api/departments` – Vytvorenie oddelenia (len administrátor)
- `PATCH /api/departments/reorder` – Zmena poradia oddelení (len administrátor)
- `PATCH /api/departments/:id` – Úprava názvu / notifikačných e-mailov / ID Webex priestorov oddelenia (len administrátor)
- `DELETE /api/departments/:id` – Zmazanie oddelenia (len administrátor; odmietnuté pri poslednom oddelení alebo pri oddelení, ktoré má nápady)

### Endpointy nastavení e-mailu (len administrátor)

- `GET /api/mail-settings` – Získanie SMTP konfigurácie (heslo sa nikdy nevracia)
- `PUT /api/mail-settings` – Uloženie SMTP konfigurácie (heslo sa ukladá šifrovane)
- `POST /api/mail-settings/test` – Odoslanie testovacieho e-mailu podľa uloženej konfigurácie

### Endpointy nastavení Webexu (len administrátor)

- `GET /api/webex-settings` – Získanie konfigurácie Webexu (token bota sa nikdy nevracia)
- `PUT /api/webex-settings` – Uloženie konfigurácie Webexu (token bota sa ukladá šifrovane)
- `POST /api/webex-settings/test` – Odoslanie testovacej správy vo Webexe podľa uloženej konfigurácie
- `GET /api/webex-settings/rooms` – Zoznam Webex priestorov bota (id + názov) pre výber priestorov oddelenia; ak je Webex vypnutý alebo nedostupný, vráti prázdny zoznam s kódom dôvodu

### Endpointy používateľov (len administrátor)

- `GET /api/users` – Zoznam všetkých používateľov
- `GET /api/users/:id` – Jeden používateľ
- `POST /api/users` – Vytvorenie nového používateľa
- `PATCH /api/users/:id` – Úprava používateľa (nemožno si zmeniť vlastnú rolu; SSO používateľov nemožno upravovať)
- `DELETE /api/users/:id` – Zmazanie používateľa (nemožno zmazať seba, SSO používateľov ani používateľov s nápadmi)

### Ostatné

- `GET /health` – Kontrola dostupnosti (`{ status: "ok", timestamp }`)

## Role a oprávnenia

### USER
- Podávanie nových nápadov
- Zobrazenie všetkých nápadov (globálny zoznam aj vlastné nápady)
- Prevzatie schválených nápadov na realizáciu
- Zapisovanie krokov priebehu a označenie prevzatých nápadov za dokončené
- Prehľad a reporty obmedzené na vlastné nápady

### POWER_USER
- Všetky oprávnenia roly USER
- Prístup do fronty na posúdenie
- Schvaľovanie alebo zamietanie podaných nápadov
- Prehľad, reporty a rebríček prispievateľov za celú organizáciu

### ADMIN
- Všetky oprávnenia roly POWER_USER
- Správa používateľov (vytváranie, úprava, mazanie, zmena rolí)
- Správa oddelení, ich notifikačných e-mailov a Webex priestorov
- Konfigurácia notifikácií cez e-mail (SMTP) a Webex
- Mazanie nápadov

## Schéma databázy

### Model User
- `id`: Jedinečný identifikátor
- `name`: Celé meno používateľa
- `email`: Jedinečná e-mailová adresa
- `passwordHash`: Heslo hashované cez bcrypt (u SSO používateľov chýba)
- `role`: USER | POWER_USER | ADMIN
- `authProvider`: LOCAL | SSO
- `ssoSub`: OIDC identifikátor subjektu (SSO používatelia)
- `department`: Oddelenie/organizačná jednotka synchronizovaná z IdP (SSO používatelia)
- `createdAt`, `updatedAt`: Časové značky

### Model Idea
- `id`: Jedinečný identifikátor
- `title`: Názov nápadu (5–120 znakov)
- `description`: Podrobný popis
- `benefits`: Očakávané prínosy
- `effort`: Odhad náročnosti (< 1 deň, 1–3 dni, > 3 dni)
- `status`: SUBMITTED | APPROVED | IN_PROGRESS | DONE | REJECTED
- `tags`: Pole štítkov
- `departmentId`: Cieľové oddelenie
- `submitterId`: Používateľ, ktorý nápad podal
- `approverId`: Používateľ, ktorý nápad schválil (môže byť prázdne)
- `assigneeId`: Používateľ, ktorý nápad rieši (môže byť prázdne)
- `notifyOnChange`: Odber notifikácií o zmenách životného cyklu zo strany autora (nullable Boolean; `null` pri nápadoch spred tejto funkcie, pri štarte sa doplní na `false`)
- `submittedAt`, `approvedAt`, `startedAt`, `completedAt`, `rejectedAt`: Časové značky

### Model Department
- `id`: Jedinečný identifikátor
- `name`: Jedinečný názov oddelenia
- `order`: Poradie zobrazenia
- `notificationEmails`: Adresy, ktoré dostávajú upozornenia na nové nápady smerované tomuto oddeleniu
- `webexRoomIds`: ID Webex priestorov (rooms), do ktorých sa posielajú upozornenia na nové nápady pre toto oddelenie

### Model IdeaEvent
- `id`: Jedinečný identifikátor
- `ideaId`: Súvisiaci nápad
- `type`: SUBMITTED | APPROVED | REJECTED | CLAIMED | STARTED | COMPLETED | UPDATED | CHANGE_REQUESTED
- `byUserId`: Používateľ, ktorý akciu vykonal
- `timestamp`: Kedy udalosť nastala
- `note`: Voliteľná poznámka/komentár

### Model IdeaStep
- `id`: Jedinečný identifikátor
- `ideaId`: Súvisiaci nápad
- `text`: Poznámka o priebehu
- `createdAt`: Časová značka

### Model MailSettings (singleton)
- SMTP `host`, `port`, `secure`, `username` a heslo uložené šifrovane (AES-256-GCM)
- Adresa `from`, jazyk notifikácií `language` (en/sk), voliteľná `subjectTemplate`
- `enabled`: Hlavný vypínač odchádzajúcej pošty

### Model WebexSettings (singleton)
- Prístupový token Webex bota uložený šifrovane (AES-256-GCM)
- Jazyk správ `language` (en/sk)
- `enabled`: Hlavný vypínač notifikácií cez Webex

## Testovanie

IdeaHub má **komplexné pokrytie testami** naprieč backendom, frontendom a end-to-end sadami.

### Súhrn pokrytia testami

- **Backend**: 664 testov v 19 Jest sadách (bežia proti mockovanej Prisme — databáza nie je potrebná)
- **Backend integračné**: 91 testov v 11 Jest sadách proti reálnej MongoDB (`npm run test:integration`)
- **Frontend**: 520 Vitest testov v 19 súboroch (stránky, stores, API klient, i18n)
- **E2E**: Playwright scenáre pokrývajúce lokálne a SSO prihlásenie, RBAC, životný cyklus nápadu, oddelenia, nastavenia e-mailu, nastavenia Webexu, odber notifikácií pri nápade a i18n

**Čo je otestované:**
- ✅ Autentifikácia, relácie a zmena hesla
- ✅ SSO/OIDC flow (prihlásenie, callback, provisioning, break-glass)
- ✅ CRUD nápadov a prechody v pracovnom postupe
- ✅ CRUD oddelení, zmena poradia a notifikačné e-maily
- ✅ Nastavenia e-mailu, e-mailové šablóny (nový nápad a životný cyklus) a správanie mailera
- ✅ Nastavenia Webexu, šablóny správ (escapovanie markdownu) a správanie odosielateľa
- ✅ Reporty a analytika (vrátane obmedzenia podľa roly)
- ✅ Správa používateľov a vynucovanie RBAC
- ✅ Validačné schémy a spracovanie chýb
- ✅ Stránky frontendu, stores a i18n katalógy

### Spustenie testov backendu

```bash
cd backend
npm test                       # unit/route sady (databáza netreba)
npm run test:integration       # integračné sady (vyžadujú bežiacu MongoDB)
npm test -- --coverage         # report pokrytia
npm test -- sso.test.ts        # jedna sada
npm test -- --watch            # režim watch
```

### Spustenie testov frontendu

```bash
cd frontend
npm test                       # Vitest, jedno spustenie
npm run test:watch             # režim watch
```

### Spustenie E2E testov

```bash
npm run test:e2e
```

Playwright si spustí vlastný backend, frontend aj mock poskytovateľa identity — porty 3001, 5173 a 8099 musia byť voľné.

### Kontinuálna integrácia

GitHub Actions (`.github/workflows/`) spúšťa sady backendu, frontendu a E2E plus PR kontroly pri pushoch a pull requestoch.

## Produkčné nasadenie

Podrobný produkčný runbook (po slovensky) nájdete v [docs/DEPLOY.md](docs/DEPLOY.md).

### Pomocou Docker Compose (odporúčané)

1. **Nastavte premenné prostredia**
   ```bash
   cp .env.example .env
   ```

   Nastavte produkčné hodnoty:
   ```env
   NODE_ENV=production
   SESSION_SECRET=<your-secure-random-secret>
   MAIL_SETTINGS_KEY=<your-secure-random-key>   # 64 hex znakov; povinné mimo vývoja — oba compose súbory bez neho okamžite zlyhajú
   ADMIN_EMAIL=admin@yourdomain.com
   ADMIN_PASSWORD=<strong-admin-password>
   COOKIE_SECURE=true   # Nastavte na true pri prevádzke za HTTPS
   ```

2. **Zostavte a nasaďte**
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   Pre lokálny Docker (HTTP):
   ```bash
   docker compose up -d --build
   ```

3. **Otvorte aplikáciu**
   - Aplikácia: http://localhost (cez nginx)
   - Predvolený administrátor: nastavený cez `ADMIN_EMAIL` / `ADMIN_PASSWORD` v .env

### Premenné prostredia

| Premenná | Popis | Predvolená hodnota |
|----------|-------|--------------------|
| `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` | Root prihlasovacie údaje MongoDB — docker-compose z nich vytvorí používateľa mongod a zostaví `DATABASE_URL` backendu s prihlasovacími údajmi | Povinné |
| `DATABASE_URL` | Pripojovací reťazec MongoDB s prihlasovacími údajmi (presný tvar pozri v `.env.example`) | Povinné |
| `SESSION_SECRET` | Tajomstvo na podpisovanie cookies relácie | Povinné mimo vývoja |
| `NODE_ENV` | `development` pre backend bežiaci na hostiteľovi; `production` pre akékoľvek nasadenie v Dockeri | `production` |
| `BACKEND_PORT` | Port backend servera | `3001` |
| `COOKIE_SECURE` | Nastaví príznak `Secure` na cookies a prepne `SameSite` cookie relácie z `Lax` na `Strict` (vyžaduje HTTPS) | `false` |
| `ADMIN_EMAIL` | E-mail úvodného administrátora — pri prvom spustení sa z týchto hodnôt vytvorí prvý administrátor | Povinné |
| `ADMIN_PASSWORD` | Heslo úvodného administrátora | Povinné |
| `ADMIN_NAME` | Predvolené zobrazované meno administrátora | `Admin` |
| `FRONTEND_URL` | Origin frontendu; používa sa pre CORS a pre presmerovanie po SSO prihlásení | `http://localhost:5173` |
| `VITE_API_URL` | Základná URL API pre frontend (build-time) | `/api` (Docker), `http://localhost:3001` (vývoj) |
| `MAIL_SETTINGS_KEY` | Kľúč AES-256-GCM, ktorým sa šifruje uložené SMTP heslo a token Webex bota. 32 bajtov: 64 hex znakov (preferované) alebo base64 dekódovateľné na 32 bajtov. Povinné mimo vývoja — backend bez neho pri štarte okamžite zlyhá (rovnako ako pri `SESSION_SECRET`). Všetko ostatné okolo notifikačných kanálov (SMTP server, adresa odosielateľa, jazyk, šablóna predmetu, heslo; token a jazyk Webexu) spravuje administrátor za behu na stránkach **Nastavenia e-mailu** / **Nastavenia Webexu** a ukladá sa to do databázy | Povinné v produkcii |

Premenné `SSO_*` a `BREAK_GLASS_EMAILS` nájdete v časti [Jednotné prihlásenie (SSO)](#jednotné-prihlásenie-sso) a postup pre vývoj/testovanie pošty v [dev/MAIL-TESTING.md](dev/MAIL-TESTING.md).

### Manuálne nasadenie

1. **Backend**
   ```bash
   cd backend
   npm ci
   npm run build
   npx prisma generate
   npx prisma db push
   npm run prisma:seed
   npm start
   ```

2. **Frontend**
   ```bash
   cd frontend
   npm ci
   npm run build
   # Priečinok dist/ obslúžte cez nginx alebo podobný server
   ```

## Bezpečnostné aspekty

- **Heslá**: Všetky heslá sú hashované cez bcrypt s 10 kolami soli
- **Relácie**: httpOnly cookies podložené session store v MongoDB so 7-dňovým TTL; `Secure` a `SameSite` sa riadia hodnotou `COOKIE_SECURE`
- **CSRF**: Pri všetkých API požiadavkách meniacich stav sa vyžaduje vlastná hlavička `X-Requested-With`
- **Validácia vstupov**: Všetky vstupy sa validujú cez Zod schémy; parametre URL sa overujú ako MongoDB ObjectId
- **RBAC**: Riadenie prístupu podľa rolí na všetkých chránených routách
- **CSV injection**: Exporty reportov sanitizujú polia, aby zabránili injection cez vzorce
- **Bezpečnostné hlavičky**: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy cez nginx a Helmet
- **Rate limiting**: Všeobecný limit API (300 požiadaviek/15 min, aktívny v produkcii) s prísnejšími limitmi pre jednotlivé endpointy: prihlásenie 10, zmena hesla 5, SSO prihlásenie 30 a podanie nápadu 30 za 15 minút
- **SMTP heslo a token Webex bota**: Uložené šifrovane cez AES-256-GCM kľúčom `MAIL_SETTINGS_KEY` a API ich nikdy nevracia
- **Spracovanie chýb**: Interné chyby servera vracajú všeobecné správy, aby neunikali informácie
- **Zneplatnenie relácií**: Relácie sa zneplatnia, keď administrátor zmení rolu alebo e-mail používateľa
- **Ochrana administrátora**: Administrátori nemôžu zmazať vlastné konto ani si zmeniť vlastnú rolu
- **Korektné ukončenie**: Server spracúva SIGTERM/SIGINT pre čisté odpojenie

## Jednotné prihlásenie (SSO)

IdeaHub môže delegovať autentifikáciu na podnikového poskytovateľa identity (IAM)
cez **OpenID Connect** pomocou **authorization-code flow s PKCE**. SSO je
**predvolene vypnuté** a zapína sa pre konkrétne nasadenie cez `SSO_ENABLED=true`.

### Prevádzka s SSO aj bez neho

SSO je **úplne voliteľné** — premenné `SSO_*` sa čítajú len vtedy, keď je
`SSO_ENABLED=true`. Pri klasickom nasadení len s heslami možno celý tento blok
ignorovať.

**Bez SSO (predvolene).** Ak `SSO_ENABLED` nie je nastavené alebo je `"false"`,
IdeaHub sa správa klasicky: **prihlásenie len e-mailom a heslom**. Prvý
administrátor sa pri prvom spustení vytvorí z `ADMIN_EMAIL` / `ADMIN_PASSWORD` /
`ADMIN_NAME` a administrátori spravujú používateľov cez používateľské API.
**Žiadna ďalšia premenná `SSO_*` nie je potrebná.**

**S SSO (`SSO_ENABLED=true`).** Nastavte aj **povinné** premenné
`SSO_ISSUER_URL`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_REDIRECT_URI`.
Ostatné premenné (`SSO_SCOPE`, `SSO_ROLES_CLAIM`, `SSO_ORG_CLAIM`,
`SSO_EMAIL_CLAIM`, `SSO_NAME_CLAIM`, `SSO_ROLE_MAP`,
`SSO_POST_LOGOUT_REDIRECT_URI`, `BREAK_GLASS_EMAILS`) sú **voliteľné a majú
predvolené hodnoty** — každú z nich nájdete v tabuľke
[Konfigurácia](#konfigurácia) nižšie.

**Povinné v oboch režimoch:** `FRONTEND_URL` musí byť nastavená správne (riadi
CORS a pri SSO aj ciele presmerovania po prihlásení/odhlásení). Prihlasovacie
údaje MongoDB (`MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` a `DATABASE_URL`
s údajmi) sú tiež povinné v oboch režimoch — autentifikácia databázy je od SSO
nezávislá.

**Rozdiely v správaní pri zapnutom SSO:**

- Prihlasovacia stránka zobrazuje hlavné tlačidlo **„Sign in with SSO"**; lokálny
  formulár s e-mailom a heslom je skrytý za prepínačom **„Use a local account"**.
- SSO používatelia sa vytvárajú **just-in-time** a ich **rola a oddelenie sa pri
  každom prihlásení znovu synchronizujú z claimov ID tokenu** (zdrojom pravdy je
  IAM).
- SSO používatelia nemajú v aplikácii **tlačidlo odhlásenia ani položku „Change
  Password"** — tieto relácie **vlastní IAM** (odhlásenie je RP-initiated na
  strane IdP, heslá sú v IAM). Nastavením `SSO_SHOW_LOGOUT=true` sa tlačidlo
  odhlásenia pre SSO používateľov znovu zobrazí a vykoná RP-initiated logout
  na IdP.
- Administrátori **nemôžu cez používateľské API upravovať SSO používateľov**
  (meno / e-mail / rola / heslo).
- **Break-glass** lokálne kontá (`BREAK_GLASS_EMAILS`, predvolene
  `[ADMIN_EMAIL]`) si vždy zachovávajú prihlásenie heslom a **nikdy** ich nemožno
  previesť na SSO, takže výpadok IAM nemôže uzamknúť prístup všetkým
  administrátorom.

**Testovanie a onboarding (odkazy, nie duplicita):**

- Lokálne, preklikateľné testovanie SSO s predpripraveným Keycloak kitom:
  [dev/SSO-TESTING.md](dev/SSO-TESTING.md).
- Produkčný onboarding IAM a čo si vyžiadať od bezpečnostného tímu:
  [dev/IAM-REQUEST.md](dev/IAM-REQUEST.md).

### Ako to funguje

1. Frontend zavolá `GET /api/auth/config` a pri `ssoEnabled` = `true` zobrazí
   tlačidlo „Sign in with SSO".
2. `GET /api/auth/sso/login` vykoná OIDC discovery voči issuerovi, vygeneruje
   `state`, `nonce` a PKCE `code_verifier`/`code_challenge` a presmeruje
   prehliadač na autorizačný endpoint IAM.
3. OIDC transakcia (`state`/`nonce`/`code_verifier`) sa uloží do samostatnej,
   HMAC-podpísanej cookie `sso_txn` s `SameSite=Lax`, obmedzenej na cestu
   `/api/auth/sso`. Je to nutné, pretože hlavná cookie relácie má
   `SameSite=Strict` a pri cross-site presmerovaní späť z IAM sa neposiela.
   Cookie je podpísaná cez `SESSION_SECRET` a expiruje po 10 minútach.
4. `GET /api/auth/sso/callback` overí transakčnú cookie, vymení kód (s validáciou
   `state`, `nonce` a PKCE) a potom načíta claimy používateľa: claimy z ID tokenu
   sa **zlúčia s odpoveďou userinfo**, ak issuer inzeruje userinfo endpoint (pri
   konflikte vyhrávajú hodnoty z ID tokenu — tie majú overený podpis; zlyhanie
   userinfo znamená zlyhanie prihlásenia, nie pokračovanie s neúplnými claimami).
   Podporuje to IdP, ktorých ID tokeny nesú iba `sub` a profilové/rolové claimy
   vydávajú výhradne cez userinfo. Používateľ sa následne vytvorí
   **just-in-time** alebo aktualizuje a začne nová relácia. Akékoľvek zlyhanie
   presmeruje na `${FRONTEND_URL}/login?error=sso_failed` bez toho, aby sa do
   prehliadača dostali podrobnosti. Relácia si navyše ponecháva ID token (len na
   strane servera) na použitie ako `id_token_hint` pri odhlásení.
5. `POST /api/auth/logout` najprv zruší lokálnu reláciu a vymaže jej cookie. Pri
   SSO reláciách potom vykoná **RP-initiated logout**: odpovie
   `{ message, redirectTo }`, kde `redirectTo` je `end_session_endpoint` issuera
   doplnený o `id_token_hint` a `post_logout_redirect_uri`
   (`SSO_POST_LOGOUT_REDIRECT_URI`). Frontend naň vykoná plnú navigáciu stránky,
   takže aj IAM ukončí svoju reláciu a ďalšie „Sign in with SSO" si opäť vyžiada
   prihlasovacie údaje. Ak je SSO vypnuté, relácia bola lokálna, issuer neinzeruje
   `end_session_endpoint` alebo zlyhá discovery, odhlásenie zostane čisto lokálne
   (bez `redirectTo`) — lokálne odhlásenie už prebehlo úspešne, takže odhlásenie
   na IdP je best-effort a nikdy ho neblokuje. ID token sa nikdy neloguje a do
   prehliadača sa nedostane inak než vnútri `redirectTo`.

Identita je naviazaná na claim `sub` z ID tokenu. Ak žiadny používateľ nezodpovedá
danému `sub`, ale existuje lokálne konto s rovnakým e-mailom, toto konto sa
**prepojí** so SSO (jeho lokálne heslo sa odstráni). Inak sa vytvorí nový SSO
používateľ. Pri každom SSO prihlásení sa meno, rola a oddelenie používateľa znovu
načítajú z IdP (zdrojom pravdy je IAM), takže SSO používateľov nemožno lokálne
upravovať cez administrátorské používateľské API.

### Break-glass lokálne prihlásenie

Lokálne prihlásenie heslom zostáva vždy dostupné pre kontá uvedené v
`BREAK_GLASS_EMAILS` (predvolene `[ADMIN_EMAIL]`). Tieto e-maily sú pri pokuse
o prihlásenie cez SSO **odmietnuté** — to zaručuje, že výpadok alebo chybná
konfigurácia IdP nikdy neuzamkne prístup všetkým administrátorom. Ponechajte si
aspoň jedno break-glass administrátorské konto so silným lokálnym heslom.

### Konfigurácia

| Premenná | Popis | Predvolená hodnota |
|----------|-------|--------------------|
| `SSO_ENABLED` | Hlavný vypínač (`true` zapne SSO) | `false` |
| `SSO_ISSUER_URL` | URL OIDC issuera (základ pre discovery) | — |
| `SSO_CLIENT_ID` | Client ID vydané zo strany IAM | — |
| `SSO_CLIENT_SECRET` | Client secret vydaný zo strany IAM | — |
| `SSO_REDIRECT_URI` | Callback URI — `{BASE_URL}/api/auth/sso/callback` | — |
| `SSO_POST_LOGOUT_REDIRECT_URI` | Kam IAM vráti prehliadač po RP-initiated logoute (musí byť registrované v IAM) | `${FRONTEND_URL}/login` |
| `SSO_SHOW_LOGOUT` | Zobraziť tlačidlo odhlásenia v aplikácii pre SSO používateľov (spustí RP-initiated logout) | `false` |
| `SSO_SCOPE` | Požadované scopes | `openid profile email` |
| `SSO_ROLES_CLAIM` | Claim obsahujúci roly z IAM (v ID tokene alebo userinfo; napr. `diam:roles`) | `roles` |
| `SSO_ORG_CLAIM` | Claim obsahujúci organizáciu/oddelenie (ID token alebo userinfo) | `org` |
| `SSO_EMAIL_CLAIM` | Claim obsahujúci e-mail (ID token alebo userinfo) | `email` |
| `SSO_NAME_CLAIM` | Claim obsahujúci zobrazované meno (ID token alebo userinfo) | `name` |
| `SSO_ROLE_MAP` | Mapovanie `iam-role:APP_ROLE,...` (rola aplikácie ∈ `USER`/`POWER_USER`/`ADMIN`) | — |
| `BREAK_GLASS_EMAILS` | E-maily, ktorým je SSO zakázané (csv, malými písmenami) | `[ADMIN_EMAIL]` |
| `SSO_PRUNE_INTERVAL_HOURS` | Počet hodín medzi čistkami osirených SSO používateľov (bez relácie, bez nápadov, bez udalostí) | `24` |

Kľúče mapovania rolí sa porovnávajú bez ohľadu na veľkosť písmen a vyhráva zhoda
s **najvyššími oprávneniami**; rola z IdP bez mapovania sa vyhodnotí ako `USER`.
Príklad:

```env
SSO_ROLE_MAP="idea-hub-admins:ADMIN,idea-hub-reviewers:POWER_USER,idea-hub-users:USER"
```

### Požiadavka na registráciu klienta v IAM

Pri žiadosti o OIDC klienta poskytnite svojmu IAM / identity tímu nasledovné:

- **Názov aplikácie**: IdeaHub
- **Flow / typ grantu**: Authorization Code s PKCE (`response_type=code`)
- **Redirect URI**: `{BASE_URL}/api/auth/sso/callback`
  (napr. `https://ideahub.example.com/api/auth/sso/callback`)
- **Scopes**: `openid profile email`
- **Požadované claimy** (v ID tokene alebo v odpovedi userinfo):
  - `sub` — stabilný jedinečný identifikátor subjektu (používa sa ako kľúč pre
    SSO; musí byť v ID tokene)
  - `email` — e-mail používateľa
  - `name` — zobrazované meno
  - `roles` — názvy skupín/rolí na mapovanie na roly aplikácie (napr.
    `idea-hub-admins`, `idea-hub-reviewers`, `idea-hub-users` — musia
    zodpovedať `SSO_ROLE_MAP`)
  - `org` — organizačná jednotka / oddelenie (voliteľné)
- **Vrátiť**: `client_id` a `client_secret` pre premenné `SSO_*` uvedené vyššie.

## Riešenie problémov

### Problémy s pripojením k MongoDB

Ak vidíte „MongoNetworkError" alebo odmietnuté pripojenie:
1. Overte, či MongoDB beží: `docker-compose ps`
2. Skontrolujte logy MongoDB: `docker-compose logs mongodb`
3. Overte `DATABASE_URL` v `.env`

### Port je už obsadený

Ak sú porty 80, 3001 alebo 27017 obsadené:
1. Zastavte kolidujúce služby
2. Alebo zmeňte porty v `docker-compose.yml` a `.env`

### Problémy s Prisma klientom

Ak vidíte „Prisma Client not generated":
```bash
cd backend
npm run prisma:generate
```

### Spojenie frontendu s API

Ak sa frontend nevie spojiť s backendom:
1. Skontrolujte `VITE_API_URL` v `.env`
2. Overte, či backend beží
3. Skontrolujte konzolu prehliadača na chyby CORS

## Podpora

Pri problémoch a otázkach:
- Vytvorte issue v repozitári
- Prezrite si existujúcu dokumentáciu
- Pozrite si príklady API endpointov

## Poďakovanie

- Postavené na Vue 3, Vuetify, Express a Prisma
- Chart.js na vizualizáciu analytiky
- MongoDB na flexibilné ukladanie dát
- Docker na kontajnerizáciu
