# IdeaHub — nasadenie do produkcie (runbook pre administrátora)

Cieľový stav: aplikácia beží na `https://ideahub` (cert pokrýva aj
`ideahub.intra`), prihlásenie cez podnikový IAM (`https://idp.iam-intranet`),
záložné lokálne konto pre výpadok IAM.

## 1. Obsah balíka

| Súbor | Účel |
|---|---|
| `docker-compose.prod.yml` | definícia služieb (mongo, backend, frontend, nginx proxy) — HTTPS port `443:8443` už odkomentovaný |
| `.env` | **obsahuje reálne tajomstvá** — prenášať len bezpečným kanálom, nikdy nekomitovať; compose ho načítava automaticky |
| `nginx/proxy.conf` | reverzný proxy — HTTPS server blok už aktívny |
| `nginx/certs/ideahub.crt` | certifikát (full chain: leaf + intermediates) |
| `nginx/certs/ideahub.key` | privátny kľúč (PKCS#8, nešifrovaný) |
| `docs/DEPLOY.md` | tento dokument |

## 2. Predpoklady hosta

- Docker + Docker Compose v2.
- DNS: `ideahub` (aj `ideahub.intra`) smeruje na tento host.
- Otvorené porty **80** a **443** pre používateľov.
- Odchádzajúce HTTPS na `https://idp.iam-intranet` (OIDC discovery, JWKS,
  token a userinfo endpoint) — inak SSO nefunguje.
- Synchronizovaný čas (NTP) — validácia tokenov toleruje len 60 s odchýlky.
- Privátny kľúč čitateľný pre kontajner: nginx beží ako uid 101 —
  `chown 101 nginx/certs/ideahub.key && chmod 600 nginx/certs/ideahub.key`
  (alebo 644 v už zabezpečenom adresári).

## 3. Rozloženie súborov na hoste

```
/opt/ideahub/
├── docker-compose.prod.yml
├── .env
└── nginx/
    ├── proxy.conf
    └── certs/
        ├── ideahub.crt
        └── ideahub.key
```

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
  fokips/ideahub-backend:1.2.2 fokips/ideahub-frontend:1.2.2 \
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

1. `curl -sSI https://ideahub` → `200`, bezpečnostné hlavičky (CSP,
   X-Frame-Options…). Ak CLI nepozná firemnú CA, otestujte v prehliadači —
   zámok bez varovania.
2. Prihlasovacia stránka `https://ideahub/login` zobrazuje tlačidlo
   **„Sign in with SSO"**.
3. **SSO test**: prihláste sa účtom s rolou `ideahub_admin` → v aplikácii ste
   ADMIN; účet bez roly → bežný používateľ. Prihlásený SSO používateľ nemá
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
| dôvod `redirect_uri` / mismatch | registrovaná redirect URI v IAM sa musí PRESNE zhodovať s `https://ideahub/api/auth/sso/callback` |
| certifikátové varovanie v prehliadači | skontrolujte, že `ideahub.crt` je full chain a klient dôveruje firemnej CA |
| mongo unhealthy | prvý štart trvá ~40 s; inak `docker logs ideahub-mongodb` |
| prihlásenie „nedrží" (cookie) | `COOKIE_SECURE=true` vyžaduje funkčné HTTPS; port 80 v balíku automaticky presmerúva na HTTPS |

## 8. Prevádzka

- **Logy**: `docker logs <ideahub-backend|ideahub-nginx|ideahub-mongodb>`
  (rotované, max 3×10 MB).
- **Reštart**: `docker compose -f docker-compose.prod.yml restart` (spúšťať z `/opt/ideahub`, aby sa načítal `.env`)
- **Upgrade**: nové tagy obrazov → `pull` (alebo `load`) → `up -d --no-build`
  (migrácie schémy prebehnú pri štarte backendu automaticky).
- **Zálohy zatiaľ nie sú zriadené** (denný `mongodump` + záloha
  `.env.production` je odporúčaná — v riešení mimo tohto runbooku).
- SMTP notifikácie sa konfigurujú za behu v UI (Email settings, len admin);
  do prvého nastavenia sa maily neposielajú.
