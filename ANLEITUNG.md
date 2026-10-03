# Kontoblick in Home Assistant

Die App läuft danach im Vollbild auf dem iPhone, ohne claude.ai-Leiste. Die Daten liegen in deinem Home Assistant.
Jeder Home-Assistant-Benutzer hat eigene Daten. Erinnerungen vor Abbuchungen kommen per Push über die Companion-App.

Voraussetzungen: Home Assistant 2024.10 oder neuer, HACS installiert.

## 1. Über HACS installieren

1. HACS → oben rechts ⋮ → „Benutzerdefinierte Repositories“.
2. `https://github.com/JavaPlugin/kontoblick` eintragen, Typ „Integration“ → „Hinzufügen“.
3. Kontoblick in HACS suchen → „Herunterladen“.

**Bisher von Hand installiert?** Einfach genauso vorgehen. HACS ersetzt den Ordner `custom_components/kontoblick`.
Deine Daten liegen separat in `/config/.storage/kontoblick` und bleiben erhalten.

**Bisherige Daten übernehmen (nur bei einer Neuinstallation):**
Die Datei `kontoblick_import.json` vor dem ersten Start nach `/config/` legen.

## 2. Integration einschalten

In `/config/configuration.yaml` diese Zeile ergänzen:

```yaml
kontoblick:
```

Dann Home Assistant neu starten: Einstellungen → System → oben rechts ⋮ → Neu starten.

Beim ersten Start übernimmt Kontoblick die Daten aus `kontoblick_import.json`.
**Danach die Datei `kontoblick_import.json` löschen.** Deine Daten liegen jetzt geschützt in `/config/.storage/kontoblick`.

## 3. Zugangs-Token erstellen

In Home Assistant auf dein Profil (unten links) → Reiter „Sicherheit“ → „Langlebige Zugangs-Token“ → „Token erstellen“, Name „Kontoblick“.
Token kopieren. Er wird nur einmal angezeigt.

## 4. Auf dem iPhone installieren

1. In **Safari** öffnen: `https://DEINE-HOME-ASSISTANT-ADRESSE/kontoblick/index.html`
   Nimm die Adresse, die auch unterwegs funktioniert, z. B. deine Nabu-Casa-Adresse `https://xxxx.ui.nabu.casa/kontoblick/index.html`.
2. Token einfügen → „Verbinden“.
3. Teilen-Symbol → „Zum Home-Bildschirm“ → „Hinzufügen“.

Ab jetzt startet Kontoblick wie eine normale App im Vollbild.
Ohne Netz zeigt die App den letzten Stand. Neue Buchungen werden gespeichert, sobald wieder eine Verbindung besteht.

## 5. Push-Erinnerungen einschalten

In der App unter **Planung → Erinnerungen** dein Handy auswählen und auf „Testnachricht senden“ tippen.
Ab dann schickt Kontoblick täglich um 9 Uhr eine Nachricht:
- vor jeder Abbuchung mit Datum, so viele Tage vorher wie unter „Warnung Tage vorher“ eingestellt
- 14 Tage vor jeder Kündigungsfrist

Eine eigene Automation ist dafür nicht nötig.
**Von Version 1.0 umgestiegen?** Die alte Automation „Kontoblick Erinnerung“ löschen. Den Kalender `calendar.kontoblick` gibt es nicht mehr.

## Mehrere Benutzer

Jeder Home-Assistant-Benutzer hat in Kontoblick seine eigenen Daten.
Welche Daten die App zeigt, hängt am Zugangs-Token: Er gehört immer zu dem Benutzer, der ihn erstellt hat.
Andere Benutzer kommen an diese Daten nicht heran, auch Administratoren nicht über die App.

Für eine weitere Person:
1. Die Person meldet sich in Home Assistant mit **ihrem eigenen** Konto an und erstellt dort ihren Token.
2. Dann installiert sie die App wie in Schritt 4 beschrieben. Sie startet mit einem leeren Kontoblick.

Daten aus Version 1.0 gehören nach dem Update dem Besitzer der Home-Assistant-Installation, also dem Konto, das sie eingerichtet hat.

## Gut zu wissen

- **Neues Gerät:** Den Token änderst du in der App unter Planung → Verbindung → Abmelden.
  Danach mit einem neuen Token wieder verbinden.
- **Sicherheit:** Die App-Dateien unter `/kontoblick/` enthalten keine Daten.
  Die Daten gibt Home Assistant nur mit gültigem Token heraus.
- **Updates:** Neue Versionen erscheinen unter Einstellungen als „Update verfügbar: Kontoblick“ → „Aktualisieren“.
  Danach will Home Assistant meist neu starten. Die App auf dem iPhone lädt die neue Version beim nächsten Öffnen.
