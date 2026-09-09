# abap-adt-mcp

**Lassen Sie Claude ABAP-Code auf Ihren SAP-Systemen lesen, schreiben, testen und prüfen.**

[![npm version](https://img.shields.io/npm/v/abap-adt-mcp)](https://www.npmjs.com/package/abap-adt-mcp)
[![CI](https://github.com/williansaez/abap-adt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/williansaez/abap-adt-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/node/v/abap-adt-mcp)](https://nodejs.org)
[![MCP Registry](https://img.shields.io/badge/MCP%20registry-io.github.williansaez%2Fabap--adt--mcp-informational)](https://registry.modelcontextprotocol.io/?search=abap-adt-mcp)

[English](README.md) · [Português (Brasil)](README.pt-BR.md) · Deutsch

abap-adt-mcp ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server. Starten Sie ihn neben Claude Desktop, Claude Code oder einem anderen MCP-Host, richten Sie ihn auf ein oder mehrere SAP-Systeme, und das Modell erhält dieselben ADT-REST-Endpunkte, die Eclipse verwendet: Objekte suchen, Quelltext lesen und ändern, Transportaufträge anlegen, aktivieren, ABAP Unit und ATC ausführen, Kurzdumps lesen, Tabellen abfragen. Ein einziger Server stellt **173 Tools** bereit, über so viele SAP-Systeme, wie Sie konfigurieren, S/4HANA Cloud wie On-Premise.

> Setzen Sie ihn mit Bedacht ein und bevorzugen Sie Entwicklungssysteme. Eine Destination ohne `policy`-Block ist im Rahmen Ihrer SAP-Berechtigungen voll beschreibbar. Die Leitplanken je Destination (nur lesen, erlaubte Pakete, gesperrte Tabellen) setzt der Server selbst durch, unabhängig davon, was der Host genehmigt, sodass ein unbedachter Prompt nicht das falsche System erreicht.

## Inhalt

- [Was ist neu in 2.0.0](#was-ist-neu-in-200)
- [Einrichtung](#einrichtung)
- [Was Sie das Modell fragen können](#was-sie-das-modell-fragen-können)
- [Arbeitsabläufe im Detail](#arbeitsabläufe-im-detail)
- [Eingebaute Prompts](#eingebaute-prompts)
- [Weitere Installationswege](#weitere-installationswege)
- [Authentifizierung](#authentifizierung)
- [Sicher bleiben](#sicher-bleiben)
- [Audit-Protokoll](#audit-protokoll)
- [S/4HANA Cloud versus On-Premise](#s4hana-cloud-versus-on-premise)
- [Konfigurationsreferenz](#konfigurationsreferenz)
- [HTTP-Transport (optional)](#http-transport-optional)
- [Tool-Katalog (alle 173 Tools, nach Toolset)](#tool-katalog-alle-173-tools-nach-toolset)
- [Vergleich mit dem offiziellen ADT MCP Server von SAP](#vergleich-mit-dem-offiziellen-adt-mcp-server-von-sap)
- [Skills und Plugin](#skills-und-plugin)
- [Fehlerbehebung](#fehlerbehebung)
- [Tests und Mitarbeit](#tests-und-mitarbeit)
- [Lizenz](#lizenz)

## Was ist neu in 2.0.0

Veröffentlicht am 2026-09-08. Die vollständige Liste steht im [CHANGELOG.md](CHANGELOG.md#200---2026-09-08---node-22-floor-puppeteer-core-25-dependabot-cooldown-tls-by-name); das Wesentliche für die Aktualisierung:

- **Node.js 22.12 oder neuer ist Pflicht** (inkompatible Änderung). Node 18 und 20 haben das Ende ihrer Wartung erreicht und erhalten keine Sicherheitskorrekturen mehr; ein Server, der SAP-Zugangsdaten hält, sollte nicht darauf laufen. Auf einem älteren Node gibt `npm` `EBADENGINE` aus und der Server ist dort ungetestet; installieren Sie das aktuelle LTS und starten Sie den Host neu. Das Container-Image lief bereits auf `node:22-alpine`.
- **`tls.servername` je Destination.** Für ein System, das über IP-Adresse oder Kurznamen erreicht wird und dessen Zertifikat den vollqualifizierten Namen trägt: der Name wird geprüft und als SNI gesendet, die Prüfung bleibt eingeschaltet, und `insecureTls` ist nicht mehr der einzige Weg durch eine solche Landschaft. `listSystems` zeigt `servername NAME`.
- **Zertifikatsfehler erklären die Lösung.** Ein fehlgeschlagener Handshake erreicht das Modell als `kind: "tlsCertificate"` mit einem Hinweis, der die Destination nennt: bei unbekanntem Aussteller die `openssl s_client`-Zeile für diesen Host und den Verweis auf `tls.ca`, bei Namensabweichung die von Node gemeldeten Namen und den Verweis auf `tls.servername`, bei abgelaufenem Zertifikat den Hinweis, dass nur eine Erneuerung hilft. `insecureTls` wird zuletzt genannt.
- **`insecureTls` bleibt**, je Destination, standardmäßig aus, beim Start angekündigt; [SECURITY.md](SECURITY.md#tls) hält die Begründung fest.
- **Lieferkette.** `puppeteer-core` 25 entfernt die letzte offene Dependabot-Meldung aus dem Abhängigkeitsbaum (`npm audit` meldet null Schwachstellen); Dependabot wartet jetzt eine Karenzzeit ab, bevor es Aktualisierungen vorschlägt, und bündelt Sicherheitsupdates in einem Pull Request; `dotenv` wird still geladen, damit stdout ein sauberer JSON-RPC-Kanal bleibt.

Die Aktualisierung von 1.x erfordert keine Konfigurationsänderung: `systems.json`, die Richtlinien, die Tool-Namen und die Umgebungsvariablen sind unverändert.

## Einrichtung

Drei Dinge, bevor Sie beginnen:

- **Node.js 22.12 oder neuer** (22 oder 24 LTS; 2.0.0 hat Node 18 und 20 aufgegeben). Laden Sie den LTS-Installer von [nodejs.org](https://nodejs.org); er bringt `npm` und `npx` mit, mehr braucht der Host nicht. Zum Prüfen ist kein Terminal nötig: fehlt Node, meldet das Host-Protokoll `spawn npx ENOENT`, wenn es den Server zu starten versucht (siehe [Schritt 2](#2-registrieren-sie-den-server-in-ihrem-host)).
- **Zugang zum SAP-System.** Auf S/4HANA Cloud (Public Edition) ist für benannte Benutzer SAP-seitig nichts zu konfigurieren: Ihr Benutzer braucht die Business Role, die Eclipse ADT auf dem Tenant erlaubt (`SAP_BR_DEVELOPER` in der Standardauslieferung); wenn Eclipse ADT bei Ihnen funktioniert, funktioniert auch dieser Server. On-Premise muss der Dienst `/sap/bc/adt` in Transaktion `SICF` aktiv sein (eine Basis-Aufgabe) und Ihr Benutzer braucht die üblichen ADT-Entwicklungsberechtigungen. Nur unbeaufsichtigte `oauth`-Clients brauchen ein Communication Arrangement, siehe [Authentifizierung](#authentifizierung).
- **Ein Chromium-Browser** (Chrome, Edge oder Brave) auf dem Rechner, wenn Sie Browser-SSO verwenden.

### 1. Beschreiben Sie Ihre SAP-Systeme

Legen Sie in Ihrem Benutzerverzeichnis einen Ordner `.abap-adt-mcp` an und darin eine Datei `systems.json`, ein Eintrag je System (eine "Destination"). Ohne Terminal: unter macOS den Finder öffnen, Shift-Cmd-G drücken, `~` eingeben, den Ordner anlegen (der Finder fragt bei einem Namen mit führendem Punkt nach; Shift-Cmd-. blendet versteckte Ordner ein), dann die Datei aus einem beliebigen Texteditor dort speichern. Unter Windows heißt der Ordner `C:\Users\<Sie>\.abap-adt-mcp` und wird im Explorer wie jeder andere angelegt. Ein S/4HANA-Cloud-Tenant mit Browser-SSO braucht genau dies:

```json
{
  "DEV": {
    "url": "https://myXXXXXX.s4hana.cloud.sap",
    "client": "080",
    "authType": "sso",
    "default": true
  }
}
```

`url` ist Pflicht; `client` ist der Mandant, auf dem Ihre SSO-Sitzung landet (auf den getesteten Tenants meldete sich das Entwicklungssystem auf `080` an, Customizing- und Testsysteme auf `100`; der Eintrag "Über" im Benutzermenü des Launchpads zeigt ihn); `authType` ist standardmäßig `sso`, und `"default": true` erlaubt, den Destinationsnamen in jedem Aufruf wegzulassen. Der Schlüssel (`DEV`) ist Ihre Wahl und der Name, den Sie in Gesprächen verwenden. Mehrere Systeme mit Leitplanken sehen so aus (oder kopieren Sie [systems.example.json](systems.example.json)):

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
    "policy": { "readOnly": true, "deniedTables": ["PA*", "HR*", "USR02"], "allowFreeSql": false }
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

Das Muster für jedes Produktiv- oder Testsystem ist der Eintrag `PRD`: fügen Sie `"policy": { "readOnly": true }` hinzu, und der Server lehnt dort jeden Schreibzugriff ab, was auch immer das Modell gefragt wird. `sso` öffnet einmal einen echten Browser für benannte Benutzer auf S/4HANA Cloud; `basic` ist für On-Premise-Benutzer und Communication Users; `oauth` ist für unbeaufsichtigte Clients. `${env:VAR}` holt ein Geheimnis aus der Umgebung, damit es nie in der Datei steht, `policy` wird vom Server durchgesetzt, und `tls.ca` ergänzt eine Unternehmens-CA bei eingeschalteter Prüfung (`tls.servername` benennt das Zertifikat, wenn das System über eine IP-Adresse erreicht wird). `$*` (lokale Pakete) steht nur im On-Premise-Eintrag, weil der getestete Public-Cloud-Tenant `$TMP` ablehnt.

Wenn Sie ein Terminal haben, beschränken Sie die Datei auf Ihren Benutzer:

```bash
chmod 600 ~/.abap-adt-mcp/systems.json
```

Diesen Schritt können Sie auslassen, wenn die Datei keine Passwörter im Klartext enthält (eine reine SSO-Datei oder Geheimnisse als `${env:VAR}`): der Server gibt dann nur eine Warnung aus, wenn die Datei für andere lesbar ist. Er verweigert den Start nur, wenn eine für andere lesbare Datei Passwörter, Client Secrets oder Git-Passwörter im Klartext enthält. Windows kennt keine Dateimodi; die Prüfung entfällt dort.

### 2. Registrieren Sie den Server in Ihrem Host

Das Paket liegt auf npm als [`abap-adt-mcp`](https://www.npmjs.com/package/abap-adt-mcp) (veröffentlicht per Trusted Publishing mit Provenance), `npx` genügt also.

**Claude Code**, eine Zeile:

```bash
claude mcp add abap-adt-mcp -e SAP_SYSTEMS_FILE=$HOME/.abap-adt-mcp/systems.json -- npx -y abap-adt-mcp
```

**Claude Desktop** (Settings > Developer > Edit Config, danach die App beenden und neu öffnen). Ersetzen Sie `me` durch Ihren Benutzernamen; unter Windows schreiben Sie den Pfad als `C:/Users/<Sie>/.abap-adt-mcp/systems.json`:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "command": "npx",
      "args": ["-y", "abap-adt-mcp"],
      "env": { "SAP_SYSTEMS_FILE": "/Users/me/.abap-adt-mcp/systems.json", "MCP_TOOLSETS": "focused" }
    }
  }
}
```

`MCP_TOOLSETS=focused` veröffentlicht die 114 Entwicklungs-Tools statt aller 173, damit die Tool-Schemata nicht das Kontextfenster des Chats auffressen; lassen Sie es weg, wenn Sie die Toolsets Debugger, Traces, abapGit, RAP oder Refactoring brauchen. Dasselbe JSON funktioniert in Cursor, Cline und anderen Hosts, die eine `mcpServers`-Map lesen; VS Code nennt die Map `servers`, dort benennen Sie den obersten Schlüssel um ([docs/HOSTS.md](docs/HOSTS.md) zeigt die Form je Host). Der Schlüssel `abap-adt-mcp` ist der Name, den der Host für den Server anzeigt, und das Präfix jedes Tools (`mcp__abap-adt-mcp__searchObject` in Claude Code); öffentliche ABAP-Skills, die für diesen Server geschrieben wurden, suchen nach diesem Namen, ein anderer Schlüssel verhindert also nur, dass diese Skills den Server erkennen, sonst geht nichts kaputt.

Nach dem Neustart führt Claude Desktop `abap-adt-mcp` mit einem Status unter Settings > Developer auf, und das Tool-Menü unter der Chat-Eingabe (das Schieberegler-Symbol) zeigt den Server mit seinen Tools. Erscheint nichts, lesen Sie das Protokoll des Hosts: zum Zeitpunkt dieses Textes schreibt Claude Desktop `mcp.log` und `mcp-server-abap-adt-mcp.log` nach `~/Library/Logs/Claude` unter macOS und `%APPDATA%\Claude\logs` unter Windows, und Claude Code zeigt den Zustand mit `/mcp`. Alles, was der Server ausgibt (Startwarnungen, die Warnung zur Audit-Datei, Meldungen von `MCP_PROFILE_GATE=warn`), geht nach stderr und landet in diesem Protokoll. Claude Desktop wie Claude Code fragen, bevor sie ein Tool ausführen, das Sie nicht dauerhaft genehmigt haben; dieser Dialog ist Verhalten des Hosts und unabhängig von der Annotation `destructiveHint`, betrachten Sie ihn also als Höflichkeit und den `policy`-Block als Garantie.

### 3. Sagen Sie Hallo

Öffnen Sie einen neuen Chat und tippen Sie (ersetzen Sie `DEV` durch den Schlüssel, den Sie in `systems.json` gewählt haben):

> Liste meine SAP-Systeme auf, melde dich an DEV an und zeige mir den Quelltext der Klasse CL_ABAP_CHAR_UTILITIES.

Das Modell ruft `listSystems`, `login` (bei SSO-Destinationen erscheint ein Browserfenster; setzen Sie das Häkchen bei "angemeldet bleiben", dann laufen spätere Anmeldungen still), `searchObject` und `getObjectSource` auf. Wenn der Quelltext zurückkommt, sind Sie fertig. `login` ist in jedem Modus optional: der Dispatcher führt die Browser-Anmeldung vor dem ersten Aufruf auf einer SSO-Destination aus, und `basic`- wie `oauth`-Destinationen authentifizieren sich bei ihrer ersten Anfrage. Rufen Sie es nur explizit auf, um eine neue Anmeldung zu erzwingen oder die Zugangsdaten vorab zu prüfen. `healthcheck` liefert Serverversion, Destinationsnamen, Standarddestination, aktive Toolsets und die Anzahl der Tools; `systemProfile` sagt, ob eine Destination S/4HANA Cloud oder On-Premise ist und welche Toolsets sie nicht bedienen kann.

## Was Sie das Modell fragen können

Der Server ist ein Werkzeugkasten, aus dem das Modell wählt: fragen Sie in natürlicher Sprache, und es bestimmt die Reihenfolge. Was von der ersten Sitzung an gut funktioniert:

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
| "Selektiere die zehn neuesten Zeilen von ZTABLE mit STATUS = 'X'." | `runQuery` (oder `tableContents`, wenn die Datenvorschau eine Tabelle ablehnt) |
| "Probiere diesen Schnipsel aus und zeige mir die Ausgabe." | `runSnippet` |
| "Welche Toolsets unterstützt DEV? Ist der Debugger dort verfügbar?" | `systemProfile` |

Auf einem gewöhnlichen On-Premise-System funktioniert das Anlage-Beispiel auch mit `$TMP` und ohne Transport; der getestete S/4HANA-Cloud-Tenant lehnte `$TMP` ab, dort nennen Sie ein Kundenpaket und seinen Transport (siehe [S/4HANA Cloud versus On-Premise](#s4hana-cloud-versus-on-premise)).

Gewohnheiten, die der Server mitbringt, damit Sie sie nicht ausbuchstabieren müssen: Schreib-Tools sperren und entsperren selbst; `activate=true` aktiviert im selben Aufruf; jeder Fehler ist JSON mit `kind`, `hint` und `nextTools`, sodass sich das Modell erholt, statt blind zu wiederholen; abgelaufene Sitzungen werden neu authentifiziert und der Aufruf einmal wiederholt; große Ergebnisse werden innerhalb eines Budgets von 40.000 Zeichen (`MCP_MAX_RESPONSE_CHARS`) seitenweise geliefert und melden `hasMore`; lange Aufrufe senden MCP-Fortschrittsmeldungen an Hosts, die ein `progressToken` übergeben (plus ein Herzschlag alle 10 Sekunden). Die kanonischen Anlage- und Änderungsabläufe reisen im MCP-Feld `instructions`, und jedes Tool trägt die Annotationen `readOnlyHint`/`destructiveHint`, damit Hosts, die Genehmigungen daran knüpfen, nur bei Schreibzugriffen fragen.

## Arbeitsabläufe im Detail

Die vollständigen Sequenzen Tool für Tool, Argumentformen und Rezepte stehen in [docs/WORKFLOWS.md](docs/WORKFLOWS.md); dieser Abschnitt ist die Kurzfassung.

Jedes Tool außer `listSystems` und `healthcheck` nimmt ein optionales `destination`; es ist Pflicht, wenn mehrere Systeme konfiguriert sind und keines als `default` markiert ist (oder in `SAP_DEFAULT_DESTINATION` genannt wird).

**URLs und Namen.** `searchObject` liefert die Objekt-URL, zum Beispiel `/sap/bc/adt/oo/classes/zcl_example`; die Quelltext-URL ist dieselbe plus `/source/main`; Klassen-Includes (Implementierungen, Testklassen) verwenden die URLs aus `classIncludes` unverändert. Die aus mehreren Vorgängergenerationen geerbten Tools nennen diese URL unterschiedlich (`objSourceUrl`, `objectSourceUrl`, `objectUrl`, `classUrl`, `url`, `mainUrl`), daher bildet der Dispatcher die Namen auf das Schema jedes Tools ab und entfernt oder ergänzt `/source/main` nach Bedarf: der Wert aus `searchObject` kann an jedes von ihnen übergeben werden. Tools auf Klassenebene (`getMethodSource`, `setMethodSource`, `whereUsed`, `cdsViewInfo`) akzeptieren auch den bloßen Namen.

**Code finden und lesen.** `searchObject` findet Objekte nach Namen. Nach Inhalt nutzt `sourceTextSearch` den ADT-Textindex, und `grepPackage` durchsucht Paketquellen clientseitig mit Kontextzeilen (der Ausweg, wenn ein Tenant keinen Textindex hat). `packageTree`, `whereUsed`, `cdsViewInfo`, `typeHierarchy` und `classComponents` bieten Navigation wie in einer IDE. `getObjectSource` liest einen Quelltext (seitenweise mit `startLine`/`maxLines`, `version=inactive` für nicht aktivierten Code), `getMethodSource` eine Methode, und `exportPackageSources` schreibt einen Paketbaum im abapGit-Layout auf die Platte für lokale Werkzeuge.

**Sicher ändern.** Schreibzugriffe sperren, schreiben und entsperren selbst und aktivieren, wenn Sie `activate=true` übergeben:

1. `resolveTransport(objSourceUrl)` liefert den Transport, der das Objekt bereits enthält, den neuesten änderbaren für sein Paket, oder `needsTransport: false` für lokale Pakete; `createIfMissing=true` legt einen an, wenn keiner existiert.
2. `syntaxCheckCode` auf dem geplanten Quelltext: optional bei einer Einzeiler-Änderung, günstige Absicherung bei allem Größeren.
3. `editObjectSource(objectSourceUrl, replacements=[{oldText, newText}], activate=true, transport)` für gezielte Änderungen (der Server liest SAP zuerst neu; jeder `oldText` muss genau einmal passen, sonst scheitert der Aufruf mit "0 matches" oder den Zeilennummern jedes Treffers, und nichts wird geschrieben), `setMethodSource(classUrl, methodName, source, activate=true, transport)`, um einen `METHOD ... ENDMETHOD`-Block in der Implementierung auszutauschen (übergeben Sie den ganzen Block oder nur den Rumpf; der Definitionsteil bleibt, wie er ist; `include` und `className` wählen lokale oder Testklassen; eine unbekannte Methode wird mit der Liste der vorhandenen Methoden abgelehnt), `setObjectSource` für vollständige Neufassungen.
4. Lesen Sie das Feld `activation` des Ergebnisses; korrigieren und erneut schreiben, oder später `activateByName` / `activatePackage`.
5. `unitTestRun(url)`, dann `objectDiff(objectUrl)`, um zu zeigen, was sich gegenüber der vorherigen Revision geändert hat.

`lock`/`unLock` halten eine Sperre nur über mehrere Schreibzugriffe hinweg; `listLocks` und `forceUnlock` retten nach einem gescheiterten Schreibzugriff. Eine Sperre einer anderen Sitzung (etwa ein offenes Eclipse-Fenster) wird als fremd gemeldet: `dropSession` und `forceUnlock` können sie nicht lösen, nur diese Sitzung oder `SM12`.

**Objekte und Transporte anlegen.** `loadTypes` (wählen Sie den `objtype`, zum Beispiel `CLAS/OC`), `validateNewObject`, dann `resolveTransport(objSourceUrl="/sap/bc/adt/packages/<pkg>", devClass="<pkg>")` für das Paket selbst, da das Objekt noch keine URL hat (oder `createTransport`), dann `createObject(objtype, name, parentName=<pkg>, description, parentPath="/sap/bc/adt/packages/<pkg>", responsible, transport)`, `setObjectSource` mit `activate=true`, `createTestInclude`, `unitTestRun`. `creatableTypeDetails` sagt, welche Felder jeder Typ verlangt; Pakete (`DEVC/K`) brauchen `swcomp`, und Cloud-Backends brauchen `responsible`.

**Unit-Tests und ATC.** `unitTestRun` nach jeder Änderung (seitenweise mit `startIndex`/`maxItems`); `unitTestEvaluation` vertieft die Ergebnisse. ATC: `createAtcRun(mainUrl, variant)` auf einem Objekt, Paket oder Transport (ein Variantenname wie `ABAP_CLOUD_DEVELOPMENT_DEFAULT` wird für Sie in eine Worklist aufgelöst), dann `atcWorklists` oder `atcSummary` (Summen nach Priorität, Prüfung und Objekt), `atcQuickfixProposals` und `atcApplyQuickfix` für deterministische Korrekturen, `atcDocumentation` für unbekannte Prüfungen; Ausnahmen laufen über `atcExemptProposal` und `atcRequestExemption`.

**Einen Transport prüfen.** `transportDetails` listet Objekte, Eigentümer, Aufgaben und Status; `transportUnifiedDiff` vergleicht jedes im Transport erfasste Quelltextobjekt mit der Version davor, einschließlich `LIMU`-Klassen-Includes und -Methoden, `REPS`-Includes und `FUNC`-Bausteinen (Nachrichten und DDIC werden mit Begründung übersprungen). Verglichen wird mit dem aktuellen Quelltext, sodass bei einem bereits freigegebenen Transport auch spätere Änderungen an denselben Objekten auftauchen. Es läuft auf S/4HANA-Cloud-Tenants (die `LIMU`-Abdeckung stammt aus einer RAP-Sitzung dort, siehe [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md)). `objectDiff` deckt Objekte mit mehreren Revisionen ab. `userTransports`, `transportRelease`, `transportSetOwner` und `transportAddUser` vervollständigen das Bild.

**Daten.** `runQuery(sqlQuery)` führt ein ABAP-SQL-`SELECT` über die ADT-Datenvorschau auf Tabellen und CDS-Views aus (nach Entitätsname, freigegebene API-Views eingeschlossen), zum Beispiel `SELECT carrid, connid, fldate FROM sflight WHERE carrid = 'LH' ORDER BY fldate DESCENDING`. `rowNumber` begrenzt, wie viele Zeilen SAP liefert (Standard 100), und `startRow`/`maxRows` blättern durch das Ergebnis. Anweisungen werden vor dem Senden auf die 255-Zeichen-Zeilengrenze der Vorschau umgebrochen (ein einzelnes längeres Literal scheitert weiterhin). Tabellen, deren DDIC-`dataMaintenance` eingeschränkt ist, lehnt die Vorschau ab: `tableContents(ddicEntityName)` liest sie (S_TABU_DIS/S_TABU_NAM gelten weiterhin). Schlüssel kommen im internen Format zurück, daher informieren `getDataElementProperties` und `getDomainProperties` über führende Nullen und Konvertierungsexits.

**Dumps und Debugger.** `dumps(from, to, user, contains)` liefert kompakte Zusammenfassungen (Laufzeitfehler, Ausnahme, Programm, Abbruchstelle mit Quelltext-URL und Zeile, oberster Stack) und `dumpDetails(dumpId)` die vollständige Analyse; `getObjectSource` rund um `terminatedAt.line` und `whereUsed` finden die Ursache. Die Toolsets `debugger` und `traces` gibt es nur, wo das Backend sie anbietet (`systemProfile` sagt es) und nur, wenn das Toolset veröffentlicht ist (`focused` lässt beide weg). Ohne Debugger sind die Wege: ein Dump (`dumps`), den Fehler mit `runSnippet` oder `runClass` auf einem Entwicklungssystem nachstellen und die Ausgabe lesen, und `traces`, wo das Backend sie liefert. Ist der Debugger verfügbar, braucht `debuggerListen` `debuggingMode`, `terminalId`, `ideId` und `user`, wie in Eclipse.

**ABAP-Cloud-Bereitschaft.** `apiReleaseState` nimmt eine von vier Eingaben: `names` (kommagetrennt, optional typisiert wie `TABL:MARA`), `objectUrl`, `source` (eingefügter ABAP-Text) oder `sourceUrl` (eine `.../source/main`-URL, die der Server liest und durchsucht). Es prüft die SAP-Objekte gegen das offizielle Cloudification-Repository von SAP (freigegeben, veraltet mit Nachfolgern, classicAPI, noAPI; Editionen `cloud`, `btp`, `pce2023`, `pce2022`) plus die Antwort des Backends auf `/sap/bc/adt/apireleases`, sodass das Modell Freigabezustände nie aus dem Gedächtnis abruft.

**Code ausführen.** `runSnippet(code, packageName)` verpackt Wegwerf-ABAP in eine temporäre `IF_OO_ADT_CLASSRUN`-Klasse, legt sie an, aktiviert und führt sie aus, liefert die Konsolenausgabe und löscht die Klasse wieder, auch wenn Aktivierung oder Lauf scheitern (ein gescheitertes Löschen wird als `cleanupError` gemeldet; `keep=true` behält sie). On-Premise ist `packageName` standardmäßig `$TMP`; auf S/4HANA Cloud übergeben Sie ein Kundenpaket, seinen `transport` und `responsible`, und Anlage wie Löschung werden in diesem Transport erfasst. `runClass` führt eine bestehende Klasse aus. Beide brauchen S_DEVELOP, also nur Entwicklungssysteme.

**abapGit, RAP-Generator, Refactoring, Services.** abapGit: `gitRepos`, `gitCreateRepo`, `gitPullRepo`, `stageRepo`, `pushRepo`, `checkRepo`, `switchRepoBranch`, wobei `gitUser`/`gitPassword` je Destination die Remote-Zugangsdaten aus dem Gespräch heraushalten. RAP-Generator: `rapGenIsAvailable`, `rapGenGetContent`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate` (Transport erforderlich), dann `activateObjects` auf den erzeugten Objekten und `rapGenPublishService`. Refactoring: `renameEvaluate`, `renamePreview`, `renameExecute`; dasselbe Trio für `extractMethod*`; `changePackagePreview` und `changePackageExecute`. Business Services: `fetchServiceDetails(name)`, `bindingDetails`, `publishServiceBinding`, `unPublishServiceBinding`.

## Eingebaute Prompts

Sechs fertige Abläufe reisen als MCP-Prompts. Jeder nennt die genauen Tools in ihrer Reihenfolge und sagt, wo er anhalten und fragen muss:

| Prompt | Argumente | Was er tut | Wo er anhält |
|---|---|---|---|
| `create-object` | optional `destination`, dann `objectType` (ADT-Typ-ID wie `CLAS/OC`, `INTF/OI`, `PROG/P`, `DDLS/DF`), `name`, `package`, optional `purpose` | Validiert, legt an, schreibt, aktiviert, testet und prüft per ATC ein neues Objekt im richtigen Paket und Transport. | Legt an und aktiviert; löscht nie und gibt nie frei. |
| `safe-edit` | optional `destination`, dann `object` (Name oder URL), `change` | Liest, ändert mit textverankerten Ersetzungen, aktiviert, testet und zeigt den Diff. | Erreicht `deleteObject`, `transportRelease` oder `forceUnlock` nie von selbst; bei einer fremden Sperre oder einer Freigabefrage hält er an und fragt. |
| `review-transport` | optional `destination`, dann `transport` (Auftragsnummer) | Vergleicht jedes Objekt eines Transports und erstellt eine Go/No-Go-Bewertung. | Ruft nie `transportRelease` auf. |
| `fix-atc` | optional `destination`, dann `target` (Objekt-URL, Paketname oder Transport), optional `variant` | Führt ATC aus, wendet deterministische Quickfixes an, korrigiert den Rest per Änderung, wiederholt, bis Priorität 1 und 2 sauber sind. | Wendet Quickfixes und Änderungen an; Ausnahmen nur mit Genehmigung. |
| `clean-core-check` | optional `destination`, dann `target` (Objektname oder URL, oder Paketname) | Bewertet die ABAP-Cloud-Bereitschaft: freigegebene APIs, veraltete Objekte, Nachfolger, Cloud-ATC-Prüfungen. | Ändert keinen Code. |
| `debug-dump` | optional `destination`, dann optional `filter` (Benutzer, Programm, Ausnahme oder Zeitfenster) | Findet die Ursache eines Kurzdumps und schlägt die Korrektur an der genauen Zeile vor. | Schlägt Ersetzungen vor; wendet sie ohne Genehmigung nicht an. |

Wie Sie sie aufrufen, hängt vom Host ab. Claude Code stellt MCP-Prompts als Slash-Befehle namens `/mcp__<server>__<prompt>` bereit, mit den Argumenten positionsweise in der Reihenfolge, die der Prompt deklariert (`destination` kommt in jedem Prompt zuerst, wie in der Tabelle):

```text
/mcp__abap-adt-mcp__safe-edit DEV ZCL_ORDER_SERVICE "return early when the input table is empty"
```

Claude Desktop bietet sie zum Zeitpunkt dieses Textes im Anhang-Menü (Plus) des Chats unter dem Servernamen an; Hosts ohne Prompt-Unterstützung zeigen sie schlicht nicht, und dieselben Abläufe erreichen das Modell weiterhin über das Feld `instructions` des Servers.

## Weitere Installationswege

**Version festlegen.** `npx -y abap-adt-mcp` holt bei jedem Start die neueste Version. Für einen kontrollierten Rollout legen Sie sie fest (`npx -y abap-adt-mcp@X.Y.Z`, oder das Container-Tag `vX.Y.Z`) und prüfen die Provenance-Bescheinigung, die Trusted Publishing anhängt, mit `npm audit signatures` in einem Verzeichnis, in dem das Paket installiert ist.

**Claude-Code-Plugin.** Das Repository ist sein eigener Plugin-Marketplace (`.claude-plugin/marketplace.json` neben `plugin.json`), daher registrieren zwei Befehle in Claude Code den Server und laden beide Skills, ohne `claude mcp add`:

```text
/plugin marketplace add williansaez/abap-adt-mcp
/plugin install abap-adt-mcp@abap-adt-mcp
```

Das Manifest startet den Server als `npx -y abap-adt-mcp@<version>`, festgelegt auf das Release, mit dem es ausgeliefert wird (der Pin wandert mit jedem Release, CI prüft ihn gegen `package.json`); ein Plugin-Host behält also die installierte Version, statt beim nächsten Start zu nehmen, was npm gerade als latest liefert. Es setzt `SAP_SYSTEMS_FILE=${HOME}/.abap-adt-mcp/systems.json` und kein `MCP_TOOLSETS`, veröffentlicht also alle 173 Tools; die `systems.json` aus Schritt 1 schreiben weiterhin Sie. Die Skills allein installieren sich zum Zeitpunkt dieses Textes mit `npx skills add williansaez/abap-adt-mcp` (ein Installer eines Dritten, nicht Teil dieses Repositories) oder durch Kopieren der beiden Verzeichnisse aus `skills/` nach `~/.claude/skills/`.

**Container.** Die Images werden aus `node:22-alpine` gebaut, laufen als unprivilegierter Benutzer `node` (uid 1000) und werden bei jedem Release nach GHCR veröffentlicht (Tags `latest` und `vX.Y.Z`). Hängen Sie Ihre `systems.json` schreibgeschützt ein und reichen Sie referenzierte Geheimnisse durch:

```bash
docker run -i --rm \
  -v "$PWD/systems.json:/config/systems.json:ro" \
  -e SAP_SYSTEMS_FILE=/config/systems.json \
  -e ONPREM_PASSWORD \
  ghcr.io/williansaez/abap-adt-mcp:latest
```

Die Prüfung des Dateimodus läuft auch im Container: eine eingehängte Datei mit Modus `0600`, die einer anderen uid gehört, kann der Benutzer `node` gar nicht lesen (der Start scheitert mit `is not valid JSON: EACCES`, da Lesen und Parsen einen Fehlerpfad teilen), und eine für andere lesbare Datei warnt nur, sofern sie keine Geheimnisse im Klartext enthält. Entweder gehört die Datei uid 1000 und behält `0600`, oder Sie referenzieren jedes Geheimnis als `${env:VAR}` und nehmen die Warnung hin. Mit `-e` übergebene Geheimnisse sind für `docker inspect` sichtbar; für `MCP_HTTP_TOKEN` gibt es keine dateibasierte Alternative, behandeln Sie die Umgebung des Containers also als vertraulich. Für Streamable HTTP im Container ergänzen Sie `-e MCP_HTTP_PORT=2236 -e MCP_HTTP_HOST=0.0.0.0 -e MCP_HTTP_TOKEN=<token> -p 127.0.0.1:2236:2236`. Browser-SSO braucht einen lokalen Browser, betreiben Sie SSO-Destinationen also aus npm auf der Arbeitsstation; `basic`- und `oauth`-Destinationen funktionieren im Container.

**MCP-Registry.** Gelistet als `io.github.williansaez/abap-adt-mcp` für Hosts, die die Registry durchsuchen; [server.json](server.json) ist das Registry-Manifest.

**Aus dem Quelltext.**

```bash
git clone https://github.com/williansaez/abap-adt-mcp.git
cd abap-adt-mcp
npm ci
npm run build
```

Richten Sie den Host dann auf `node /absoluter/pfad/abap-adt-mcp/dist/index.js`. Eine `systems.json` neben dem Checkout wird automatisch gefunden; `.env` (siehe [.env.example](.env.example)) funktioniert für Einzelsystem-Setups. Beide sind git-ignoriert.

## Authentifizierung

Jede Destination wählt ihren `authType` (`sso`, sofern `SAP_AUTH_TYPE` nichts anderes sagt). Details und SAP-seitige Schritte stehen in [docs/AUTH.md](docs/AUTH.md).

| Modus | Wofür | Was Sie konfigurieren | SAP-seitige Einrichtung |
|---|---|---|---|
| `sso` (Standard) | Benannte Benutzer auf S/4HANA Cloud, genau wie Eclipse ADT (SAML2/OIDC über IAS) | Ein Chromium-Browser (Chrome, Edge, Brave) öffnet sich einmal je Host; die Sitzungscookies werden über das DevTools-Protokoll gelesen und im Speicher gehalten, mit `sap-client` an jeder Anfrage. Die Sitzung beim Identity Provider lebt in einem eigenen Profil unter `~/.abap-adt-mcp/sso/<host>` (Modus `0700`). `SAP_BROWSER_PATH` überschreibt den Browser, `SAP_BROWSER_PROFILE_DIR` verwendet ein eigenes Profil mit gespeicherten Passkeys wieder (das Standardprofil des Browsers wird absichtlich abgelehnt). | Nichts über die Entwickler-Business-Role hinaus, die Ihr Benutzer für Eclipse ADT ohnehin braucht |
| `basic` | On-Premise AS ABAP, Communication Users auf S/4HANA Cloud | `user` und `password` (verwenden Sie `${env:VAR}`). Authentifiziert beim ersten Aufruf, `login` ist optional. | Ein Benutzer mit ADT-Berechtigungen |
| `oauth` | Unbeaufsichtigte Clients auf S/4HANA Cloud | `oauth.tokenUrl`, `oauth.clientId`, `oauth.clientSecret`, optional `oauth.scope` (Client-Credentials-Grant; das Token wird bis kurz vor Ablauf zwischengespeichert und bei einem 401 verworfen). | Ein Communication User, ein Communication System mit OAuth 2.0 und ein Communication Arrangement für das Szenario, das ADT auf Ihrem Tenant freigibt (es variiert je Tenant und wird hier nicht aufgeführt; das Arrangement liefert den Token-Endpunkt). Die Tools laufen dann mit den Berechtigungen des Communication Users. |

Benannte Business-Benutzer auf S/4HANA Cloud können keine Basic-Authentifizierung verwenden; sie melden sich über `sso` an, oder Sie legen einen Communication User an. Die SSO-Sitzung wird für den Anmeldemandanten des Tenants erzeugt, der ein anderer sein kann als erwartet (`100` statt `080`, zum Beispiel): setzen Sie `client` auf den, den die Sitzung tatsächlich verwendet. Ein falscher Mandant zeigt sich als Berechtigungs- oder Nicht-gefunden-Fehler bei Objekten, die Sie in Eclipse öffnen können, nach einer an sich erfolgreichen Anmeldung. Das SSO-Profilverzeichnis ist ein gewöhnliches Chromium-Benutzerdatenverzeichnis: es enthält die Cookies und den lokalen Speicher, die der Identity Provider setzt, wenn Sie "angemeldet bleiben" ankreuzen, nichts, was der Server hinzufügt, und es wird durch Dateiberechtigungen und durch das geschützt, was Chromium auf Ihrem Betriebssystem tut, nicht vom Server verschlüsselt; wie lange die Sitzung gültig bleibt, bestimmt die Richtlinie des Identity Providers, und das Löschen des Verzeichnisses ist der einzige Weg, sie vorzeitig zu beenden (das eingesammelte SAP-Sitzungscookie selbst wird nie auf die Platte geschrieben). `tls` je Destination ergänzt eine Unternehmens-CA (`ca`), den Namen, gegen den das Zertifikat geprüft wird, wenn `url` eine IP-Adresse oder einen Kurznamen enthält (`servername`, auch als SNI gesendet), oder ein X.509-Client-Zertifikat (`cert` + `key`, oder `pfx` + `passphrase`), bei eingeschalteter Prüfung; das SSO-Browserfenster verwaltet seinen eigenen Vertrauensspeicher. Optionale `gitUser`/`gitPassword` liefern abapGit-Zugangsdaten, damit sie nie durch das Modell laufen. Abgelaufene Sitzungen werden in jedem Modus einmal neu aufgebaut und der Aufruf wiederholt; scheitert das, meldet der Fehler `kind: "sessionExpired"`.

## Sicher bleiben

Dieser Server gibt einem Sprachmodell Lese- und Schreibzugriff auf SAP. Ein paar Regeln machen das erträglich:

- **Leitplanken leben im Server, nicht im Host.** Der `policy`-Block einer Destination wird im Server vor dem eigentlichen SAP-Aufruf des Tools ausgewertet, unabhängig davon, was der Host genehmigt; `allowedPackages` ist die einzige Schranke, die eine Abfrage brauchen kann (`transportInfo`, zwischengespeichert), um zuerst das Paket eines bestehenden Objekts zu erfahren. Ablehnungen kommen als `kind: "policyDenied"` mit dem Namen der Schranke zurück, und `listSystems` zeigt jede Richtlinie. Eine Destination ohne `policy`-Block ist voll beschreibbar.

  | Schlüssel | Typ | Wirkung |
  |---|---|---|
  | `readOnly` | boolean | Nur als nur-lesend annotierte Tools dürfen laufen, plus `login`, `logout`, `dropSession`, `listSystems`, `healthcheck`, `systemProfile` und `exportPackageSources` (das nur lokal schreibt). Als Schreibzugriff gesperrt: jeder Quelltext-Schreibzugriff, `lock`, `runSnippet`, `runClass`, `unitTestRun`, `createAtcRun` und `atcSummary`. Weiterhin erlaubt: `runQuery` und `tableContents` (sie lesen; sperren Sie sie mit `allowFreeSql: false` oder `deniedTools`). |
  | `deniedTools` | Globs | Tools, die auf dieser Destination rundweg abgelehnt werden: ein Name, ein Glob (`rapGen*`) oder `toolset:<name>` für alle Tools eines Toolsets, zum Beispiel `["transportRelease", "toolset:git"]`. Fünf abapGit-Tools tragen kein git-Präfix (`pushRepo`, `stageRepo`, `checkRepo`, `remoteRepoInfo`, `switchRepoBranch`), `git*` allein lässt den Push-Pfad also offen. Die Tools bleiben gelistet. |
  | `allowFreeSql` | boolean | `false` lehnt `runQuery` und `tableContents` mit `sqlQuery` ab. |
  | `deniedTables` | Globs | Angewandt auf `tableContents`, auf jedes `FROM`/`JOIN`-Ziel eines `runQuery`, und (nach bestem Bemühen, durch Durchsuchen des ABAP-Texts) auf `runSnippet`, `setObjectSource` und `setMethodSource`. Dynamisches SQL und Views über die Tabelle werden nicht erkannt: für Daten, die SAP nicht verlassen dürfen, verlassen Sie sich auf die SAP-Anzeigeberechtigungen des verbundenen Benutzers und kombinieren `allowFreeSql: false` mit `deniedTools: ["runSnippet"]` oder `readOnly`. |
  | `allowedPackages` | Globs, geschlossene Liste | Beschränkt nur Schreibzugriffe; Lesen und Navigation beliebiger Objekte (SAP-Objekte eingeschlossen) werden nie beschränkt. Paketargumente werden direkt geprüft; Objekt-Schreibzugriffe ermitteln das Paket des Objekts über `transportInfo`; ein nicht ermittelbares Paket wird abgelehnt. `gitPullRepo`, `rapGenGenerate`, `rapGenPublishService`, `publishServiceBinding` und `unPublishServiceBinding` können kein Paket ableiten und werden abgelehnt, sobald dieser Schlüssel gesetzt ist. |
  | `allowedTransports` | Globs | Jedes `transport`/`transportNumber`-Argument muss passen; `createTransport` und `resolveTransport(createIfMissing=true)` werden abgelehnt. |

  Serverweite Schalter sind `MCP_READ_ONLY=1` (fügt jeder Destination `readOnly` hinzu) und `MCP_DISABLED_TOOLSETS` (blendet ganze Toolsets für jede Destination aus); es gibt kein globales `deniedTools`, `deniedTables` oder `allowedPackages`, die werden je Eintrag wiederholt. Ausgeblendet und abgelehnt sind verschieden: ein von `MCP_TOOLSETS`/`MCP_DISABLED_TOOLSETS` weggelassenes Toolset fehlt in der Tool-Liste, und ein Aufruf nach Namen (aus einem Prompt, einem Host mit veralteter Liste oder einem Skill) wird mit dem Namen des Toolsets abgelehnt; `deniedTools` lässt das Tool gelistet und lehnt es auf dieser Destination ab; Tools, die eine Destination nicht bedienen kann (erkannt durch `systemProfile`), bleiben gelistet und werden vor dem SAP-Aufruf abgelehnt (`MCP_PROFILE_GATE=enforce|warn|off`).
- **Geheimnisse bleiben aus Dateien und Chats heraus.** `${env:VAR}` funktioniert in jeder Zeichenkette der `systems.json` (`password`, `oauth.clientSecret`, `gitPassword`, `tls.passphrase`, sogar `url`); eine fehlende Variable scheitert beim Start mit ihrem Namen, nie mit ihrem Wert. Halten Sie `systems.json` auf Modus `0600`: eine gruppen- oder weltlesbare Datei wird bemängelt und abgelehnt, wenn sie `password`, `oauth.clientSecret` oder `gitPassword` im Klartext enthält. Bevorzugen Sie `SAP_SYSTEMS_FILE` gegenüber `SAP_SYSTEMS` inline in Host-Konfigurationen. `MCP_HTTP_TOKEN` ist eine Umgebungsvariable, kein Dateieintrag; die Client-Seite des HTTP-Transports muss das Token in ihrer Host-Konfiguration tragen, halten Sie also auch diese Datei auf `0600`. `listSystems` und `healthcheck` melden keine Zugangsdaten, Fehlermeldungen durchlaufen eine Schwärzung, die Bearer-Tokens, Cookies, Passwörter und `user:password@host`-URLs maskiert, und `exportPackageSources` darf nur innerhalb von `MCP_EXPORT_ROOT` schreiben (Standard `~/.abap-adt-mcp/exports`, gegen Symlinks geprüft). `reentranceTicket` bleibt deaktiviert, sofern nicht `SAP_ALLOW_REENTRANCE_TICKET=1`, weil es ein lebendes Anmeldeticket in das Gespräch zurückgibt.
- **TLS bleibt an und lässt sich nicht für alles auf einmal abschalten.** `NODE_TLS_REJECT_UNAUTHORIZED=0` wird vor der ersten Verbindung aus der Umgebung entfernt, und der Server sagt das beim Start: das Problem einer Destination bringt nie die Prüfung der anderen, der OAuth-Token-Anfrage oder des Cloudification-Downloads zum Schweigen. Für ein Unternehmens- oder selbstsigniertes Zertifikat verwenden Sie `tls.ca` auf dieser Destination, für ein Zertifikat, das auf einen anderen Namen als den in `url` ausgestellt ist, `tls.servername` (die Prüfung bleibt in beiden Fällen an, ohne Warnung), oder als letzten Ausweg `insecureTls: true` nur auf dieser Destination (beim Start angekündigt, von `listSystems` angezeigt). Ein fehlgeschlagener Handshake kommt als `kind: "tlsCertificate"` zurück, mit der Lösung für diese Destination ausbuchstabiert.
- **Inhalte aus SAP sind nicht vertrauenswürdige Eingaben.** Kommentare, Tabellenzeilen und Feeds können Text enthalten, der das Modell zu steuern versucht. Verwenden Sie einen Host, der vor Tool-Aufrufen fragt, und prüfen Sie destruktive Aufrufe (`deleteObject`, `transportRelease`, `transportDelete`, `setObjectSource`, `editObjectSource`, `setMethodSource`, `pushRepo`, `forceUnlock`), bevor Sie sie genehmigen.
- **Minimale Rechte, und was "nur lesen" trotzdem liest.** Verbinden Sie sich mit Benutzern, die nur die Berechtigungen haben, die die Aufgabe braucht. `runQuery` und `tableContents` lesen echte Geschäftsdaten, konfigurieren Sie also nur Destinationen, wo das akzeptabel ist, und `exportPackageSources` kopiert ganze Quelltextpakete auf die lokale Platte, auch auf einer `readOnly`-Destination: nehmen Sie es in `deniedTools` auf, wo Quelltext SAP nicht verlassen darf.
- **Was den Rechner verlässt.** Der Server spricht mit den konfigurierten SAP-Hosts, mit dem Identity Provider während des Browser-SSO, und mit GitHub für das Cloudification-Repository von SAP, wenn `apiReleaseState` läuft (eine JSON-Datei je Edition von `raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc`, 15 Sekunden Zeitlimit, 24 Stunden unter `~/.abap-adt-mcp/cache` zwischengespeichert, mit `MCP_CACHE_DIR` verschiebbar; scheitert der Download, wird die zwischengespeicherte Kopie verwendet). Für diesen Download gibt es keinen Offline-Schalter, keine Spiegel-URL und keine Proxy-Unterstützung (er nutzt Nodes eingebautes `fetch`, das `HTTPS_PROXY` ignoriert): auf einem abgeschotteten Host füllen Sie das Cache-Verzeichnis einmal, oder lassen dieses eine Tool scheitern. Sonst wird nichts irgendwohin gesendet: keine Telemetrie, keine Update-Prüfungen. `npx` selbst kontaktiert die npm-Registry.

## Audit-Protokoll

Setzen Sie `MCP_AUDIT_FILE=/var/log/abap-adt-mcp/audit.jsonl`, um je Tool-Aufruf eine JSON-Zeile anzuhängen. Das Verzeichnis wird mit Modus `0700` angelegt, die Datei mit `0600`; ein Schreibfehler wird einmal auf stderr gemeldet und bricht nie einen Aufruf ab. Jeder Datensatz wird über den Pfad angehängt, das Rotieren der Datei durch Umbenennen ist also sicher (der nächste Aufruf legt eine neue an); der Server hat keine eigene Aufbewahrung. [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) erklärt, wie Sie aus der Datei einen brauchbaren Sitzungsbericht machen.

```json
{"ts":"2026-09-03T10:15:42.117Z","requestId":42,"tool":"editObjectSource","destination":"DEV","durationMs":1834,"outcome":"ok","args":{"objectSourceUrl":"/sap/bc/adt/oo/classes/zcl_example/source/main","replacements":"[array 312 chars]","activate":true,"transport":"DEVK900123"}}
{"ts":"2026-09-03T10:16:03.902Z","requestId":43,"tool":"runQuery","destination":"QAS","durationMs":2,"outcome":"denied","args":{"sqlQuery":"SELECT * FROM ztable"},"errorKind":"policyDenied","gate":"allowFreeSql","message":"MCP error -32600: Policy: runQuery blocked on destination QAS (allowFreeSql): free SQL (runQuery) is disabled; use tableContents on an allowed table. Configured in systems.json policy; retrying will not help."}
```

Felder: `ts`, `requestId`, `tool`, `destination`, `durationMs`, `outcome` (`ok`, `error`, `denied` für Richtlinien-Ablehnungen, `unavailable` für Toolset- oder Plattformschranken), `errorKind`, `gate` (der Richtlinienschlüssel), `message` (der Fehlertext, erste 300 Zeichen), `args` und `retried` (gesetzt, wenn der Aufruf neu authentifiziert und wiederholt wurde). Was `args` behält: Argumentschlüssel, die `pass` (also `password` und `passphrase`), `secret`, `token`, `authorization`, `cookie` oder `lockHandle` enthalten, werden zu `[REDACTED]`; Zeichenkettenwerte bis 200 Zeichen werden nach derselben Schwärzung wie Fehlermeldungen wörtlich gespeichert (eine SQL-Anweisung oder ein kurzer Schnipsel mit Geschäftsliteralen steht also in der Datei), längere Zeichenketten werden gekürzt, und Arrays oder Objekte über 200 Zeichen schrumpfen zu `[array N chars]` oder `[object N chars]`. Behandeln Sie die Datei als sensibel. Ein Datensatz enthält keine Aufruferidentität (keine Remote-Adresse, MCP-Sitzungs-ID oder Token-ID): bei stdio gehört der Prozess einer Person, und bei einer gemeinsamen HTTP-Instanz muss die Zuordnung aus einer Instanz je Person oder dem Zugriffsprotokoll des vorgeschalteten Reverse-Proxys kommen.

## S/4HANA Cloud versus On-Premise

`systemProfile(destination)` meldet, ob eine Destination Cloud oder On-Premise ist (Host-Domäne, Systeminformationen und Discovery-Dokument) und welche Toolsets dem Backend fehlen; diese Tools werden vor dem SAP-Aufruf abgelehnt. Wenn Sie nur einen S/4HANA-Cloud-Tenant haben, ist die mittlere Spalte Ihre. Was [docs/TESTPLAN.md](docs/TESTPLAN.md) und [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) auf einem Public-Cloud-Tenant festgehalten haben:

| Thema | S/4HANA Cloud (Public Edition) | On-Premise / Private |
|---|---|---|
| Authentifizierung | Benannte Benutzer: nur Browser-SSO. Unbeaufsichtigt: OAuth2 aus einem Communication Arrangement, oder Basic-Authentifizierung mit einem Communication User. | Basic-Authentifizierung; Client-Zertifikate über `tls`. |
| Lokale Objekte | `$TMP` wurde auf dem getesteten Tenant abgelehnt (Berechtigungsobjekt S_ABPLNGVS: Objekte in `$TMP` erhalten die Standard-Sprachversion); verwenden Sie ein Kundenpaket mit ABAP for Cloud Development und seinen Transport, `resolveTransport` wählt ihn. `runSnippet` braucht dort `packageName`, `transport` und `responsible`. | `$TMP` verfügbar, kein Transport nötig; `runSnippet` verwendet standardmäßig `$TMP`. |
| Toolsets | RAP-Generator auf dem getesteten Tenant nicht vorhanden; Debugger, Traces und abapGit hängen vom Tenant und den Berechtigungen ab. `dumps`/`dumpDetails` sind der Weg zur Ursache, wenn der Debugger fehlt. `sourceTextSearch` weicht auf `grepPackage` aus, wenn der Tenant "Source Search is not supported" antwortet. | Vollständiger ADT-Collection-Satz auf einem aktuellen Release. |
| Freigegebene APIs | `apiReleaseState` prüft Namen, eine Objekt-URL oder einen ganzen Quelltext; ATC-Variante `ABAP_CLOUD_DEVELOPMENT_DEFAULT`. `createObject` braucht `responsible`. | Optional. |
| Geschäftsdaten | `runQuery`/`tableContents` respektieren Anzeigeberechtigungen; sperren Sie Tabellen per Richtlinie. `runSnippet` braucht S_DEVELOP, also nur Entwicklungssysteme. | Ebenso. |

Lektionen, die überall gelten: `runQuery`-Anweisungen werden auf die 255-Zeichen-Zeilengrenze der Datenvorschau umgebrochen; Tabellen mit eingeschränktem `dataMaintenance` werden mit `tableContents` gelesen; eine Sperre einer offenen Eclipse-Sitzung ist fremd, und nur `SM12` oder diese Sitzung kann sie lösen; das Schreiben einer Nachrichtenklasse über `setObjectSource` schreibt die ganze Klasse neu und setzt `masterLanguage` auf die Anmeldesprache zurück.

## Konfigurationsreferenz

Jede Option mit ihrem Standardwert, die Richtlinienschranken Tool für Tool, Host-Schnipsel und Betriebshinweise stehen in [docs/CONFIGURATION.md](docs/CONFIGURATION.md); dieser Abschnitt ist die Zusammenfassung.

Konfigurationsquellen in Reihenfolge des Vorrangs: `SAP_SYSTEMS` (JSON inline), `SAP_SYSTEMS_FILE`, eine `systems.json` neben der Installation, dann die Altvariablen für ein Einzelsystem (`SAP_URL`, `SAP_CLIENT`, `SAP_USER`, `SAP_PASSWORD`, `SAP_LANGUAGE`, `SAP_TLS_INSECURE`, `SAP_OAUTH_TOKEN_URL`, `SAP_OAUTH_CLIENT_ID`, `SAP_OAUTH_CLIENT_SECRET`, `SAP_OAUTH_SCOPE`, siehe [.env.example](.env.example)).

Schlüssel je Destination in `systems.json`: `url`, `client`, `language`, `authType`, `default`, `user`/`password` (basic), `oauth` (`tokenUrl`, `clientId`, `clientSecret`, `scope`), `insecureTls`, `gitUser`/`gitPassword`, `policy` und `tls` (`ca`, `servername`, `cert` + `key`, `pfx` + `passphrase`). Jeder Zeichenkettenwert darf `${env:VAR}` sein. Schlüssel, die mit `_` beginnen, werden ignoriert, `_comment`-Einträge sind also in Ordnung. Alle Betriebsausgaben (Startwarnungen, Schrankenmeldungen, die Warnung zur Audit-Datei) gehen nach stderr, das MCP-Hosts in ihren Protokollen auffangen.

Jede in [server.json](server.json) deklarierte Variable:

| Variable | Zweck | Standard / Hinweise |
|---|---|---|
| `SAP_SYSTEMS_FILE` | Pfad zur Destinationsdatei | Empfohlen; Modus `0600` halten |
| `SAP_SYSTEMS` | Dieselbe Map inline | Enthält Zugangsdaten, bevorzugen Sie die Datei |
| `SAP_DEFAULT_DESTINATION` | Destination, wenn ein Aufruf `destination` weglässt | Oder einen Eintrag mit `"default": true` markieren |
| `SAP_AUTH_TYPE` | Standard-Authentifizierungstyp für Einträge ohne eigenen, und der Modus des Einzelsystem-Altsetups | `sso`; `basic` oder `oauth` |
| `MCP_TOOLSETS` | Zu veröffentlichende Toolsets: Preset `all` oder `focused`, oder eine Kommaliste | `all` |
| `MCP_DISABLED_TOOLSETS` | Auszublendende Toolsets, Kommaliste | `core` kann nicht deaktiviert werden |
| `MCP_READ_ONLY` | `1` macht jede Destination serverseitig nur-lesend | Aus |
| `MCP_MAX_RESPONSE_CHARS` | Zeichenbudget einer Tool-Antwort vor Seitenaufteilung oder Kürzung | 40000, mindestens 5000 |
| `MCP_PROFILE_GATE` | Schranke für Toolsets, die die Destination nicht anbietet | `enforce`; `warn` protokolliert nur, `off` deaktiviert |
| `MCP_SOURCE_CACHE_TTL_SECONDS` | Lebensdauer des Quelltext-Caches je Sitzung, genutzt von `syntaxCheckCode`, `grepPackage`, `cdsViewInfo`, `typeHierarchy`, `abapDocumentation` und `apiReleaseState(sourceUrl)` | 300; `0` behält Einträge bis zum Logout |
| `MCP_EXPORT_ROOT` | Verzeichnis, in das `exportPackageSources` schreiben darf | `~/.abap-adt-mcp/exports` |
| `MCP_AUDIT_FILE` | Pfad des JSONL-Audit-Protokolls | Aus, wenn nicht gesetzt |
| `SAP_ALLOW_REENTRANCE_TICKET` | `1` aktiviert das Tool `reentranceTicket` | Deaktiviert |
| `SAP_BROWSER_PATH` | SSO: Pfad zu einer Chromium-, Chrome- oder Edge-Binärdatei | Automatisch erkannt |
| `SAP_BROWSER_PROFILE_DIR` | SSO: persistentes Browserprofil mit der Sitzung beim Identity Provider | `~/.abap-adt-mcp/sso/<host>` |
| `MCP_HTTP_PORT` | Streamable HTTP auf `http://127.0.0.1:<port>/mcp` mit Bearer-Authentifizierung statt stdio | Nicht gesetzt (stdio); akzeptiert 1024 bis 65535 |
| `MCP_HTTP_HOST` | Bind-Adresse des HTTP-Transports | `127.0.0.1`; `0.0.0.0` nur in Containern |
| `MCP_HTTP_TOKEN` | Bearer-Token des HTTP-Transports | Erzeugt in `~/.abap-adt-mcp/http-token` |
| `MCP_HTTP_MAX_SESSIONS` | Maximale gleichzeitige MCP-Sitzungen; weitere `initialize`-Anfragen erhalten `503` | 16 |
| `MCP_HTTP_MAX_BODY_BYTES` | Größter Anfragekörper, den der HTTP-Transport annimmt; größere erhalten `413` | 4194304 (4 MB) |
| `MCP_HTTP_SESSION_TTL_MINUTES` | Leerlaufminuten, nach denen eine HTTP-Sitzung (und ihre SAP-Sitzungen und Sperren) geschlossen wird | 30 |
| `MCP_HTTP_ALLOWED_ORIGINS` | Kommagetrennte erlaubte `Origin`-Werte; `*` erlaubt alle | Loopback-Origins bei Loopback-Bind immer erlaubt |
| `MCP_HTTP_ALLOWED_HOSTS` | Kommagetrennte erlaubte `Host`-Header-Werte (Schutz vor DNS-Rebinding) | Loopback-Hosts bei Loopback-Bind immer erlaubt; jeder Host bei Nicht-Loopback-Bind |
| `SAP_URL` | Einzelsystem-Altmodus: Basis-URL, zum Beispiel `https://host:44300` | |
| `SAP_CLIENT` | Einzelsystem-Altmodus: Mandant, zum Beispiel `100` | |
| `SAP_LANGUAGE` | Einzelsystem-Altmodus: Anmeldesprache, zum Beispiel `EN` | |
| `SAP_USER` | Einzelsystem-Altmodus: SAP-Benutzer | |
| `SAP_PASSWORD` | Einzelsystem-Altmodus: SAP-Passwort | Geheim |
| `SAP_TLS_INSECURE` | Einzelsystem-Altmodus: `1` überspringt die Zertifikatsprüfung nur für dieses System | Nur Sandboxen |
| `SAP_OAUTH_TOKEN_URL` | Einzelsystem-Altmodus mit `SAP_AUTH_TYPE=oauth`: Token-Endpunkt | |
| `SAP_OAUTH_CLIENT_ID` | Einzelsystem-Altmodus: OAuth2-Client-ID | |
| `SAP_OAUTH_CLIENT_SECRET` | Einzelsystem-Altmodus: OAuth2-Client-Secret | Geheim |
| `SAP_OAUTH_SCOPE` | Einzelsystem-Altmodus: optionaler OAuth2-Scope | |

Zur Laufzeit gelesen, aber nicht Teil des Registry-Manifests: `MCP_CACHE_DIR` verschiebt den Cache des Cloudification-Repositorys (Standard `~/.abap-adt-mcp/cache`), und `NODE_TLS_REJECT_UNAUTHORIZED=0` wird beim Start entfernt, damit es die Zertifikatsprüfung nicht für den ganzen Prozess abschalten kann.

## HTTP-Transport (optional)

Standardmäßig spricht der Server stdio: ein Prozess je Benutzer, nichts lauscht im Netz. Für Hosts, die einen HTTP-Endpunkt erwarten (Eclipse, ein anderer Rechner, ein Container, eine gemeinsame Team-Instanz), starten Sie ihn mit einem Port:

```bash
MCP_HTTP_PORT=2236 npx -y abap-adt-mcp
```

Er lauscht auf `http://127.0.0.1:2236/mcp` (nur Loopback, sofern `MCP_HTTP_HOST` nichts anderes sagt) und verlangt `Authorization: Bearer <token>` bei jeder Anfrage. Das Token wird beim Start erzeugt und nach `~/.abap-adt-mcp/http-token` geschrieben (Modus `0600`); `MCP_HTTP_TOKEN` setzt Ihr eigenes. Host-Konfiguration:

```json
{
  "mcpServers": {
    "abap-adt-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:2236/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Was die Eingangstür durchsetzt:

- Ports unter 1024 werden abgelehnt; das Bearer-Token wird in konstanter Zeit verglichen; `GET /health` ist die einzige unauthentifizierte Route und antwortet mit Version, Sitzungszahl, Sitzungslimit und Laufzeit (blockieren Sie sie am Proxy, wenn diese Preisgabe stört). Alles andere außerhalb von `/mcp` ist `404`.
- Schutz vor DNS-Rebinding: bei einem Loopback-Bind passieren nur Loopback-Werte für `Host` und `Origin`, erweiterbar mit `MCP_HTTP_ALLOWED_HOSTS` und `MCP_HTTP_ALLOWED_ORIGINS` (`*` erlaubt alle). Bei einem Nicht-Loopback-Bind passiert jeder `Host`-Header (die Host-Prüfung schützt nur Loopback-Binds), während ein `Origin`-Header weiterhin in `MCP_HTTP_ALLOWED_ORIGINS` stehen muss (Browser-Aufrufer); Anfragen ohne `Origin`-Header (Nicht-Browser-Clients) passieren bei beiden Binds.
- Eine Serverinstanz je MCP-Sitzung: getrennte SAP-Sitzungen, Sperrbuch und Caches je Aufrufer. Leerlaufsitzungen laufen nach `MCP_HTTP_SESSION_TTL_MINUTES` ab (Standard 30); jenseits von `MCP_HTTP_MAX_SESSIONS` (Standard 16) erhalten neue `initialize`-Anfragen `503` mit `Retry-After`; eine geschlossene oder abgelaufene Sitzung gibt ihre Sperren und SAP-Sitzungen frei. Bei SIGINT/SIGTERM schließt der Prozess die lauschende Instanz und beendet sich, ohne die offenen Sitzungen abzuarbeiten, senden Sie also `DELETE /mcp` von den Clients, bevor Sie eine gemeinsame Instanz stoppen. Jeder Anfragekörper ist auf `MCP_HTTP_MAX_BODY_BYTES` begrenzt (Standard 4 MB); größere werden mit `413` abgelehnt und die Verbindung geschlossen.
- Warnungen beim Start, wenn der Bind über Loopback hinausreicht, und erneut, wenn eine SSO-Destination so freigegeben wird: jeder entfernte Aufrufer teilte sich die Browser-Anmeldung des Benutzers, der den Server betreibt.

Was er nicht bietet: TLS (stellen Sie einen Reverse-Proxy davor), Ratenbegrenzung, Tokens je Benutzer oder Token-Rotation ohne Neustart (ein Neustart ohne `MCP_HTTP_TOKEN` erzeugt bereits ein neues Token und überschreibt `http-token`; wenn Sie die Variable selbst setzen, ändern Sie sie und starten neu; offene Sitzungen enden mit dem Prozess). Eine gemeinsame Instanz bedeutet daher ein Token und, je Destination, einen Satz SAP-Zugangsdaten für alle Aufrufer. Bevorzugen Sie eine Instanz je Person, oder `basic`/`oauth`-Destinationen mit `readOnly`-Richtlinie, halten Sie das Token geheim und stellen Sie TLS davor.

## Tool-Katalog (alle 173 Tools, nach Toolset)

Die Referenz je Tool (Beschreibung, Parameter, Annotationen nur-lesend/destruktiv) ist [docs/TOOLS.md](docs/TOOLS.md), erzeugt aus der lebenden `tools/list`-Antwort durch `npm run tools:docs` und in der CI durch einen Vertragstest geprüft. Jedes Tool außer `listSystems` und `healthcheck` akzeptiert ein optionales `destination`; ohne es wird die Standarddestination verwendet.

Tool-Schemata kosten Kontext. Setzen Sie `MCP_TOOLSETS` auf ein Preset (`all`, der Standard, oder `focused` = 114 Entwicklungs-Tools) oder auf eine Kommaliste der Namen unten; `MCP_DISABLED_TOOLSETS` entfernt einige. `core` wird immer veröffentlicht. Unbekannte Namen scheitern beim Start.

| Toolset | In `focused` | Tools |
|---|---|---|
| `core` · Destinations, health & session (6) | ja | `login`, `logout`, `dropSession`, `listSystems`, `healthcheck`, `systemProfile` |
| `source` · Source code (16) | ja | `lock`, `unLock`, `listLocks`, `forceUnlock`, `getObjectSource`, `setObjectSource`, `editObjectSource`, `getMethodSource`, `setMethodSource`, `prettyPrinterSetting`, `setPrettyPrinterSetting`, `prettyPrinter`, `revisions`, `objectDiff`, `getTextElements`, `setTextElements` |
| `objects` · Objects & navigation (27) | ja | `objectStructure`, `searchObject`, `findObjectPath`, `objectTypes`, `reentranceTicket`, `classIncludes`, `classComponents`, `deleteObject`, `activateObjects`, `activateByName`, `activatePackage`, `inactiveObjects`, `objectRegistrationInfo`, `creatableTypeDetails`, `validateNewObject`, `createObject`, `nodeContents`, `mainPrograms`, `typeHierarchy`, `objectStructureElements`, `objectEnhancements`, `packageTree`, `exportPackageSources`, `whereUsed`, `cdsViewInfo`, `sourceTextSearch`, `grepPackage` |
| `transports` · Transports (18) | ja | `transportDetails`, `transportUnifiedDiff`, `transportInfo`, `resolveTransport`, `createTransport`, `hasTransportConfig`, `transportConfigurations`, `getTransportConfiguration`, `setTransportsConfig`, `createTransportsConfig`, `userTransports`, `transportsByConfig`, `transportDelete`, `transportRelease`, `transportSetOwner`, `transportAddUser`, `systemUsers`, `transportReference` |
| `analysis` · Syntax & code analysis (16) | ja | `syntaxCheckCode`, `syntaxCheckCdsUrl`, `codeCompletion`, `findDefinition`, `usageReferences`, `syntaxCheckTypes`, `codeCompletionFull`, `runClass`, `codeCompletionElement`, `usageReferenceSnippets`, `fixProposals`, `fixEdits`, `fragmentMappings`, `abapDocumentation`, `apiReleaseState`, `runSnippet` |
| `tests` · Unit tests (4) | ja | `unitTestRun`, `unitTestEvaluation`, `unitTestOccurrenceMarkers`, `createTestInclude` |
| `atc` · ATC (14) | ja | `atcCustomizing`, `atcQuickfixProposals`, `atcApplyQuickfix`, `atcCheckVariant`, `atcSummary`, `createAtcRun`, `atcWorklists`, `atcUsers`, `atcExemptProposal`, `atcRequestExemption`, `isProposalMessage`, `atcContactUri`, `atcChangeContact`, `atcDocumentation` |
| `data` · Data access & DDIC (10) | ja | `annotationDefinitions`, `ddicElement`, `ddicRepositoryAccess`, `packageSearchHelp`, `getDomainProperties`, `setDomainProperties`, `getDataElementProperties`, `setDataElementProperties`, `tableContents`, `runQuery` |
| `discovery` · Discovery & metadata (7) | nein | `featureDetails`, `collectionFeatureDetails`, `findCollectionByUrl`, `loadTypes`, `adtDiscovery`, `adtCoreDiscovery`, `adtCompatibilityGraph` |
| `runtime` · Runtime errors (3) | ja | `feeds`, `dumps`, `dumpDetails` |
| `refactoring` · Refactoring (8) | nein | `renameEvaluate`, `renamePreview`, `renameExecute`, `extractMethodEvaluate`, `extractMethodPreview`, `extractMethodExecute`, `changePackagePreview`, `changePackageExecute` |
| `rap` · RAP generation (8) | nein | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenGetContent`, `rapGenValidateInitial`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` |
| `services` · Business services (4) | nein | `publishServiceBinding`, `unPublishServiceBinding`, `fetchServiceDetails`, `bindingDetails` |
| `git` · abapGit (10) | nein | `gitRepos`, `gitExternalRepoInfo`, `gitCreateRepo`, `gitPullRepo`, `gitUnlinkRepo`, `stageRepo`, `pushRepo`, `checkRepo`, `remoteRepoInfo`, `switchRepoBranch` |
| `debugger` · Debugger (13) | nein | `debuggerListeners`, `debuggerListen`, `debuggerDeleteListener`, `debuggerSetBreakpoints`, `debuggerDeleteBreakpoints`, `debuggerAttach`, `debuggerSaveSettings`, `debuggerStackTrace`, `debuggerVariables`, `debuggerChildVariables`, `debuggerStep`, `debuggerGoToStack`, `debuggerSetVariableValue` |
| `traces` · Traces (9) | nein | `tracesList`, `tracesListRequests`, `tracesHitList`, `tracesDbAccess`, `tracesStatements`, `tracesSetParameters`, `tracesCreateConfiguration`, `tracesDeleteConfiguration`, `tracesDelete` |

Destruktive Tools (`deleteObject`, `transportRelease`, `transportDelete`, `setObjectSource`, `editObjectSource`, `setMethodSource`, `atcApplyQuickfix`, `runClass`, `runSnippet`, `pushRepo`, `forceUnlock` und weitere) tragen `destructiveHint: true` für Hosts, die Genehmigungen an Annotationen knüpfen. Ein Tool kann aus zwei Gründen fehlen: sein Toolset ist nicht veröffentlicht (das Preset `focused` lässt `debugger`, `traces`, `git`, `rap`, `services`, `refactoring` und `discovery` weg; die Ablehnung nennt das Toolset), oder die Destination kann es nicht bedienen (`systemProfile` meldet, was fehlt; die Ablehnung sagt "not available on destination").

## Vergleich mit dem offiziellen ADT MCP Server von SAP

SAPs ADT MCP Server wird mit ADT für VS Code und Eclipse ausgeliefert und veröffentlicht unter dem Serverschlüssel `abap-adt` mit eigenen Tool-Namen, nach denen öffentliche Skills wie `claude-abap-skills` routen. Dieses Projekt veröffentlicht unter `abap-adt-mcp`, bedient viele Destinationen aus einem Prozess über stdio oder HTTP, setzt Richtlinien serverseitig durch und ergänzt Kompositionen wie `resolveTransport`, `editObjectSource`, `grepPackage`, `apiReleaseState`, `runSnippet` und `objectDiff`. Beide können nebeneinander im selben Host registriert werden, da Schlüssel und Tool-Namen nicht kollidieren. Dieses README katalogisiert nicht, was SAPs Server über diesen hinaus bietet; [docs/ROUTING.md](docs/ROUTING.md) bildet SAPs Namen auf unsere ab, wo es eine Entsprechung gibt. Einige Zeilen:

| Offizielles SAP-Tool / Fähigkeit | abap-adt-mcp-Tool(s) |
|---|---|
| `abap_lists_destinations` | `listSystems`, `systemProfile` |
| `SAPRead` / `abap_get_source` | `getObjectSource` (`version=inactive` für nicht aktivierten Code) |
| `SAPSearch` / `abap_search_objects` | `searchObject`; nach Inhalt `sourceTextSearch`, `grepPackage` |
| `abap_write_source` / `SAPWrite` | `setObjectSource` (`activate=true`), gezieltes `editObjectSource` |
| `abap_activate_objects` / `ActivatePackage` | `activateByName`, `activateObjects`, `inactiveObjects` |
| `abap_run_unit_tests` | `unitTestRun`, `unitTestEvaluation` |
| `abap_atc_run` / `abap_atc_findings` | `createAtcRun`, `atcWorklists`, `atcQuickfixProposals`, `atcApplyQuickfix`, `atcDocumentation` |
| `abap_transport-unifiedDifference` | `transportUnifiedDiff`, `transportDetails` |
| `abap_generators-*` | `rapGenIsAvailable`, `rapGenGetSchema`, `rapGenValidateContent`, `rapGenPreview`, `rapGenGenerate`, `rapGenPublishService` |
| `abap_lock` / `abap_unlock` | Für einzelne Schreibzugriffe nicht nötig (automatische Sperre); `lock`, `unLock`, `listLocks`, `forceUnlock` |
| `abap_dumps` | `dumps`, `dumpDetails` |
| Prüfung freigegebener APIs / Clean Core | `apiReleaseState` |

## Skills und Plugin

Zwei Agenten-Skills liegen unter `skills/`: `abap-adt-mcp` bringt dem Modell bei, mit diesen Tools ABAP zu entwickeln (Sitzungsbeginn, Code finden, der Änderungsablauf, Cloud-Bereitschaft, Fehler, Sicherheit), und `abap-adt-mcp-setup` führt durch Installation, Konfiguration und einen ersten Health-Check. Sie erreichen den Host über das Claude-Code-Plugin (`/plugin marketplace add williansaez/abap-adt-mcp`, dann `/plugin install abap-adt-mcp@abap-adt-mcp`, was auch den Server registriert), über den Dritt-Installer `npx skills add williansaez/abap-adt-mcp` oder durch Kopieren der beiden Verzeichnisse nach `~/.claude/skills/`; eine schlichte `npx`-Registrierung des Servers installiert keinen Skill, und die wesentlichen Abläufe kommen weiterhin über das Feld `instructions` des Servers und die [eingebauten Prompts](#eingebaute-prompts) an.

Dieses README gibt es auch auf [Englisch](README.md) und [Portugiesisch (Brasilien)](README.pt-BR.md); die englische Fassung ist die Referenz, und die erzeugten Zähler werden in alle drei synchronisiert. Was echte Sitzungen den Server gelehrt haben, steht in [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md), der Live-Testplan in [docs/TESTPLAN.md](docs/TESTPLAN.md), die Roadmap in [docs/ROADMAP.md](docs/ROADMAP.md) und die Releases in [CHANGELOG.md](CHANGELOG.md).

## Fehlerbehebung

- **Der Server erscheint nie im Host.** Lesen Sie das MCP-Protokoll des Hosts (Orte in [Schritt 2](#2-registrieren-sie-den-server-in-ihrem-host)). `spawn npx ENOENT`: Node.js ist nicht installiert oder nicht im PATH, den die App sieht; installieren Sie es oder tragen Sie den absoluten Pfad zu `npx` in `command` ein (`/usr/local/bin/npx` beim macOS-Installer, `/opt/homebrew/bin/npx` bei Homebrew). `EBADENGINE` im Protokoll: das vom Host gefundene Node ist älter als 22.12; installieren Sie das aktuelle LTS. `No ABAP systems configured`: `SAP_SYSTEMS_FILE` zeigt auf eine fehlende Datei. `is not valid JSON`: ein verirrtes Komma oder ein Windows-Pfad mit einfachen Backslashes. Claude Desktop liest die Konfiguration nur beim Start, beenden und öffnen Sie es also nach jeder Änderung neu.
- **Kein Browserfenster, oder SSO scheitert.** Ein Chromium-Browser muss installiert sein; `SAP_BROWSER_PATH` zeigt darauf, wenn die automatische Erkennung scheitert. Das Standardprofil des Browsers wird absichtlich abgelehnt; `SAP_BROWSER_PROFILE_DIR` benennt ein eigenes. Löschen Sie `~/.abap-adt-mcp/sso/<host>`, um sich von einem Tenant vollständig abzumelden.
- **Die Anmeldung funktioniert, danach ist alles "not authorized" oder "not found".** Die SSO-Sitzung ist auf einem anderen Mandanten gelandet, als `client` sagt: setzen Sie `client` auf den Anmeldemandanten des Tenants (der Eintrag "Über" im Benutzermenü des Launchpads zeigt ihn).
- **`kind: "sessionExpired"` kommt immer wieder.** Der Server hat bereits einmal neu authentifiziert und wiederholt; bitten Sie das Modell, `login` für diese Destination aufzurufen. Sperr-Handles der alten Sitzung sind ungültig (`kind: "staleLockHandle"`): erneut sperren.
- **`kind: "locked"` durch eine andere Sitzung.** `listLocks` zeigt die eigenen Sperren des Servers; steht das Objekt nicht dort, gehört die Sperre einer anderen Sitzung (Eclipse oder ein anderer Benutzer), und nur diese Sitzung oder `SM12` löst sie.
- **`editObjectSource` meldet 0 Treffer, oder mehrere.** Nichts wurde geschrieben. Der Anker muss der exakte aktuelle Text auf SAP sein, Einrückung eingeschlossen: lesen Sie mit `getObjectSource` neu und kopieren Sie ihn; bei mehreren Treffern nehmen Sie mehr umgebende Zeilen hinzu.
- **Tool als nicht verfügbar oder nicht aktiviert abgelehnt.** "Not available on destination": führen Sie `systemProfile` aus, dem Tenant fehlt diese ADT-Collection (`MCP_PROFILE_GATE=warn` protokolliert nur, `off` deaktiviert die Schranke). "Belongs to toolset ... which is not enabled": das Toolset fehlt in `MCP_TOOLSETS` (das Preset `focused` hat weder `debugger` noch `traces`); fügen Sie es hinzu oder verwenden Sie `MCP_TOOLSETS=all`. Ohne Debugger sind `dumps` und `dumpDetails` der Weg zur Ursache.
- **`kind: "policyDenied"`.** Die `policy` der Destination (oder `MCP_READ_ONLY`) verbietet den Aufruf, und die Meldung nennt die Schranke: die Leitplanke funktioniert. Passen Sie die Richtlinie an, wenn der Aufruf beabsichtigt war.
- **Der Start lehnt die Konfigurationsdatei ab.** Sie ist für andere Benutzer lesbar und enthält Passwörter im Klartext: `chmod 600` darauf, oder referenzieren Sie die Geheimnisse als `${env:VAR}`.
- **Zertifikatsfehler On-Premise (`kind: "tlsCertificate"`).** Der Hinweis nennt die Destination und die Lösung. Unbekannter Aussteller: geben Sie der Destination ihr CA-Bündel mit `tls.ca` (der Hinweis enthält die `openssl s_client`-Zeile). Namensabweichung (das System wird über IP-Adresse oder Kurznamen erreicht): setzen Sie `tls.servername` auf den `DNS:`-Namen, den die Meldung zitiert. Abgelaufen: nur eine Erneuerung in `STRUST` hilft. `insecureTls: true` (oder `SAP_TLS_INSECURE=1` im Altmodus) schaltet die Prüfung nur für diese Destination ab. `NODE_TLS_REJECT_UNAUTHORIZED=0` hilft nicht: der Server entfernt es.
- **Verbindungsfehler.** Prüfen Sie URL und Mandant, ADT-Berechtigungen, und On-Premise, dass `/sap/bc/adt` in `SICF` aktiv ist.
- **`runQuery` scheitert an einer Tabelle, die der Benutzer anzeigen kann.** Die Datenvorschau lehnt Tabellen mit eingeschränktem `dataMaintenance` ab; verwenden Sie `tableContents`. Eine Anweisung, die nach dem 255-Zeichen-Umbruch weiterhin scheitert, enthält ein einzelnes längeres Literal oder einen echten Syntaxfehler am genannten Token.
- **Tool-Schemata fressen das Kontextfenster.** Beginnen Sie mit `MCP_TOOLSETS=focused`, oder blenden Sie Toolsets aus (`MCP_DISABLED_TOOLSETS=debugger,traces`).

## Tests und Mitarbeit

```bash
git clone https://github.com/williansaez/abap-adt-mcp.git
cd abap-adt-mcp
npm ci
npm run build
npm test
```

Die Jest-Suiten decken Handler, Fehlerhinweise, Antwortgrößen, Toolsets und den Katalogvertrag gegen `docs/tools.snapshot.json` ab; die CI führt sie auf Node 22 und 24 aus, baut das Container-Image und prüft, dass es startet und Tools auflistet. Nach einer Änderung an Beschreibung oder Schema eines Tools führen Sie `npm run tools:docs` aus und committen die neu erzeugten `docs/TOOLS.md`, den Snapshot und die README-Zähler (die übersetzten READMEs eingeschlossen), sonst meldet die CI sie als veraltet; `npm run docs:check` führt die Dokumentationshygiene aus (keine Kundenkennungen, keine Geviertstriche, keine toten Links, jede Umgebungsvariable in `server.json` deklariert). Releases sind tag-gesteuert: npm per Trusted Publishing (GitHub OIDC, Provenance angehängt) plus das GHCR-Image. Forken, Branch anlegen, Pull Request öffnen. Sitzungsberichte für [docs/FIELD-NOTES.md](docs/FIELD-NOTES.md) sind willkommen, ohne Kundennamen, Tenants oder Transportnummern.

## Lizenz

[MIT](LICENSE). Aufgebaut auf [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) von Marcello Urbani. Wenn das Projekt Ihnen Zeit spart, können Sie [den Autor unterstützen](https://github.com/sponsors/williansaez).
