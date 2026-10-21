# Deelrit

Deelrit is een webapp om gedeelde auto’s te beheren. Gebruikers registreren ritten en tankbeurten en verdelen brandstofkosten volgens gereden kilometers.

## Technologie

- Next.js en React
- TypeScript
- PostgreSQL
- Better Auth voor accounts en autogroepen
- Nodemailer met Gmail voor wachtwoordreset
- Node.js-test runner voor automatische tests

## Lokaal installeren

Deze stappen zijn nodig bij een nieuwe checkout of op een andere computer. Een bestaande werkende installatie hoeft niet opnieuw geïnstalleerd te worden.

Gebruik Node.js 24 LTS en npm. Voer de commando’s uit vanuit de hoofdmap van het project, waar `package.json` staat.

Installeer de dependencies uit het lockbestand:

```powershell
npm ci
```

## Omgevingsvariabelen

Maak in de hoofdmap een bestand `.env.local` aan.

| Variabele            | Betekenis                                                                           |
| -------------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL-verbindingsstring, inclusief de SSL-instellingen van je databaseprovider |
| `BETTER_AUTH_URL`    | Basisadres van de app, lokaal bijvoorbeeld `http://localhost:3000`                  |
| `BETTER_AUTH_SECRET` | Lang, willekeurig geheim voor de authenticatie                                      |
| `GMAIL_USER`         | Volledig Gmail-adres waarmee resetmails worden verstuurd                            |
| `GMAIL_APP_PASSWORD` | Google-app-wachtwoord van dat Gmail-account                                         |

Genereer een authenticatiegeheim met:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Gebruik de uitvoer als waarde van `BETTER_AUTH_SECRET`. Houd het geheim stabiel voor een bestaande installatie.

Voor Gmail moet tweestapsverificatie ingeschakeld zijn. Maak daarna een app-wachtwoord aan via:

https://myaccount.google.com/apppasswords

Gebruik het app-wachtwoord als `GMAIL_APP_PASSWORD`, niet je gewone Google-wachtwoord. Spaties uit het app-wachtwoord worden door de mailcode verwijderd.

`.env.local` wordt door Git genegeerd. Commit geen wachtwoorden, API-sleutels of databaseverbindingsstrings.

Herstart de ontwikkelserver nadat je omgevingsvariabelen hebt gewijzigd.

## Database en migraties

Het project gebruikt PostgreSQL. De migraties staan in `database/migrations/`. Het script `scripts/migrate.mjs` houdt uitgevoerde migraties met checksums bij.

Controleer eerst met welke database je `DATABASE_URL` verbinding maakt.

### Status bekijken

Dit commando leest de migratiestatus zonder het schema te wijzigen:

```powershell
node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/migrate.mjs status
```

Als `.env` ontbreekt, meldt Node dat het zonder dit bestand doorgaat. Dat is normaal wanneer je alleen `.env.local` gebruikt.

### Nieuwe, lege database

Voer de openstaande migraties uit:

```powershell
node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/migrate.mjs up
```

Dit wijzigt de database en maakt bij een lege database het beginschema aan.

### Bestaande database zonder migratieregister

Controleer eerst of het bestaande schema overeenkomt met `database/migrations/001_initial_schema.sql`. Maak een back-up voordat je databasewijzigingen uitvoert.

Registreer daarna het bestaande beginschema:

```powershell
node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/migrate.mjs baseline
```

`baseline` registreert de eerste migratie als reeds aanwezig. Het voert de SQL van die migratie niet uit.

Het script controleert de aanwezige tabelnamen. Het controleert niet automatisch of alle kolommen, constraints en indexen overeenkomen; die schemacontrole moet vooraf gebeuren.

Gebruik `baseline` slechts eenmaal voor een bestaande database zonder migratieregister. Het is niet nodig bij een database waarop de migraties al geregistreerd zijn.

### Latere schemawijzigingen

Voeg nieuwe SQL-bestanden toe met oplopende nummers, bijvoorbeeld `002_beschrijving.sql`.

Wijzig geen reeds geregistreerde migraties: het script controleert de checksums en weigert een afwijkende migratiegeschiedenis.

Bekijk de status en voer daarna de openstaande migraties uit:

```powershell
node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/migrate.mjs status
node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/migrate.mjs up
```

Migraties worden binnen een transactie uitgevoerd. Het script bevat geen automatisch rollbackcommando voor reeds afgeronde migraties.

## Ontwikkelserver starten

```powershell
npm run dev
```

Open daarna:

http://localhost:3000

Maak via het inlogscherm een account aan.

## Wachtwoordreset

Op `/login` staat onder de inlogknop de link **Wachtwoord vergeten?**.

De gebruiker kan daarmee:

1. Een resetlink aanvragen voor het e-mailadres van het account.
2. De link uit de Gmail-mail openen.
3. Een nieuw wachtwoord van minstens 12 tekens instellen.
4. Opnieuw inloggen via het inlogscherm.

Resetlinks zijn 30 minuten geldig. Na een geslaagde wachtwoordreset worden bestaande sessies ingetrokken.

De aanvraagbevestiging vermeldt niet of het ingevoerde e-mailadres bij een account hoort.

Voor verzending gebruikt de app rechtstreeks Gmail via SMTP. Een eigen domein of Resend-configuratie is hiervoor niet nodig. Gmail heeft verzendlimieten en kan verbindingen blokkeren.

## Controles

Voer onderstaande controles uit vanuit de hoofdmap van het project.

### Automatische tests

```powershell
node --experimental-strip-types --test tests/*.test.mjs
```

De tests controleren onder meer kostenverdeling, snapshots, toegangscontrole, afrekenacties en paginering.

Databasetoegang wordt in de betreffende tests nagebootst. Deze tests bewijzen niet dat echte SQL-query’s, gelijktijdige transacties of mailverzending correct werken.

### TypeScript

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Dit controleert de types zonder JavaScript of een incrementeel TypeScript-cachebestand te genereren.

### ESLint

```powershell
node node_modules/eslint/bin/eslint.js src
```

Dit controleert de broncode zonder automatische fixes.

Bij succesvolle TypeScript- en ESLint-controles kan de terminal zonder verdere uitvoer terugkeren.

### Handmatige controle

Controleer bij relevante wijzigingen ook in de browser:

- Account aanmaken, inloggen en uitloggen.
- Ritten en tankbeurten toevoegen en bewerken.
- Geschiedenis openen en tussen pagina’s wisselen.
- Kostenverdeling en afrekening controleren.
- Wachtwoordreset aanvragen, mail ontvangen en opnieuw inloggen.

## Productie

Maak een productiebuild:

```powershell
npm run build
```

Start daarna de productieversie:

```powershell
npm start
```

De build schrijft gegenereerde bestanden naar `.next`.

Stel op de hostingomgeving dezelfde benodigde omgevingsvariabelen in. Gebruik voor `BETTER_AUTH_URL` het publieke HTTPS-adres van de app.

De hostingomgeving moet Node.js ondersteunen en verbinding kunnen maken met PostgreSQL en Gmail SMTP.

Voer benodigde databasemigraties afzonderlijk uit. `npm run build` en `npm start` voeren geen migraties uit.

## Belangrijke mappen

| Pad                    | Inhoud                                      |
| ---------------------- | ------------------------------------------- |
| `src/app/`             | Pagina’s en API-routes                      |
| `src/components/`      | Herbruikbare interfacecomponenten           |
| `src/actions/`         | Serveracties                                |
| `src/lib/`             | Authenticatie, databasecode en berekeningen |
| `database/migrations/` | SQL-migraties                               |
| `scripts/migrate.mjs`  | Migratiescript                              |
| `tests/`               | Automatische tests                          |
