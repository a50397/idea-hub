# ca/ — firemná CA pre backend

`corp-ca.pem` je verejný certifikát firemnej certifikačnej autority (formát
PEM, blok `-----BEGIN CERTIFICATE-----`; pri medzičlánkoch celá chain v jednom
súbore). Backend ním overuje TLS certifikát IdP (`https://<idp-host>`, hodnota
`SSO_ISSUER_URL` v `.env`) pri OIDC discovery, token a userinfo požiadavkách — Node nepoužíva systémové
úložisko dôvery, takže bez tohto súboru SSO zlyhá na
`unable to verify the first certificate`.

## Aktivácia (jednorazovo pri nasadení)

1. Uložte PEM do tohto priečinka ako `ca/corp-ca.pem`.
2. V `docker-compose.prod.yml` v službe `backend` odkomentujte **oba**
   pripravené riadky:
   - `NODE_EXTRA_CA_CERTS: /etc/ssl/corp/corp-ca.pem` (sekcia `environment`)
   - `- ./ca/corp-ca.pem:/etc/ssl/corp/corp-ca.pem:ro` (sekcia `volumes`)
3. `docker compose -f docker-compose.prod.yml up -d`

Kontrakt ciest: pravá strana volume mountu (cesta V KONTAJNERI) sa musí
zhodovať s hodnotou `NODE_EXTRA_CA_CERTS`; ľavá strana ukazuje na skutočné
umiestnenie súboru na hoste.

## Kontrola súboru

```bash
openssl x509 -in ca/corp-ca.pem -noout -subject -issuer -enddate
```

## Časté chyby

- Súbor chýbal pri prvom `up` → Docker namiesto neho vytvoril rovnomenný
  **adresár** `corp-ca.pem/`. Zmažte ho, nahraďte súborom a spustite `up -d`
  znova.
- Nikdy neriešte dôveru cez `NODE_TLS_REJECT_UNAUTHORIZED=0` — vypína celé
  overovanie TLS.
- PEM nie je tajomstvo, no je špecifický pre prostredie — `ca/*.pem` sa
  nekomituje (pozri `.gitignore`); do balíka ho pridáva odovzdávajúci.
