# abap-adt-mcp

**Lassen Sie Claude ABAP-Code auf Ihren SAP-Systemen lesen, schreiben, testen und prüfen.**

[English](README.md) · [Português (Brasil)](README.pt-BR.md) · Deutsch · [Projektseite](https://williansaez.github.io/abap-adt-mcp/de/)

[![npm version](https://img.shields.io/npm/v/abap-adt-mcp)](https://www.npmjs.com/package/abap-adt-mcp)
[![CI](https://github.com/williansaez/abap-adt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/williansaez/abap-adt-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/node/v/abap-adt-mcp)](https://nodejs.org)
[![MCP Registry](https://img.shields.io/badge/MCP%20registry-listed-informational)](https://registry.modelcontextprotocol.io/?search=abap-adt-mcp)

abap-adt-mcp ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server für SAP ABAP: er gibt Claude Desktop, Claude Code, VS Code oder einem anderen MCP-Host die ADT-REST-Services, die Eclipse verwendet (Quelltext, Transporte, Aktivierung, ABAP Unit, ATC, Kurzdumps und, wo Sie es erlauben, Tabellendaten). Ein Prozess stellt **173 Tools** bereit (114 im Preset `focused`), über beliebig viele Systeme, S/4HANA Cloud wie On-Premise.

> **Bevor Sie ein Produktivsystem anbinden**
>
> - Das Modell handelt als Ihr SAP-Benutzer und kann nichts, was Eclipse Ihnen verweigern würde. Was es liest (Quelltext, Dumps, Tabellenzeilen, wo Sie sie öffnen), wird an das Modell gesendet.
> - Eine Destination ohne [`policy`](#richtlinienschlüssel)-Block ist in jedem Paket beschreibbar, das Ihr Benutzer bearbeiten darf; Tabellendaten bleiben geschlossen, bis Sie sie öffnen.
> - Empfohlen: nur Entwicklungs- und Testsysteme. Muss eine Produktiv-Destination existieren, geben Sie ihr die `PRD`-Richtlinie aus [Schritt 4](#4-produktiv--und-on-premise-systeme-hinzufügen): der Server setzt sie vor jedem SAP-Aufruf durch, unabhängig davon, was der Host genehmigt, sodass ein unbedachter Prompt nicht schreiben kann, wo die Richtlinie es verbietet ([Für Administratoren](#für-administratoren)).

## So sieht es aus

![Ein Satz im Chat wird zu searchObject, getObjectSource, editObjectSource und unitTestRun, danach eine Ergebniskarte: 3 Tests bestanden, Transportauftrag DEVK900123](docs/media/brag/film-flow.gif)

Das ist die ganze Idee. Sie schreiben einen Satz. Das Modell wählt die Tools, der Server sperrt das Objekt, schreibt, aktiviert und gibt es frei, und die Unit-Tests kommen grün zurück, mit der Transportnummer daran. Verlangen Sie dieselbe Änderung auf einem Produktivsystem, lautet die Antwort `policyDenied`, bevor ein einziger SAP-Aufruf hinausgeht: Die Leitplanken sitzen im Server, nicht im Chatfenster.

Sieben kurze Filme zeigen das und die einzelnen Aufgaben dahinter, einen Kurzdump bis zur Zeile verfolgt, einen ATC-Lauf mit seinen Quickfixes, eine Transportprüfung, eine Klasse samt Test angelegt, eine Prüfung der ABAP-Cloud-Reife. Sie stehen auf der [Projektseite](https://williansaez.github.io/abap-adt-mcp/de/#watch), mit Untertiteln.

## Inhalt

- [So sieht es aus](#so-sieht-es-aus)
- [Einrichtung](#einrichtung)
- [Was Sie das Modell fragen können](#was-sie-das-modell-fragen-können)
- [Für Administratoren](#für-administratoren)
- [Authentifizierung](#authentifizierung)
- [S/4HANA Cloud versus On-Premise](#s4hana-cloud-versus-on-premise)
- [Weitere Installationswege](#weitere-installationswege)
- [Konfiguration](#konfiguration)
- [Tool-Katalog](#tool-katalog)
- [Vergleich mit dem offiziellen ADT MCP Server von SAP](#vergleich-mit-dem-offiziellen-adt-mcp-server-von-sap)
- [SAP API Policy](#sap-api-policy)
- [Fehlerbehebung](#fehlerbehebung)
- [Tests und Mitarbeit](#tests-und-mitarbeit)
- [Danksagung](#danksagung)
- [Lizenz](#lizenz)

## Einrichtung

Drei Voraussetzungen:

- **Node.js 22.12 oder neuer** (22 oder 24 LTS) von [nodejs.org](https://nodejs.org). Auf einem verwalteten Firmenrechner ist das Ticket an die IT eine Zeile: "Bitte Node.js LTS (22 oder neuer) installieren"; mehr muss nicht installiert werden.
- **Zugang zum SAP-System**, derselbe wie für Eclipse ADT: auf S/4HANA Cloud die Entwickler-Geschäftsrolle (`SAP_BR_DEVELOPER` in der Standardauslieferung); On-Premise bitten Sie Ihr Basis-Team um den Service `/sap/bc/adt` in `SICF` und die üblichen ADT-Berechtigungen.
- **Ein Chromium-Browser** (Chrome, Edge oder Brave) für die Browser-Anmeldung (`authType: sso`, der Standard); nicht nötig für `basic`, `oauth` oder `sso2`.

### 1. Beschreiben Sie Ihre SAP-Systeme

Legen Sie in Ihrem Benutzerordner den Ordner `.abap-adt-mcp` an und darin die Datei `systems.json`, ein Eintrag je System (eine "Destination"):

- Windows: der Ordner ist `C:\Users\<Ihr Benutzername>\.abap-adt-mcp`. Fügen Sie das JSON in den Editor (Notepad) ein und setzen Sie unter "Speichern unter" den Dateityp auf "Alle Dateien" und den Namen auf `systems.json`, sonst speichert Notepad `systems.json.txt`, und der Server findet nichts.
- macOS: der Ordner ist `/Users/<sie>/.abap-adt-mcp` (Finder, Shift-Cmd-G, `~`); ein beliebiger Editor.

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true,
    "policy": { "allowedPackages": ["ZFIN"] }
  }
}
```

- `DEV` ist Ihr Name für das System und das Wort, das Sie in Chats verwenden; `"default": true` erlaubt, es wegzulassen.
- `url`: die Adresse, mit der Sie das Launchpad oder Eclipse öffnen, ohne Pfad.
- `client`: der Mandant, an dem sich Ihre SSO-Sitzung anmeldet (der Eintrag "Über" im Benutzermenü des Launchpads zeigt ihn). Ein falscher Mandant zeigt sich später als "not authorized" bei Objekten, die Sie in Eclipse öffnen können.
- `authType` ist standardmäßig `sso`: ein Browserfenster öffnet sich einmal für die Anmeldung, wie bei Eclipse ADT. Weitere Modi: [Authentifizierung](#authentifizierung).
- `policy.allowedPackages`: die Pakete, in die das Modell schreiben darf, exakte Namen oder Muster (`ZFIN`, `Z*`). Ohne den Schlüssel ist jedes Paket beschreibbar, das Sie in Eclipse bearbeiten können; beginnen Sie mit einem.

Produktiv- und On-Premise-Systeme kommen in [Schritt 4](#4-produktiv--und-on-premise-systeme-hinzufügen), nach dem ersten erfolgreichen Aufruf.

### 2. Registrieren Sie den Server in Ihrem Host

Das Paket liegt auf npm als [`abap-adt-mcp`](https://www.npmjs.com/package/abap-adt-mcp); `npx` holt es. Claude Desktop, ohne Terminal: erster Block. Claude Code: ein Befehl. VS Code, Cursor und andere: Verweis unten. Jeder Eintrag übergibt dem Server zwei Einstellungen: `SAP_SYSTEMS_FILE` (wo `systems.json` liegt) und `MCP_TOOLSETS=focused`, das die 114 Entwicklungs-Tools für den Alltag statt aller 173 veröffentlicht, damit die Tool-Schemata den Kontext des Chats nicht aufbrauchen (weglassen, wenn Sie Debugger, Traces, abapGit, RAP oder Refactoring brauchen).

**Claude Desktop**, ohne Terminal:

1. Settings > Developer > Edit Config öffnet den Ordner mit `claude_desktop_config.json`; öffnen Sie die Datei in Notepad oder einem beliebigen Editor. Hat Settings keinen Reiter Developer, wird Ihr Claude Desktop von der IT verwaltet: bitten Sie sie, den Eintrag unten hinzuzufügen.
2. Enthält die Datei bereits `"mcpServers"`, fügen Sie nur den Eintrag `"abap-adt-mcp"` darin hinzu; ist sie leer, fügen Sie den ganzen Block ein.
3. Ersetzen Sie `<sie>` durch Ihren Benutzernamen (macOS: `/Users/<sie>/.abap-adt-mcp/systems.json`). Die Schrägstriche im Windows-Pfad sind Absicht: JSON braucht `\\` für jeden Backslash, Schrägstriche brauchen nichts.
4. Beenden und öffnen Sie die App neu.

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": { "SAP_SYSTEMS_FILE": "C:/Users/<sie>/.abap-adt-mcp/systems.json", "MCP_TOOLSETS": "focused" }
    }
  }
}
```

**Claude Code**, eine Zeile im Terminal (`-s user` registriert den Server für jedes Projekt, nicht nur für den aktuellen Ordner):

```bash
claude mcp add -s user abap-adt-mcp -e SAP_SYSTEMS_FILE=$HOME/.abap-adt-mcp/systems.json -e MCP_TOOLSETS=focused -- npx -y abap-adt-mcp
```

Dasselbe in der Windows-PowerShell:

```powershell
claude mcp add -s user abap-adt-mcp -e SAP_SYSTEMS_FILE=$env:USERPROFILE\.abap-adt-mcp\systems.json -e MCP_TOOLSETS=focused -- npx -y abap-adt-mcp
```

**VS Code mit GitHub Copilot**: derselbe Eintrag in `.vscode/mcp.json` unter einem obersten Schlüssel `servers` statt `mcpServers`; [docs/HOSTS.md](docs/HOSTS.md#vs-code-with-github-copilot-agent-mode) (auf Englisch) enthält die Datei, wie sie getestet wurde, mit `${input:}` für Geheimnisse.

- Cursor, Cline, Windsurf, das Copilot CLI und Eclipse: [docs/HOSTS.md](docs/HOSTS.md).
- Behalten Sie den Schlüssel `abap-adt-mcp`: er ist der Name, den der Host anzeigt, das Präfix jedes Tools und das, wonach die Agent-Skills dieses Projekts suchen.

### 3. Sagen Sie hallo

Öffnen Sie einen neuen Chat und tippen Sie (ersetzen Sie `DEV` durch den gewählten Schlüssel; die Klasse ist SAP-Standard, der Prompt liest also nur und ist auf jedem System sicher):

> Liste meine SAP-Systeme, melde dich an DEV an und zeige mir den Quelltext der Klasse CL_ABAP_CHAR_UTILITIES.

Ein Browserfenster öffnet sich für die SSO-Anmeldung (mit "angemeldet bleiben" sind spätere Anmeldungen still); das Modell ruft dann `listSystems`, `searchObject` und `getObjectSource` auf, und die Antwort nennt Ihre Destinationen und endet mit dem Quelltext der Klasse. Der Host fragt, bevor er ein Tool ausführt, das Sie nicht dauerhaft genehmigt haben: dieser Dialog ist eine Höflichkeit des Hosts, der `policy`-Block ist die Garantie. Erscheint der Server nicht im Host, nennt [Fehlerbehebung](#fehlerbehebung) das zu lesende Protokoll.

Zwei Dinge, die Sie vor der ersten Änderung wissen sollten:

- Ein Schreibzugriff, den die Richtlinie verbietet, kommt als Ablehnung zurück, nicht als stilles Nichts: `kind: "policyDenied"`, `Policy: setObjectSource blocked on destination PRD (readOnly)`.
- Jede Änderung des Modells liegt auf Ihrem Transport und in der Versionshistorie des Objekts: `objectDiff` und `revisions` zeigen sie, und nichts verlässt DEV ohne eine Transportfreigabe, die Sie genehmigen.

### 4. Produktiv- und On-Premise-Systeme hinzufügen

Dieselbe Datei mit einem Produktiv- und einem On-Premise-Eintrag ([systems.example.json](systems.example.json) enthält jede Option):

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true,
    "policy": { "allowedPackages": ["Z*"] }
  },
  "PRD": {
    "url": "https://myYYYYYY.s4hana.cloud.sap",
    "client": "100",
    "authType": "sso",
    "policy": { "readOnly": true, "allowDataPreview": false, "deniedTools": ["exportPackageSources"] }
  },
  "ONPREM": {
    "url": "https://sap.example.com:44300",
    "client": "100",
    "authType": "basic",
    "user": "DEVELOPER",
    "password": "${env:ONPREM_PASSWORD}",
    "policy": { "allowedPackages": ["Z*", "$*"] },
    "tls": { "ca": "/etc/ssl/corp-ca.pem" }
  }
}
```

- Muss eine Produktiv-Destination existieren, ist `PRD` ihre Mindestrichtlinie: `readOnly` lehnt jeden Schreibzugriff ab, was auch immer vom Modell verlangt wird; `allowDataPreview: false` hält Tabellendaten geschlossen, auch wo die Umgebung sie für andere Destinationen öffnet; `deniedTools` schließt `exportPackageSources`, den einen Lesezugriff, der ganze Pakete auf die Platte kopiert.
- `${env:VAR}` liest ein Geheimnis aus der Umgebung, sodass es nie in der Datei steht; tragen Sie die Variable dort ein, wo der Host den Server startet: `-e ONPREM_PASSWORD=...` bei `claude mcp add` (oder exportieren Sie sie in der Shell, die Claude Code startet), eine Zeile `"ONPREM_PASSWORD": "..."` im `env`-Block von Claude Desktop, das Ihre Shell-Umgebung nicht weiterreicht. Eine Datei mit Klartext-Passwort darf nur für Sie lesbar sein (`chmod 600 ~/.abap-adt-mcp/systems.json` auf macOS und Linux; unter Windows ist Ihr Profilordner bereits privat); eine reine SSO-Datei braucht nichts.
- `tls.ca` benennt ein CA-Zertifikat des Unternehmens. Die Prüfung lässt sich nur je Destination lockern (`insecureTls: true`, beim Start angekündigt), nie für den ganzen Prozess.

Das ist die ganze Einrichtung. Weiter mit [Was Sie das Modell fragen können](#was-sie-das-modell-fragen-können).

## Was Sie das Modell fragen können

Der Server ist ein Werkzeugkasten, aus dem das Modell wählt: fragen Sie in natürlicher Sprache, und es bestimmt die Reihenfolge.

| Frage | Tools, zu denen das Modell greift |
|---|---|
| "Erkläre, was die Methode GET_DATA von ZCL_ORDER_SERVICE tut." | `searchObject`, `getMethodSource` |
| "Wo wird die Tabelle ZTABLE noch verwendet, und von welchen Programmen?" | `whereUsed`, `sourceTextSearch`, `grepPackage` |
| "Zeige mir die Felder und Assoziationen der CDS-View ZI_PRODUCT." | `cdsViewInfo`, `objectStructureElements` |
| "Füge am Anfang von GET_DATA eine Null-Prüfung ein, aktiviere und führe die Unit-Tests aus." | `resolveTransport`, `syntaxCheckCode`, `editObjectSource` (mit `activate=true`), `unitTestRun`, `objectDiff` |
| "Lege die Klasse ZCL_HELLO im Paket ZDEMO an, die Hello World ausgibt, mit einem Unit-Test." | `validateNewObject`, `resolveTransport`, `createObject`, `setObjectSource`, `createTestInclude`, `unitTestRun` |
| "Führe ATC auf dem Paket ZFIN aus und wende jeden sicheren Quickfix an." | `createAtcRun`, `atcWorklists`, `atcQuickfixProposals`, `atcApplyQuickfix`, `atcSummary` |
| "Was hat sich im Transport `DEVK900123` geändert? Prüfe ihn und sage mir, ob er freigegeben werden kann." | `transportDetails`, `transportUnifiedDiff` |
| "Warum ist der letzte Kurzdump des Benutzers DEVELOPER passiert? Schlage eine Korrektur vor." | `dumps`, `dumpDetails`, `getObjectSource` |
| "Ist ZCL_ORDER_SERVICE bereit für ABAP Cloud? Welche SAP-Objekte stehen im Weg?" | `apiReleaseState`, `createAtcRun` |
| "Selektiere die zehn neuesten Zeilen von ZTABLE mit STATUS = 'X'." | `runQuery`, oder `tableContents`, wenn die Datenvorschau eine Tabelle ablehnt |
| "Probiere diesen Schnipsel aus und zeige mir die Ausgabe." | `runSnippet` |
| "Welche Toolsets unterstützt DEV? Ist der Debugger dort verfügbar?" | `systemProfile` |

Was der Server von sich aus tut, damit Sie es nicht ausbuchstabieren müssen:

- Schreib-Tools sperren, schreiben und entsperren selbst; `activate=true` aktiviert im selben Aufruf.
- Jeder Fehler kommt als JSON mit `kind`, `hint` und `nextTools` zurück, sodass sich das Modell erholt, statt blind zu wiederholen; eine abgelaufene Sitzung wird neu authentifiziert und der Aufruf einmal wiederholt.
- Große Ergebnisse werden innerhalb eines Budgets von 40.000 Zeichen seitenweise geliefert und melden `hasMore`; lange Aufrufe senden Fortschrittsmeldungen.
- Tabellen werden nur gelesen, wo die Destination es erlaubt: `tableContents` per Name braucht `allowDataPreview`, `runQuery` braucht `allowFreeSql`.
- Die Anlage- und Änderungsabläufe reisen im MCP-Feld `instructions`, und sechs fertige Abläufe kommen als MCP-Prompts (`create-object`, `safe-edit`, `review-transport`, `fix-atc`, `clean-core-check`, `debug-dump`; in Claude Code `/mcp__abap-adt-mcp__safe-edit DEV ZCL_ORDER_SERVICE "früh zurückkehren, wenn die Eingabetabelle leer ist"`).
- Jedes Tool trägt die Annotationen `readOnlyHint`/`destructiveHint`, damit Hosts, die Genehmigungen daran knüpfen, nur bei Schreibzugriffen fragen.

Die Abläufe Tool für Tool, die Argumentformen und Rezepte stehen in [docs/WORKFLOWS.md](docs/WORKFLOWS.md) (auf Englisch).

## Für Administratoren

Was der Server ist, in den Begriffen, nach denen ein Landschaftsverantwortlicher fragt:

- **Identität.** Jeder Aufruf erreicht SAP als der Benutzer der Destination, mit dessen Berechtigungen; der Server entfernt keine SAP-Prüfung und hat keinen Zugang, den der Benutzer nicht hat. Bei `sso` und `sso2` ist dieser Benutzer die Person an der Tastatur; `basic` und `oauth` tragen gespeicherte Zugangsdaten, bevorzugen Sie also benannte Benutzer, wo Nachvollziehbarkeit zählt. Die Berechtigungen eines reinen Anzeige-Benutzers stehen in [docs/CONFIGURATION.md](docs/CONFIGURATION.md#on-prem-production-read-only-with-a-dedicated-display-user).
- **Prozess.** Ein Prozess je Person, vom MCP-Host gestartet, über stdio; nichts lauscht im Netz, außer Sie starten den optionalen [HTTP-Transport](docs/CONFIGURATION.md#6-http-transport).
- **Netz.** Er spricht mit den konfigurierten SAP-Hosts, mit dem Identity Provider während des Browser-SSO und mit `raw.githubusercontent.com` für SAPs Cloudification-Repository, wenn `apiReleaseState` läuft (24 Stunden zwischengespeichert; `deniedTools: ["apiReleaseState"]` hält das vom Netz fern). Keine Telemetrie, keine Update-Prüfung; `npx` selbst kontaktiert die npm-Registry.
- **Was das Modell sieht.** Das Ergebnis jedes Tool-Aufrufs, den der Benutzer genehmigt (Quelltext, Tabellenzeilen wo geöffnet, Dumps, ATC-Befunde, Fehlertext nach der Schwärzung), geht an den MCP-Host und von dort zu den Datenbedingungen des Hosts an den Modellanbieter (den Anbieter wählt der Host, nicht dieser Server); der Server sendet nichts an eine andere Stelle. `readOnly`, `deniedTables` und `deniedTools` begrenzen diese Menge je Destination.
- **Platte.** `~/.abap-adt-mcp/`: `systems.json` (Ihre), das SSO-Browserprofil je Host (`sso/<host>`, Modus `0700`), der Cloudification-Cache, Paketexporte (`exports/`, nur wo `exportPackageSources` schreiben darf), das HTTP-Token und, wenn aktiviert, das Audit-Protokoll. SAP-Sitzungscookies werden nie auf die Platte geschrieben.
- **Geheimnisse.** `${env:VAR}` funktioniert in jedem String von `systems.json`; eine für andere lesbare Datei wird abgelehnt, wenn sie Klartext-Passwörter enthält. Fehlermeldungen durchlaufen eine Schwärzung (Bearer-Tokens, Cookies, Passwörter, `user:password@host`-URLs); erfolgreiche Tool-Ergebnisse werden nicht geschwärzt, also begrenzen `readOnly`, `deniedTables` und `deniedTools` sie. `reentranceTicket` (ein Anmeldeticket, das das Modell anderswohin tragen könnte) bleibt deaktiviert, außer bei `SAP_ALLOW_REENTRANCE_TICKET=1`.
- **Was die Richtlinie nicht sieht.** ABAP, das das Modell ausführt (`runSnippet`, `runClass`, `unitTestRun`), läuft mit den Berechtigungen des Benutzers; `deniedTables` prüft den Text des Schnipsels, aber dynamisches SQL und alles, was der Code aufruft, werden nicht inspiziert. Wo Codeausführung nicht akzeptabel ist, tragen Sie diese Tools in `deniedTools` ein oder verwenden Sie `readOnly`.
- **Nicht vertrauenswürdige Eingaben.** Kommentare, Tabellenzeilen und Feeds aus SAP können Text enthalten, der das Modell zu steuern versucht. Verwenden Sie einen Host, der vor Tool-Aufrufen fragt, und prüfen Sie die fett gesetzten Tools im [Tool-Katalog](#tool-katalog) (die destruktiven), bevor Sie genehmigen.
- **Audit.** `MCP_AUDIT_FILE=/var/log/abap-adt-mcp/audit.jsonl` hängt je Aufruf eine JSON-Zeile an: Tool, Destination, Ergebnis, Dauer, die ablehnende Richtlinienschranke und die Argumente mit geschwärzten Geheimnissen. Die Datei wird je Workstation vom Prozess des Benutzers selbst geschrieben; zentrale Sammlung und Manipulationsschutz sind Ihre Sache. [docs/CONFIGURATION.md](docs/CONFIGURATION.md#7-audit-log-record-format) beschreibt das Satzformat.
- **SAP API Policy.** SAP nennt die ADT-Services, die dieser Server nutzt, intern, für Entwicklung über die von SAP empfohlenen Kanäle, und dieses Projekt gehört nicht dazu; nicht veröffentlichte Schnittstellen werden auf eigenes Risiko genutzt. Fragen Sie Ihren SAP-Ansprechpartner und beschränken Sie den Server auf Entwicklungs- und Testsysteme. Details unter [SAP API Policy](#sap-api-policy).
- **Widerruf.** Ein verlorener Laptop oder ein geleaktes Geheimnis wird Stück für Stück geschlossen (SSO-Profil, Sitzung beim Identity Provider, OAuth-Geheimnis, SAP-Passwort, lokale Dateien): [SECURITY.md, Decommissioning](SECURITY.md#decommissioning).
- **Releases.** Nur das neueste Release erhält Korrekturen; für einen kontrollierten Rollout legen Sie die Version fest statt des ungepinnten `npx -y abap-adt-mcp` der Einrichtung ([Weitere Installationswege](#weitere-installationswege)). Getestete Modi: `sso`, `sso2` und `basic` On-Premise; `oauth` und `basic` mit Communication User nicht ([Authentifizierung](#authentifizierung)). Schwachstellen: [SECURITY.md, Reporting a vulnerability](SECURITY.md#reporting-a-vulnerability).

### Richtlinienschlüssel

Im Server durchgesetzt, vor jedem SAP-Aufruf, je Destination in `systems.json`:

| Schlüssel | Wirkung |
|---|---|
| `readOnly` | Nur Lese-Tools laufen: jeder Quelltext-Schreibzugriff, `lock`, `runSnippet`, `runClass`, `unitTestRun`, `createAtcRun` und `atcSummary` werden abgelehnt. Tabellenzugriffe (wo geöffnet) und `exportPackageSources` bleiben erlaubt; schließen Sie sie mit den Schlüsseln darunter. |
| `allowDataPreview` | Aus, außer bei `true`: `tableContents` darf die Zeilen einer Tabelle oder CDS-Entität per Name lesen. Ein explizites `false` übersteuert `MCP_ALLOW_DATA_PREVIEW`. |
| `allowFreeSql` | Aus, außer bei `true`: `runQuery` und `tableContents` mit `sqlQuery` (impliziert `allowDataPreview`). |
| `deniedTables` | Muster, die das Modell nicht lesen darf (`["PA*", "HR*", "USR02"]`), angewendet auf Lesezugriffe und auf den ABAP-Text, den es schreibt oder ausführt; SAPs eigene Anzeigeberechtigung bleibt die Untergrenze. |
| `deniedTools` | Rundweg abgelehnte Tools: Namen, Muster (`rapGen*`) oder `toolset:git`. |
| `allowedPackages` | Schreibzugriffe nur in diesen Paketen (`["Z*", "$*"]`); ein nicht auflösbares Paket wird abgelehnt. |
| `allowedTransports` | Schreibzugriffe nur auf diesen Transporten; neue anzulegen wird abgelehnt. |

Ablehnungen kommen als `kind: "policyDenied"` zurück und nennen die Schranke; `listSystems` zeigt jede Richtlinie und das wirksame `dataAccess`. Das Bedrohungsmodell und die Restrisiken stehen in [SECURITY.md](SECURITY.md); die Schranken Tool für Tool, mit Rezepten, in [docs/CONFIGURATION.md](docs/CONFIGURATION.md#3-policy-in-depth); die Einordnung unter SAPs API Policy in [docs/API-POLICY.md](docs/API-POLICY.md). Alle drei Dokumente sind auf Englisch.

## Authentifizierung

Jede Destination wählt ihren eigenen `authType`. Details und die Schritte auf SAP-Seite stehen in [docs/AUTH.md](docs/AUTH.md) (auf Englisch).

| Modus | Wofür | Was Sie konfigurieren | SAP-Seite |
|---|---|---|---|
| `sso` (Standard) | Benannte Benutzer auf S/4HANA Cloud und On-Premise-Systeme, die mit einer Basic-Aufforderung antworten | Nichts: ein Browser öffnet sich einmal je Host; die Sitzung bleibt im Speicher. `SAP_BROWSER_PATH` übersteuert den Browser. | Die Entwickler-Geschäftsrolle, die Ihr Benutzer für Eclipse ADT ohnehin braucht |
| `sso2` | Benannte On-Premise-Benutzer ohne Browser, wenn eine vertrauenswürdige lokale SNC/RFC-Brücke ein kurzlebiges Ticket ausstellen kann | `sso2.command`, `args`, `timeoutMs` | SNC-Zuordnung, Ticket-Annahme und ADT-ICF-Anmeldung, vom Basis-Team eingerichtet |
| `basic` | On-Premise-AS-ABAP-Benutzer, Communication Users auf S/4HANA Cloud | `user` und `password` (als `${env:VAR}`) | Ein Benutzer mit ADT-Berechtigungen |
| `oauth` | Unbeaufsichtigte Clients auf S/4HANA Cloud | `oauth.tokenUrl`, `clientId`, `clientSecret` | Communication User, Communication System mit OAuth 2.0, Communication Arrangement für das ADT-Szenario Ihres Tenants |

- Benannte Geschäftsbenutzer auf S/4HANA Cloud können keine Basic-Authentifizierung verwenden: sie melden sich über `sso` an, oder Sie legen einen Communication User an. `oauth` und `basic` mit Communication User folgen SAPs Dokumentation für technische Benutzer, wurden von diesem Projekt aber nicht gegen einen echten Tenant erprobt; prüfen Sie es auf Ihrem, bevor Sie sich darauf verlassen.
- Bei einer On-Premise-Basic-Aufforderung fragt das Browserfenster nach dem SAP-Passwort; lassen Sie den Browser es speichern, liegt es im eigenen Profil unter `~/.abap-adt-mcp/sso/<host>`.
- Die TLS-Prüfung bleibt für den Prozess an. Je Destination fügt `tls.ca` eine Unternehmens-CA hinzu, `tls.servername` benennt das Zertifikat eines über IP-Adresse erreichten Systems, `tls.cert` + `key` (oder `pfx` + `passphrase`) legen ein Client-Zertifikat vor, und `insecureTls: true` wird beim Start angekündigt. Optionale `gitUser`/`gitPassword` halten abapGit-Zugangsdaten aus der Unterhaltung heraus.

## S/4HANA Cloud versus On-Premise

`systemProfile(destination)` meldet, ob eine Destination Cloud oder On-Premise ist und welche Toolsets dem Backend fehlen; diese Tools werden vor dem SAP-Aufruf abgelehnt. Was [docs/TESTPLAN.md](docs/TESTPLAN.md) auf einem Public-Cloud-Tenant festgehalten hat:

| Thema | S/4HANA Cloud (Public Edition) | On-Premise / Private |
|---|---|---|
| Authentifizierung | Benannte Benutzer: nur Browser-SSO. Unbeaufsichtigt: OAuth2 aus einem Communication Arrangement, oder Basic-Authentifizierung mit einem Communication User. | Basic-Authentifizierung; Client-Zertifikate über `tls`; Browser-SSO auf Systemen mit Basic-Aufforderung; `sso2` ohne Browser über einen lokalen Ticket-Provider. |
| Lokale Objekte | `$TMP` wurde auf dem getesteten Tenant abgelehnt (Berechtigungsobjekt `S_ABPLNGVS`); verwenden Sie ein Kundenpaket mit ABAP for Cloud Development und seinen Transport, `resolveTransport` wählt ihn. `runSnippet` braucht dort `packageName`, `transport` und `responsible`. | `$TMP` verfügbar, kein Transport nötig; `runSnippet` verwendet standardmäßig `$TMP`. |
| Toolsets | RAP-Generator auf dem getesteten Tenant nicht vorhanden; Debugger, Traces und abapGit hängen vom Tenant und den Berechtigungen ab. `dumps`/`dumpDetails` sind der Weg zur Ursache, wenn der Debugger fehlt; `sourceTextSearch` weicht auf `grepPackage` aus, wenn der Tenant keinen Textindex hat. | Vollständiger ADT-Collection-Satz auf einem aktuellen Release. |
| Freigegebene APIs | `apiReleaseState` prüft Namen, eine Objekt-URL oder einen ganzen Quelltext; ATC-Variante `ABAP_CLOUD_DEVELOPMENT_DEFAULT`. `createObject` braucht `responsible`. | Optional. |
| Geschäftsdaten | `runQuery`/`tableContents` respektieren Anzeigeberechtigungen, und die Destination muss sie erlauben. `runSnippet` braucht `S_DEVELOP`, also nur Entwicklungssysteme. | Ebenso. |

Mehr in [docs/CLOUD.md](docs/CLOUD.md) und, aus echten Sitzungen, [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) (beide auf Englisch).

## Weitere Installationswege

- **Version festlegen.** `npx -y abap-adt-mcp` holt bei jedem Start das neueste Release; für einen kontrollierten Rollout legen Sie es fest (`npx -y abap-adt-mcp@X.Y.Z`, oder das Container-Tag `vX.Y.Z`). Releases tragen eine npm-Provenance-Attestierung, prüfbar mit `npm audit signatures`.
- **Claude-Code-Plugin.** Zwei Befehle registrieren den Server und installieren die beiden Agent-Skills (`abap-adt-mcp` lehrt den Entwicklungsablauf, `abap-adt-mcp-setup` führt durch die Installation): `/plugin marketplace add williansaez/abap-adt-mcp`, dann `/plugin install abap-adt-mcp@abap-adt-mcp`. Das Plugin legt das Release fest, mit dem es ausgeliefert wurde, und veröffentlicht jedes Toolset; `systems.json` aus Schritt 1 schreiben weiterhin Sie.
- **Container.** `ghcr.io/williansaez/abap-adt-mcp:latest` (auch `vX.Y.Z`), gebaut aus `node:22-alpine`, läuft als uid 1000. Hängen Sie `systems.json` schreibgeschützt ein und reichen Sie referenzierte Geheimnisse durch; Browser-SSO braucht einen lokalen Browser, betreiben Sie `sso`-Destinationen also aus npm auf der Workstation. [docs/HOSTS.md](docs/HOSTS.md#docker-based-hosts) enthält die `docker run`-Zeile und die Fallstricke bei Dateibesitz.
- **MCP-Registry.** Gelistet als `io.github.williansaez/abap-adt-mcp` für Hosts, die die Registry durchsuchen.
- **Aus dem Quelltext.** `git clone https://github.com/williansaez/abap-adt-mcp.git`, `npm ci`, `npm run build`, dann den Host auf `node /absoluter/pfad/abap-adt-mcp/dist/index.js` richten. Eine `systems.json` neben dem Checkout wird automatisch gelesen.

## Konfiguration

- Quellen, in Reihenfolge des Vorrangs: `SAP_SYSTEMS` (JSON inline), `SAP_SYSTEMS_FILE`, eine `systems.json` neben der Installation, dann die alten Einzelsystem-Variablen (`SAP_URL`, `SAP_CLIENT`, `SAP_USER`, `SAP_PASSWORD`, ...).
- Schlüssel je Destination: `url`, `client`, `language`, `authType`, `default`, `user`/`password`, `sso2`, `oauth`, `insecureTls`, `gitUser`/`gitPassword`, `policy`, `tls`; jeder String darf `${env:VAR}` sein.
- Es gibt kein globales `deniedTools`, `deniedTables` oder `allowedPackages`: diese Schlüssel werden je Eintrag wiederholt.

Die Variablen, die Sie am ehesten setzen:

| Variable | Zweck | Standard |
|---|---|---|
| `SAP_SYSTEMS_FILE` | Pfad zur Destinationsdatei | Empfohlen gegenüber inline `SAP_SYSTEMS` |
| `MCP_TOOLSETS` | `all`, `focused` oder eine kommagetrennte Liste zu veröffentlichender Toolsets | `all` (die Einrichtung oben wählte `focused`) |
| `MCP_READ_ONLY` | `1` macht jede Destination schreibgeschützt | Aus |
| `MCP_ALLOW_DATA_PREVIEW`, `MCP_ALLOW_FREE_SQL` | `1` öffnet Tabellendaten oder SQL auf Destinationen, die den Schlüssel nicht angeben | Aus |
| `MCP_AUDIT_FILE` | JSONL-Audit-Protokoll | Aus |
| `MCP_MAX_RESPONSE_CHARS` | Budget einer Tool-Antwort vor der Seitenaufteilung | 40000 |
| `MCP_HTTP_PORT` | Streamable HTTP auf `127.0.0.1:<port>/mcp` mit Bearer-Token statt stdio | Nicht gesetzt (stdio) |
| `SAP_BROWSER_PATH` | SSO: die zu verwendende Chromium-Binärdatei | Automatisch erkannt |

Jede Variable mit Standardwert und Wirkung, der HTTP-Transport (Token, Sitzungs- und Body-Grenzen, Schutz vor DNS-Rebinding, was eine geteilte Instanz bedeutet) und das Audit-Satzformat stehen in [docs/CONFIGURATION.md](docs/CONFIGURATION.md) (auf Englisch).

## Tool-Katalog

Die Referenz Tool für Tool (Beschreibung, Parameter, Annotationen nur-lesen/destruktiv) ist [docs/TOOLS.md](docs/TOOLS.md), erzeugt aus der echten `tools/list`-Antwort und durch einen Vertragstest in der CI geprüft. Jedes Tool außer `listSystems` und `healthcheck` akzeptiert ein optionales `destination`.

Tool-Schemata kosten Kontext. `MCP_TOOLSETS` nimmt ein Preset (`all`, der Standard, oder `focused` = 114 Entwicklungs-Tools) oder eine kommagetrennte Liste der Toolset-Namen unten; `MCP_DISABLED_TOOLSETS` entfernt einige; `core` wird immer veröffentlicht.

<!-- toolsets:begin -->
Namen in **Fettschrift** tragen `destructiveHint: true` (23 Tools): sie überschreiben, löschen, geben frei oder führen etwas aus, und Hosts, die Genehmigungen an die Annotation knüpfen, fragen vor jedem davon.

**Im Preset `focused` (114 Tools)**

| Toolset | Tools |
|---|---|
| `core` (6)<br>Destinations, health & session | `login`, `logout`, **`dropSession`**, `listSystems`, `healthcheck`, `systemProfile` |
| `source` (16)<br>Source code | `lock`, `unLock`, `listLocks`, **`forceUnlock`**, `getObjectSource`, **`setObjectSource`**, **`editObjectSource`**, `getMethodSource`, **`setMethodSource`**, `prettyPrinterSetting`, `setPrettyPrinterSetting`, `prettyPrinter`, `revisions`, `objectDiff`, `getTextElements`, **`setTextElements`** |
| `objects` (27)<br>Objects & navigation | `objectStructure`, `searchObject`, `findObjectPath`, `objectTypes`, `reentranceTicket`, `classIncludes`, `classComponents`, **`deleteObject`**, `activateObjects`, `activateByName`, `activatePackage`, `inactiveObjects`, `objectRegistrationInfo`, `creatableTypeDetails`, `validateNewObject`, `createObject`, `nodeContents`, `mainPrograms`, `typeHierarchy`, `objectStructureElements`, `objectEnhancements`, `packageTree`, `exportPackageSources`, `whereUsed`, `cdsViewInfo`, `sourceTextSearch`, `grepPackage` |
| `transports` (18)<br>Transports | `transportDetails`, `transportUnifiedDiff`, `transportInfo`, `resolveTransport`, `createTransport`, `hasTransportConfig`, `transportConfigurations`, `getTransportConfiguration`, `setTransportsConfig`, `createTransportsConfig`, `userTransports`, `transportsByConfig`, **`transportDelete`**, **`transportRelease`**, `transportSetOwner`, `transportAddUser`, `systemUsers`, `transportReference` |
| `analysis` (16)<br>Syntax & code analysis | `syntaxCheckCode`, `syntaxCheckCdsUrl`, `codeCompletion`, `findDefinition`, `usageReferences`, `syntaxCheckTypes`, `codeCompletionFull`, **`runClass`**, `codeCompletionElement`, `usageReferenceSnippets`, `fixProposals`, `fixEdits`, `fragmentMappings`, `abapDocumentation`, `apiReleaseState`, **`runSnippet`** |
| `tests` (4)<br>Unit tests | `unitTestRun`, `unitTestEvaluation`, `unitTestOccurrenceMarkers`, `createTestInclude` |
| `atc` (14)<br>ATC | `atcCustomizing`, `atcQuickfixProposals`, **`atcApplyQuickfix`**, `atcCheckVariant`, `atcSummary`, `createAtcRun`, `atcWorklists`, `atcUsers`, `atcExemptProposal`, `atcRequestExemption`, `isProposalMessage`, `atcContactUri`, `atcChangeContact`, `atcDocumentation` |
| `data` (10)<br>Data access & DDIC | `annotationDefinitions`, `ddicElement`, `ddicRepositoryAccess`, `packageSearchHelp`, `getDomainProperties`, **`setDomainProperties`**, `getDataElementProperties`, **`setDataElementProperties`**, `tableContents`, `runQuery` |
| `runtime` (3)<br>Runtime errors | `feeds`, `dumps`, `dumpDetails` |

**Nur mit `MCP_TOOLSETS=all` oder über den Toolset-Namen (59 Tools)**

| Toolset | Tools |
|---|---|
| `discovery` (7)<br>Discovery & metadata | `featureDetails`, `collectionFeatureDetails`, `findCollectionByUrl`, `loadTypes`, `adtDiscovery`, `adtCoreDiscovery`, `adtCompatibilityGraph` |
| `refactoring` (8)<br>Refactoring | `renameEvaluate`, `renamePreview`, **`renameExecute`**, `extractMethodEvaluate`, `extractMethodPreview`, **`extractMethodExecute`**, `changePackagePreview`, **`changePackageExecute`** |
| `rap` (8)<br>RAP generation | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenGetContent`, `rapGenValidateInitial`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` |
| `services` (4)<br>Business services | `publishServiceBinding`, **`unPublishServiceBinding`**, `fetchServiceDetails`, `bindingDetails` |
| `git` (10)<br>abapGit | `gitRepos`, `gitExternalRepoInfo`, `gitCreateRepo`, `gitPullRepo`, **`gitUnlinkRepo`**, `stageRepo`, **`pushRepo`**, `checkRepo`, `remoteRepoInfo`, `switchRepoBranch` |
| `debugger` (13)<br>Debugger | `debuggerListeners`, `debuggerListen`, `debuggerDeleteListener`, `debuggerSetBreakpoints`, `debuggerDeleteBreakpoints`, `debuggerAttach`, `debuggerSaveSettings`, `debuggerStackTrace`, `debuggerVariables`, `debuggerChildVariables`, `debuggerStep`, `debuggerGoToStack`, **`debuggerSetVariableValue`** |
| `traces` (9)<br>Traces | `tracesList`, `tracesListRequests`, `tracesHitList`, `tracesDbAccess`, `tracesStatements`, `tracesSetParameters`, `tracesCreateConfiguration`, **`tracesDeleteConfiguration`**, **`tracesDelete`** |
<!-- toolsets:end -->

Ein Tool kann aus zwei Gründen fehlen: sein Toolset ist nicht veröffentlicht (die Ablehnung nennt das Toolset), oder die Destination kann es nicht bedienen (`systemProfile` meldet, was fehlt).

## Vergleich mit dem offiziellen ADT MCP Server von SAP

SAPs ADT MCP Server wird mit ADT für VS Code und Eclipse ausgeliefert und veröffentlicht unter dem Serverschlüssel `abap-adt` mit eigenen Tool-Namen. Dieses Projekt veröffentlicht unter `abap-adt-mcp`, bedient viele Destinationen aus einem Prozess, setzt Richtlinien serverseitig durch und ergänzt Kompositionen wie `resolveTransport`, `editObjectSource`, `grepPackage`, `apiReleaseState`, `runSnippet` und `objectDiff`. Beide können nebeneinander im selben Host laufen; [docs/ROUTING.md](docs/ROUTING.md) bildet SAPs Namen auf unsere ab.

Namen, wie die SAP-Help-Seite "Model Context Protocol Tools" sie auflistet (September 2026). SAPs Server legt an, aktiviert, testet, prüft und transportiert; er liest und sucht keinen Quelltext, schreibt keinen, sperrt nicht und zeigt keine Dumps: das kommt nur von diesem Server.

| Offizielles SAP-Tool | abap-adt-mcp-Tool(s) |
|---|---|
| `abap_lists_destinations` | `listSystems`, `systemProfile` |
| `abap_creation-get_all_creatable_objects`, `abap_creation-get_object_type_details` | `objectTypes`, `creatableTypeDetails` |
| `abap_creation-run_validation`, `abap_creation-create_object` | `validateNewObject`, `createObject` |
| `abap_activate_objects` | `activateByName`, `activateObjects`, `activatePackage` |
| `abap_run_unit_tests` | `unitTestRun`, `unitTestEvaluation` |
| `abap_transport-create`, `abap_transport-get` | `createTransport`, `resolveTransport`, `transportInfo`, `transportDetails`, `userTransports` |
| `abap_transport-unifiedDifference` | `transportUnifiedDiff` |
| `abap_generators-list_generators`, `abap_generators-get_schema`, `abap_generators-generate_objects` | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate` |
| `abap_business_services-fetch_services`, `abap_business_services-fetch_service_information` | `fetchServiceDetails`, `bindingDetails` |
| `abap_atc_run`, `abap_atc_get_result` | `createAtcRun`, `atcWorklists`, `atcSummary` |
| `abap_atc_execute_deterministic_quickfixes` | `atcQuickfixProposals`, `atcApplyQuickfix` |
| `abap_atc_apply_ai_fix`, `abap_atc_get_ai_fix_result` (Joule-Lizenz) | Kein Gegenstück: das Modell liest den Befund (`atcDocumentation`) und bearbeitet den Quelltext selbst (`editObjectSource`) |
| Nicht in SAPs Server: Quelltext lesen und suchen, Quelltext schreiben, Sperren, Dumps, Daten, Verwendungsnachweis, Debugger, abapGit, Clean-Core-Prüfung | `getObjectSource`, `searchObject`, `sourceTextSearch`, `grepPackage`, `setObjectSource`, `editObjectSource`, `lock`, `dumps`, `runQuery`, `whereUsed`, die Toolsets Debugger und abapGit, `apiReleaseState` |

## SAP API Policy

- **Was SAP sagt.** Die ADT-REST-Services, die dieser Server aufruft (`/sap/bc/adt`), sind dieselben, die Eclipse ADT nutzt; SAP führt sie nicht im SAP Business Accelerator Hub. Die SAP API Policy (April 2026) schränkt nicht veröffentlichte Schnittstellen ein und die Nutzung von APIs durch KI-Agenten außerhalb der Architekturen, die SAP empfiehlt. Die FAQ von SAP zur Policy nennt die ADT-APIs intern, für Entwicklung nur über empfohlene Kanäle, und ein MCP-Server eines Drittanbieters gehört nicht zu den Kanälen, die sie aufzählt; dieselbe FAQ erlaubt MCP-Server von Drittanbietern grundsätzlich und sagt, dass nicht veröffentlichte Schnittstellen auf eigenes Risiko genutzt werden.
- **Was das für Sie heißt.** Ob SAP Ihre Nutzung akzeptiert, ist eine Frage an Ihren SAP-Ansprechpartner, nicht an dieses Projekt.
- **Was zu tun ist.** Stellen Sie diese Frage, und beschränken Sie den Server auf Entwicklungsarbeit in Entwicklungs- und Testsystemen.

Was der Server auf seiner Seite tut: er läuft als der angemeldete SAP-Benutzer und entfernt keine Berechtigungsprüfung von SAP, er liest keine Tabellendaten, bis eine Destination es erlaubt, er führt die Aufrufe an eine Destination nacheinander aus, und `apiReleaseState` kennzeichnet jedes geprüfte SAP-Objekt als `released`, `classic`, `notReleased` oder `prohibited`. [docs/API-POLICY.md](docs/API-POLICY.md) (auf Englisch) enthält die Policy Abschnitt für Abschnitt, die Fragen an SAP und eine vorsichtige Konfiguration.

## Fehlerbehebung

- **Der Server erscheint nie im Host.** Lesen Sie das MCP-Protokoll des Hosts: Claude Desktop schreibt `mcp.log` und `mcp-server-abap-adt-mcp.log` nach `~/Library/Logs/Claude` auf macOS und `%APPDATA%\Claude\logs` unter Windows; Claude Code zeigt den Zustand mit `/mcp`. Claude Desktop liest die Konfiguration nur beim Start: beenden und neu öffnen nach jeder Änderung.
  - `spawn npx ENOENT`: Node.js ist nicht installiert, oder nicht im PATH, den die App sieht. Installieren Sie es, oder tragen Sie den absoluten Pfad zu `npx` in `command` ein (`C:/Program Files/nodejs/npx.cmd` unter Windows, `/usr/local/bin/npx` oder `/opt/homebrew/bin/npx` auf macOS).
  - `EBADENGINE`: das vom Host gefundene Node ist älter als 22.12.
  - `No ABAP systems configured`: `SAP_SYSTEMS_FILE` zeigt auf eine fehlende Datei (unter Windows nach `systems.json.txt` suchen).
  - `is not valid JSON`: ein verirrtes Komma, oder ein Windows-Pfad mit einfachen Backslashes.
- **Kein Browserfenster, oder SSO scheitert.** Ein Chromium-Browser muss installiert sein; `SAP_BROWSER_PATH` zeigt darauf, wenn die automatische Erkennung scheitert. Um sich von einem Tenant vollständig abzumelden, löschen Sie den Ordner `sso/<host>` unter `.abap-adt-mcp` in Ihrem Benutzerordner (`C:\Users\<sie>` unter Windows). Auf einer Maschine ohne Bildschirm (ein CI-Runner, ein Container) lehnt die Anmeldung sofort ab und nennt stattdessen `oauth` oder `sso2`.
- **Die Anmeldung funktioniert, danach ist alles "not authorized" oder "not found".** Die SSO-Sitzung ist auf einem anderen Mandanten gelandet, als `client` sagt: setzen Sie `client` auf den Anmeldemandanten des Tenants.
- **`kind: "sessionExpired"` kommt immer wieder.** Der Server hat bereits einmal neu authentifiziert und wiederholt; bitten Sie das Modell, `login` für diese Destination aufzurufen. Sperr-Handles der alten Sitzung sind ungültig: erneut sperren.
- **`kind: "locked"` durch eine andere Sitzung.** `listLocks` zeigt die eigenen Sperren des Servers; steht das Objekt nicht dort, gehört die Sperre einer anderen Sitzung (Eclipse oder ein anderer Benutzer), und nur diese Sitzung oder `SM12` löst sie.
- **`kind: "policyDenied"`.** Die `policy` der Destination verbietet den Aufruf, und die Meldung nennt die Schranke: die Leitplanke funktioniert. `tableContents` und `runQuery` werden auf jeder Destination abgelehnt, die sie nicht geöffnet hat, auch auf einer ohne `policy`; die Meldung nennt den zu setzenden Schlüssel.
- **Tool als nicht verfügbar oder nicht aktiviert abgelehnt.** "Not available on destination": dem Tenant fehlt diese ADT-Collection (`systemProfile` zeigt es). "Belongs to toolset ... which is not enabled": fügen Sie das Toolset zu `MCP_TOOLSETS` hinzu oder verwenden Sie `MCP_TOOLSETS=all`.
- **Zertifikatsfehler On-Premise (`kind: "tlsCertificate"`).** Der Hinweis nennt die Destination und die Lösung: `tls.ca` bei unbekanntem Aussteller (der Hinweis enthält die `openssl`-Zeile), `tls.servername` bei Namensabweichung, Erneuerung in `STRUST` bei abgelaufenem Zertifikat.
- **`editObjectSource` meldet 0 Treffer, oder mehrere.** Nichts wurde geschrieben. Der Anker muss der exakte aktuelle Text auf SAP sein, Einrückung eingeschlossen; bei mehreren Treffern nehmen Sie mehr umgebende Zeilen hinzu.
- **`runQuery` scheitert an einer Tabelle, die der Benutzer anzeigen kann.** Die Datenvorschau lehnt Tabellen mit eingeschränktem `dataMaintenance` ab; verwenden Sie `tableContents`.

Weitere Fälle, mit den genauen Meldungen, in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) (auf Englisch).

## Tests und Mitarbeit

```bash
git clone https://github.com/williansaez/abap-adt-mcp.git
cd abap-adt-mcp
npm ci
npm run build
npm test
```

- Die Jest-Suiten decken Handler, Fehlerhinweise, Antwortgrößen, Toolsets und den Katalogvertrag ab; die CI führt sie auf Node 22 und 24 aus und baut das Container-Image.
- Nach einer Änderung an einem Tool führen Sie `npm run tools:docs` aus und committen die neu erzeugten `docs/TOOLS.md`, den Snapshot und den README-Katalog (die übersetzten READMEs eingeschlossen).
- `npm run docs:check` ist die Dokumentationsschranke: keine Kundenkennungen, keine Geviertstriche, keine toten Links, jede Umgebungsvariable in `server.json` deklariert.
- Releases sind tag-gesteuert: npm per Trusted Publishing mit Provenance, das GHCR-Image und der Eintrag in der MCP-Registry.
- Forken, Branch anlegen, Pull Request öffnen; [CONTRIBUTING.md](CONTRIBUTING.md) enthält die Details. Sitzungsberichte für [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) sind willkommen, ohne Kundennamen, Tenants oder Transportnummern.

Das englische README ist die Referenz für die [portugiesische](README.pt-BR.md) und die [deutsche](README.de.md) Fassung. Die Roadmap steht in [docs/ROADMAP.md](docs/ROADMAP.md) und jedes Release in [CHANGELOG.md](CHANGELOG.md).

## Danksagung

Dieser Server wächst mit den Menschen, die ihn gegen echte Landschaften betreiben und zurückmelden, was sie gefunden haben.

- [João Gementi](https://github.com/JoaoVTGementi) hat den Modus `sso2` ohne Browser beigetragen (ein benannter On-Premise-Benutzer, der sich bereits über SNC authentifiziert, verbindet ohne Browser und ohne gespeichertes Passwort) und den Cookie-Client gehärtet, der nun jede Anfrage ablehnt, die die SAP-Sitzung aus ihrem konfigurierten Origin heraustragen würde.
- [Alexandre Leite](https://github.com/Dregus) hat das Secure-Login-Client-Szenario gemeldet, das den Meilenstein 2.1.0 eröffnet hat, und die On-Premise-Authentifizierungswege getestet.
- Der ursprüngliche Server `mcp-abap-abap-adt-api` von [mario-andreschak](https://github.com/mario-andreschak) ist der Ausgangspunkt dieses Projekts.

Etwas gefunden, etwas behoben oder einen Modus auf einer Landschaft ausprobiert, die hier niemand hat? Öffnen Sie ein Issue oder einen Pull Request.

## Lizenz

[MIT](LICENSE). Aufgebaut auf [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) von Marcello Urbani. Wenn das Projekt Ihnen Zeit spart, können Sie [den Autor unterstützen](https://github.com/sponsors/williansaez).
