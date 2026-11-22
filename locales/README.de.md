# ST-NPC-Book

**ST-NPC-Book** ist eine Erweiterung für [SillyTavern](https://github.com/SillyTavern/SillyTavern) zur automatisierten Verwaltung von Charakterzuständen und NPCs. Entwickelt vor allem für **Multi-Charakter-Karten, Open-World-RPGs, Erzähler-/GM-Setups und lange Kampagnen (Slow-Burn)**, erstellt und aktualisiert die Erweiterung in frei definierbaren Nachrichten-Blöcken vollautomatisch **einzelne, Keyword-gesteuerte Lorebook-Einträge (World Info) für jeden NPC** über eine zweistufige LLM-Pipeline.

---

## 💡 Motivation & Hintergrund (Warum ST-NPC-Book?)

In langen Rollenspielen über hunderte Nachrichten hinweg veralten statische Charakterbeschreibungen schnell: Beziehungen verändern sich, Charaktere wechseln den Ort oder die Kleidung, erfahren Geheimnisse, werden verletzt oder verfolgen neue Ziele.

Zuvor habe ich **ST-Memory-Books** mit eigenen Prompts genutzt, um ein „NPC-Tagebuch" im Chat-Lorebook zu führen. Das hat grundsätzlich gut funktioniert, hatte aber durch die dortige Struktur einen entscheidenden Nachteil: **Es wurden immer alle NPCs auf einmal aktualisiert – oder gar keiner.**
- Da dort alles in einem großen Sammel-Durchgang (bzw. einem monolithischen Eintrag) verarbeitet wird, musste bei jedem Update der gesamte Cast neu geschrieben werden.
- Liegen 10–20 NPCs in einem einzigen, dauerhaft aktiven Lorebook-Eintrag, verschwendet das enorm viele Kontext-Tokens für Charaktere, die in der aktuellen Szene überhaupt nicht anwesend sind. Zudem neigen LLMs dazu, Details von Charakteren, die seit 30 Nachrichten nicht mehr aufgetaucht sind, bei jedem Neuschreiben weiter zu kürzen oder ganz zu vergessen.
- Nutzt man hingegen klassische einzelne Lorebook-Einträge pro Charakter, bleiben diese komplett statisch und entwickeln sich nie weiter.

**Was ST-NPC-Book anders macht:**
1. **Ein eigener Keyword-gesteuerter Lorebook-Eintrag pro NPC (`[NPC] {{name}}`):** Jeder Charakter erhält seinen eigenen Eintrag im Chat-Lorebook. Ist ein NPC in der aktuellen Szene nicht präsent, schläft sein Eintrag und verbraucht **null Tokens**. Sobald sein Name oder Spitzname fällt, wird sein aktueller Stand automatisch geladen.
2. **Gezielte Updates statt Sammel-Abfragen (2-stufige Pipeline):** Anstatt jedes Mal alle Charaktere neu zu generieren, prüft **Schritt 1 (Scanner)** den neuen Nachrichten-Block gegen die Liste der bereits bekannten NPCs und filtert *nur* die Charaktere heraus, die tatsächlich vorkamen oder sich verändert haben. **Schritt 2 (Zusammenfassung / Scribe)** aktualisiert oder erstellt anschließend parallel nur genau diese betroffenen NPCs – alle anderen Einträge bleiben unberührt.
3. **Aktueller Zustands-Snapshot statt Endlos-Historie:** Die Zusammenfassung ist darauf ausgelegt, veraltete Zustände (aktueller Aufenthaltsort, Kleidung, körperlicher Zustand, Haltung gegenüber `{{user}}`, aktuelle Ziele) gezielt zu *überschreiben*, anstatt Einträge endlos aufzublähen.
4. **Atomare Ausführung & 1-Klick-Rollback:** Schlägt eine API-Anfrage fehl oder liefert das LLM eine leere Antwort, wird der gesamte Block sauber abgebrochen, ohne das Lorebook zu beschädigen oder den Nachrichten-Zähler weiterzusetzen. Über den integrierten Snapshot lässt sich der letzte Block jederzeit **rückgängig machen** oder **neu generieren**.
5. **100 % frei einstellbar:** Sämtliche Parameter lassen sich anpassen – von der Blockgröße (Nachrichten-Intervall & Offset) über getrennte LLM-Verbindungsprofile für Schritt 1 und Schritt 2, die Anzahl paralleler Anfragen und sämtliche Lorebook-Parameter (Position, Tiefe, Scan-Tiefe, Sticky) bis hin zu allen System-Prompts und der Ausgabevorlage.

---

## ⚙️ Funktionsweise der 2-stufigen Pipeline

Alle **`Nachrichten-Intervall`** Nachrichten (Standard: `30`, zuzüglich eines einstellbaren **`Nachrichten-Offsets`** von z. B. `10` Nachrichten als Puffer, damit die aktuelle Szene erst abgeschlossen wird) verarbeitet `ST-NPC-Book` den nächsten fälligen Chat-Block:

1. **Schritt 1 — LLM für den Scanner (JSON-Erkennung):**
   - Erhält eine kompakte JSON-Liste aller bereits im Lorebook geführten `[NPC]`-Einträge (`uid`, `name`, `keys`) sowie das Transkript des neuen Nachrichten-Blocks.
   - Gibt ein striktes JSON-Objekt (`{ "update": [...], "create": [...] }`) zurück, das festlegt, welche bestehenden NPCs aktualisiert werden müssen, welche neuen wiederkehrenden Charaktere einen eigenen Eintrag erhalten und welche neuen Keywords/Spitznamen hinzugekommen sind.
2. **Schritt 2 — LLM für die NPC-Zusammenfassungen (Parallele Worker):**
   - Startet bis zu `Max. parallele Anfragen` gleichzeitig (eine Anfrage pro betroffenem NPC).
   - Für **neue NPCs** wird anhand der Ausgabevorlage ein neues Profil erstellt.
   - Für **vorhandene NPCs** wird das bestehende Profil zusammen mit dem neuen Nachrichten-Block geladen und auf den neuesten Stand gebracht.
3. **Atomares Speichern im Lorebook:**
   - Sobald alle Antworten vorliegen, bereinigt und führt die Erweiterung die Trigger-Keywords zusammen (entfernt automatisch `{{user}}`, Duplikate und 1-Zeichen-Fragmente), schreibt alle Änderungen in einem einzigen Speichervorgang ins aktive Chat-Lorebook, legt einen Rollback-Snapshot an und setzt den Zähler für die letzte gescannte Nachricht hoch.

---

## 📦 Installation

1. Öffne **SillyTavern**.
2. Wechsle oben in den Reiter **Erweiterungen (Extensions)** $\rightarrow$ **Erweiterung installieren (Install Extension)**.
3. Füge die Repository-URL ein:
   ```text
   https://github.com/Arczium/ST-NPC-Book
   ```
4. Klicke auf **Installieren** und lade SillyTavern neu (`F5`).
5. Öffne das **Erweiterungsmenü** (Zauberstab-Symbol neben dem Chat-Eingabefeld) und klicke auf **NPC-Book**, um die Einstellungen und Steuerung zu öffnen.

---

## 🛠️ Empfohlener Umgang mit bestehenden Charakterkarten & Lorebooks

`ST-NPC-Book` ist primär für **Multi-Charakter-Karten, offene Welten und RPG-/Erzähler-Karten** konzipiert. Wenn du die Erweiterung mit einer bestehenden Charakterkarte oder einem Lorebook nutzt, in dem bereits wichtige Charaktere fest hinterlegt sind, solltest du folgenden Punkt beachten:

> ⚠️ **Doppelte und widersprüchliche Charakterdaten vermeiden!**
> Wenn die ursprüngliche Beschreibung eines Charakters fest in der Charakterkarte (`Description` / `Scenario`) oder einem statischen Lorebook verbleibt, während `ST-NPC-Book` denselben Charakter dynamisch unter `[NPC] Name` im Chat-Lorebook pflegt, erhält das LLM im Prompt zwei unterschiedliche Versionen desselben Charakters. Das kostet unnötig Tokens und führt bei Weiterentwicklungen unweigerlich zu Widersprüchen.

### Best Practice für Bestands-Charaktere (5–10 Minuten Vorarbeit vor Kampagnenstart)
Da SillyTavern Weltenbau, Regeln und Charakterbeschreibungen in freien Textfeldern mischt, löscht `ST-NPC-Book` bewusst nichts automatisch aus deinen Originalkarten. Für ein sauberes Setup empfiehlt sich folgender manueller Ablauf:

1. **Chat-Lorebook verbinden:** Starte den Chat, öffne **NPC-Book** und klicke bei *Aktives Chat-Lorebook* auf **Neu erstellen** (oder lass es beim ersten Trigger über den Dialog als `~{{char}}_{{date}}` anlegen).
2. **Vorhandene Charaktere einmalig manuell anlegen:**
   - Lege für bereits bestehende Haupt- oder Nebencharaktere, die sich im Laufe der Geschichte weiterentwickeln sollen, einmalig manuell einen Eintrag im Chat-Lorebook mit dem Titel `[NPC] CharakterName` (passend zu deiner *Vorlage für Titel*) und den entsprechenden Keywords an.
   - Übertrage die Startbeschreibung des Charakters in diesen `[NPC]`-Eintrag (idealerweise schon grob in der Struktur deiner Ausgabevorlage).
3. **Charakterkarte / statisches Lorebook bereinigen:**
   - Entferne anschließend die statische Charakterbeschreibung aus der Charakterkarte bzw. deaktiviere/lösche den doppelten Eintrag im angehängten Charakter-Lorebook, sodass in der Karte selbst nur noch das Welten-Setup und allgemeine Regeln stehen.
   - *(Tipp: Mach dir vorher eine Kopie der Karte oder lade sie für einen späteren Neustart einfach frisch herunter).*

Ab diesem Zeitpunkt ist der `[NPC]`-Eintrag im Chat-Lorebook die einzige Wahrheitsquelle (*Single Source of Truth*) und wird von `ST-NPC-Book` automatisch aktuell gehalten.

---

## 🖥️ Übersicht aller Einstellungen & Steuerungen

Das Menü öffnest du über das **Zauberstab-Menü $\rightarrow$ NPC-Book**. Es ist in drei Reiter unterteilt:

### Reiter 1: Zeitplan & Lorebook

#### Allgemeines & Scan-Intervall
| Einstellung | Standardwert | Beschreibung |
| :--- | :--- | :--- |
| **NPC-Book aktiv** | `An` | Prüft nach jeder neuen KI-Antwort automatisch, ob ein neuer Nachrichten-Block zum Scannen fällig ist. |
| **Benachrichtigungen anzeigen** | `An` | Zeigt Status- und Fortschrittsmeldungen während des Scans an (kritische Fehlermeldungen werden immer angezeigt). |
| **Nachfragen, wenn Chat kein Lorebook hat** | `An` | Öffnet einen 3-Optionen-Dialog (*Neues Lorebook erstellen*, *Mit bestehendem verbinden*, *Für diesen Chat ignorieren*), falls beim Scan noch kein Lorebook zugewiesen ist. |
| **Gewünschte Sprache** | `Auto` | Wechselt die Sprache der Oberfläche (`Auto`, `English`, `Deutsch`) sofort live ohne Neustart. |
| **Namensformat für neue Lorebooks** | `~{{char}}_{{date}}` | Namensvorlage beim automatischen Anlegen eines neuen Chat-Lorebooks. |
| **Nachrichten-Intervall** | `30` (1–500) | **Anzahl der Nachrichten, die pro Scan-Block zusammengefasst werden** (z. B. `0..30`, `30..60`). |
| **Nachrichten-Offset** | `10` (0–200) | **Anzahl der Nachrichten am Ende des Chats, die als Puffer noch nicht verarbeitet werden** (bei Intervall `30` + Offset `10` wird Block `0..30` erst gescannt, sobald Nachricht `#40` erreicht ist). |

#### Manuelle Steuerung & Rollback-Funktionen
- ⚡ **Überfälligen Block jetzt scannen:** Startet sofort manuell den Scan für den nächsten ungescannten Nachrichten-Block.
- ⏩ **Alle Blöcke aufholen (N):** Arbeitet in bereits laufenden, langen Chats nacheinander alle fälligen Blöcke ab (wechselt währenddessen auf **Nach aktuellem Block stoppen**, um den Durchlauf jederzeit sauber nach dem laufenden Block zu pausieren).
- ↩️ **Letzte Generierung rückgängig:** Stellt alle im letzten Block geänderten `[NPC]`-Einträge auf ihren exakten vorherigen Stand zurück, löscht im letzten Block neu angelegte `[NPC]`-Einträge und setzt den Nachrichten-Zähler zurück.
- 🔄 **Letzten Block neu generieren:** Macht den letzten Block rückgängig und lässt genau diesen Nachrichtenbereich sofort noch einmal neu scannen.
- 🗑️ **Reset: Alle NPC-Einträge löschen und letzte gescannte Nachricht auf 0 setzen:** Löscht nach Sicherheitsabfrage alle verwalteten `[NPC]`-Einträge aus dem gebundenen Chat-Lorebook (andere Einträge im Lorebook bleiben unberührt) und setzt den Scan-Zähler auf `0`.

#### Lorebookverwaltung (Standardwerte für erstellte/aktualisierte NPC-Einträge)
| Einstellung | Standardwert | Beschreibung |
| :--- | :--- | :--- |
| **Vorlage für Titel** | `[NPC] {{name}}` | Namensschema, über das verwaltete NPC-Einträge im Lorebook erkannt werden. |
| **Aktivierung durch** | `Normal (Keyword)` | `Normal (Keyword)`, `Konstant (Immer aktiv)` oder `Vektorisiert (RAG)`. |
| **Position** | `Nach World-Info ( ↓Char )` | Einfügeposition im Prompt (`Vor/Nach World-Info`, `Vor/Nach Author's Note`, `Im Chat @ Tiefe`, `Beginn/Ende des System-Prompts`). |
| **Chat-Tiefe / Chat-Rolle** | `Tiefe 10` / `System` | Wird eingeblendet, wenn als Position `Im Chat @ Tiefe` gewählt ist. |
| **Reihenfolge (Order)** | `100` | Einfüge-Priorität innerhalb von SillyTaverns World-Info-Logik. |
| **Scan-Tiefe (Scan Depth)** | `10` | Wie viele der letzten Nachrichten SillyTavern nach den Keywords des NPCs durchsucht. |
| **Sticky-Dauer (Runden)** | `0` | Wie viele Runden ein ausgelöster NPC-Eintrag ohne erneutes Keyword aktiv bleibt. |
| **Lorebook Token-Budget ignorieren** | `Aus` | Legt fest, ob NPC-Einträge das globale World-Info-Tokenlimit ignorieren sollen. |

### Reiter 2: LLM-Agenten
Hier können für Schritt 1 und Schritt 2 getrennte Profile aus dem **SillyTavern Connection Manager** zugewiesen werden (oder `-- Aktive ST-API / Standard --` für die aktuell im Chat aktive Verbindung):

| Einstellung | Standardwert | Beschreibung |
| :--- | :--- | :--- |
| **Scanner — Verbindungsprofil** | `Aktive ST-API` | Verbindungsprofil für die JSON-Erkennung in Schritt 1. |
| **Scanner — Max. Ausgabe-Tokens / Temp.** | `2000` / `0.1` | Token-Limit und Temperatur für Schritt 1 (niedrige Temperatur für stabiles JSON empfohlen). |
| **Scribe — Verbindungsprofil** | `Aktive ST-API` | Verbindungsprofil für das Erstellen und Aktualisieren der NPC-Profile in Schritt 2. |
| **Max. parallele Anfragen** | `3` (1–10) | Wie viele NPC-Zusammenfassungen in Schritt 2 gleichzeitig parallel generiert werden. |
| **Scribe — Max. Ausgabe-Tokens / Temp.** | `5000` / `0.3` | Token-Limit und Temperatur pro NPC-Anfrage in Schritt 2. |

### Reiter 3: Prompts
Alle vier System-Prompts sowie die Ausgabevorlage lassen sich frei bearbeiten und jederzeit per Klick auf **`Standard wiederherstellen`** auf die Werkseinstellungen zurücksetzen:
1. **System-Prompt Scanner** (`prompt_scanning`)
2. **System-Prompt neue NPCs** (`prompt_creation`)
3. **System-Prompt Aktualisierung vorhandener NPCs** (`prompt_updating`)
4. **NPC-Profil Ausgabevorlage** (`prompt_output_template`)

### Slash-Command
Scans lassen sich auch direkt über die Chat-Eingabezeile oder Quick Replies auslösen:
- `/npc-scan` — Scannt den nächsten fälligen Nachrichten-Block.
- `/npc-scan <start> <ende>` — Scannt manuell einen bestimmten Nachrichtenbereich (z. B. `/npc-scan 0 30`).

---

## 📜 Lizenz

Dieses Projekt ist unter der **GNU Affero General Public License v3.0 (AGPL-3.0)** lizenziert. Weitere Details finden sich in der Datei [LICENSE](../LICENSE).