# IdeaHub — nasadenie do produkcie (runbook pre administrátora)

Cieľový stav: aplikácia beží na `https://<app-host>` (cert pokrýva aj prípadný
alias `<app-host-alias>`), prihlásenie cez podnikový IAM (`https://<idp-host>`),
záložné lokálne konto pre výpadok IAM. Skutočné hostname hodnoty tohto
nasadenia nesie `.env` (`FRONTEND_URL`, `SSO_ISSUER_URL`) — v tomto dokumente
sa zámerne neuvádzajú.

## 1. Obsah balíka

| Súbor | Účel |
|---|---|
| `docker-compose.prod.yml` | definícia služieb (mongo, backend, frontend, nginx proxy) — HTTPS port `443:8443` už odkomentovaný |
| `.env` | **obsahuje reálne tajomstvá** — prenášať len bezpečným kanálom, nikdy nekomitovať; compose ho načítava automaticky |
| `nginx/proxy.conf` | reverzný proxy — HTTPS server blok už aktívny |
| `nginx/certs/ideahub.crt` | certifikát (full chain: leaf + intermediates) |
| `nginx/certs/ideahub.key` | privátny kľúč (PKCS#8, nešifrovaný) |
| `ca/corp-ca.pem` | firemná CA — backend ňou overuje TLS certifikát IdP (Node nepoužíva systémové úložisko dôvery); detaily nižšie v tomto dokumente |
| `docs/DEPLOY.md` | tento dokument |

## 2. Predpoklady hosta

- Docker + Docker Compose v2.
- DNS: `<app-host>` (aj `<app-host-alias>`) smeruje na tento host.
- Otvorené porty **80** a **443** pre používateľov.
- Odchádzajúce HTTPS na `https://<idp-host>` (OIDC discovery, JWKS,
  token a userinfo endpoint) — inak SSO nefunguje. Certifikát IdP je vydaný
  firemnou CA — jej PEM musí byť v balíku ako `ca/corp-ca.pem` **a** v
  `docker-compose.prod.yml` (služba `backend`) musia byť odkomentované oba
  pripravené riadky: `NODE_EXTRA_CA_CERTS` v `environment` a volume mount
  `./ca/corp-ca.pem` vo `volumes`. V balíku sú zakomentované — bez ich
  odkomentovania backend CA nenačíta a SSO zlyhá na TLS (postup v
  `ca/README.md`).
- Odchádzajúce HTTPS na `https://webexapis.com` — len ak sa bude používať
  voliteľný Webex notifikačný kanál (zapína ho admin v UI). Bez tohto prístupu
  aplikácia funguje normálne, iba Webex správy sa nedoručia.
- Synchronizovaný čas (NTP) — validácia tokenov toleruje len 60 s odchýlky.
- Privátny kľúč čitateľný pre kontajner: nginx beží ako uid 101 —
  `chown 101 nginx/certs/ideahub.key && chmod 600 nginx/certs/ideahub.key`
  (alebo 644 v už zabezpečenom adresári).

## 3. Rozloženie súborov na hoste

```
/opt/ideahub/
├── docker-compose.prod.yml
├── .env
├── ca/
│   └── corp-ca.pem
└── nginx/
    ├── proxy.conf
    └── certs/
        ├── ideahub.crt
        └── ideahub.key
```

> **Prečo dva priečinky s certifikátmi (nezlučovať):** `nginx/certs/` nesie
> identitu servera vrátane **privátneho kľúča** a mountuje sa iba do nginx;
> `ca/` nesie verejný dôveryhodný koreň (nie je tajomstvo) a mountuje sa iba
> do backendu — každý kontajner vidí len to, čo potrebuje. Súbory majú aj
> rôzny životný cyklus (serverový certifikát sa obnovuje ~ročne, firemná CA
> výnimočne). Ak by ste `corp-ca.pem` predsa presúvali, jediný pevný kontrakt
> je cesta V KONTAJNERI: ľavá strana volume mountu v compose musí ukazovať na
> skutočné umiestnenie súboru a pravá sa musí zhodovať s `NODE_EXTRA_CA_CERTS`.

## 4. Obrazy

S prístupom na Docker Hub:

```bash
cd /opt/ideahub
docker compose -f docker-compose.prod.yml pull
```

Bez prístupu na Hub (offline prenos — pripraví ho odovzdávajúci):

```bash
# na stroji s prístupom:
docker save -o ideahub-images.tar \
  fokips/ideahub-backend:1.2.5 fokips/ideahub-frontend:1.2.5 \
  mongo:7.0.39 nginxinc/nginx-unprivileged:1.25.5-alpine
# na hoste:
docker load -i ideahub-images.tar
```

## 5. Spustenie

```bash
cd /opt/ideahub
docker compose -f docker-compose.prod.yml up -d --no-build
docker compose -f docker-compose.prod.yml ps
```

Prvý štart urobí automaticky (~1 min): Mongo si vygeneruje keyfile, inicializuje
replica set a vytvorí root používateľa; backend spustí `prisma db push`,
vytvorí break-glass admin konto (`ADMIN_EMAIL`/`ADMIN_PASSWORD` z env) a
predvolené oddelenie. Počkajte, kým `ps` ukáže všetky služby healthy/running.

> **NIKDY nespúšťajte `prisma:seed`** — vytvára demo kontá so známymi heslami.
> **NIKDY `docker compose down -v`** — `-v` zmaže produkčnú databázu.

## 6. Overenie po nasadení

1. `curl -sSI https://<app-host>` → `200`, bezpečnostné hlavičky (CSP,
   X-Frame-Options…). Ak CLI nepozná firemnú CA, otestujte v prehliadači —
   zámok bez varovania.
2. Prihlasovacia stránka `https://<app-host>/login` zobrazuje tlačidlo
   **„Sign in with SSO"**.
3. **SSO test**: prihláste sa účtom s IAM rolou mapovanou na ADMIN (kódy rolí
   určuje `SSO_ROLE_MAP` v `.env`) → v aplikácii ste ADMIN; účet bez roly →
   bežný používateľ. Prihlásený SSO používateľ nemá
   tlačidlo odhlásenia ani zmenu hesla — **to je zámer** (session vlastní IAM).
4. **Break-glass test**: „Use a local account" + `ADMIN_EMAIL`/`ADMIN_PASSWORD`
   z `.env.production` → funguje lokálne prihlásenie (poistka pre výpadok IAM).
5. V Users (ako admin) vidno JIT-vytvorených SSO používateľov so „SSO" chipom
   a zamknutou editáciou.

## 7. Riešenie problémov

| Príznak | Príčina / riešenie |
|---|---|
| `/login?error=sso_failed` | Dôvod je len v logu: `docker logs ideahub-backend --tail 50` (riadok „SSO callback failed: …") |
| dôvod `idp error: invalid_scope` | IAM odmietol scope — over hodnotu `SSO_SCOPE` v `.env.production` voči scopes registrovaným pre klienta (TODO poznámka v súbore); po zmene `up -d` znova |
| dôvod `redirect_uri` / mismatch | registrovaná redirect URI v IAM sa musí PRESNE zhodovať s `https://<app-host>/api/auth/sso/callback` (hodnota `SSO_REDIRECT_URI` v `.env`) |
| chybová stránka IAM „Neznámy typ autentifikácie" | autentifikačný typ klienta nie je na IAM podporovaný/nastavený — IAM tím upraví `diam_authn`/`diam_authn_default` v registrácii klienta (na tomto nasadení funguje `L`); nahláste s Correlation ID z chybovej stránky. Na strane aplikácie sa nemení nič |
| dôvod `unable to verify the first certificate` / `unable to get local issuer certificate` | backend neverí TLS certifikátu IdP — chýba alebo je zlý `ca/corp-ca.pem`, alebo v `docker-compose.prod.yml` ostali zakomentované riadky `NODE_EXTRA_CA_CERTS`/volume mount (postup v `ca/README.md`); ak pri prvom `up` súbor chýbal, Docker vytvoril rovnomenný ADRESÁR — zmazať, nahradiť súborom, potom `up -d` |
| certifikátové varovanie v prehliadači | skontrolujte, že `ideahub.crt` je full chain a klient dôveruje firemnej CA |
| mongo unhealthy | prvý štart trvá ~40 s; inak `docker logs ideahub-mongodb` |
| prihlásenie „nedrží" (cookie) | `COOKIE_SECURE=true` vyžaduje funkčné HTTPS; port 80 v balíku automaticky presmerúva na HTTPS |
| Webex notifikácie nechodia | v UI **Webex settings** musí byť kanál zapnutý a uložený bot token; doručenie je best-effort (aplikáciu nikdy neblokuje) — dôvod hľadajte v logu backendu (riadky `WEBEX`); overte odchádzajúce HTTPS na `webexapis.com` |

## 8. Prevádzka

- **Logy**: `docker logs <ideahub-backend|ideahub-nginx|ideahub-mongodb>`
  (rotované, max 3×10 MB).
- **Reštart**: `docker compose -f docker-compose.prod.yml restart` (spúšťať z `/opt/ideahub`, aby sa načítal `.env`)
- **Upgrade**: nové tagy obrazov → `pull` (alebo `load`) → `up -d --no-build`
  (migrácie schémy prebehnú pri štarte backendu automaticky). Táto verzia pridáva
  pole `notifyOnChange` (prihlásenie autora na e-maily o zmenách jeho nápadu) —
  zmena je aditívna: backend pri štarte sám doplní chýbajúce pole existujúcim
  nápadom (predvolene vypnuté), takže netreba žiadny manuálny DB krok. Žiadne nové
  premenné prostredia; funkcia ostáva neaktívna, kým e-maily nezapne admin v Email
  settings a zároveň sa autor neprihlási na odber zmien pri konkrétnom nápade — obe
  podmienky musia platiť súčasne. Pridáva tiež voliteľný **Webex kanál**
  (1:1 správy od bota, rovnaký opt-in mechanizmus popri e-mailoch) — tiež
  aditívne: žiadne nové premenné prostredia, žiadny DB krok; kanál je neaktívny,
  kým ho admin nenastaví v **Webex settings** (bot token sa ukladá šifrovane).
- **Zálohy zatiaľ nie sú zriadené** (denný `mongodump` + záloha
  `.env.production` je odporúčaná — v riešení mimo tohto runbooku).
- Notifikácie (SMTP aj Webex) sa konfigurujú za behu v UI (Email settings /
  Webex settings, len admin); do prvého nastavenia sa nič neposiela.
