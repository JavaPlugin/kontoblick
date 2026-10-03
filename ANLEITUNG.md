# Kontoblick in Home Assistant

Die App läuft danach im Vollbild auf dem iPhone, ohne claude.ai-Leiste. Die Daten liegen in deinem Home Assistant.
Erinnerungen vor Abbuchungen schickt Home Assistant per Push über die Companion-App.

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

## 5. Push-Erinnerungen einrichten

Einstellungen → Automationen & Szenen → „Automation erstellen“ → „Neue Automation“ → oben rechts ⋮ → „In YAML bearbeiten“.
Folgendes einfügen und `notify.mobile_app_DEIN_IPHONE` durch deinen Dienst ersetzen.
Du findest ihn unter Entwicklerwerkzeuge → Aktionen, Suche nach „mobile_app“.

```yaml
alias: Kontoblick Erinnerung
description: Push 2 Tage vor jeder Abbuchung (9 Uhr) und 14 Tage vor Kündigungsfristen
triggers:
  - trigger: calendar
    event: start
    entity_id: calendar.kontoblick
    offset: "-39:00:00"
    id: abbuchung
  - trigger: calendar
    event: start
    entity_id: calendar.kontoblick
    offset: "-327:00:00"
    id: kuendigung
conditions:
  - condition: template
    value_template: >
      {% set s = trigger.calendar_event.summary %}
      {{ (trigger.id == 'abbuchung' and not s.startswith('+') and not s.startswith('Kündigungsfrist'))
         or (trigger.id == 'kuendigung' and s.startswith('Kündigungsfrist')) }}
actions:
  - action: notify.mobile_app_DEIN_IPHONE
    data:
      title: >
        {{ 'Kündigungsfrist in 14 Tagen' if trigger.id == 'kuendigung' else 'Abbuchung übermorgen' }}
      message: >
        {{ trigger.calendar_event.summary }} am {{ as_timestamp(trigger.calendar_event.start) | timestamp_custom('%d.%m.') }}
mode: queued
```

So kommen die Uhrzeiten zustande: Termine beginnen um 0:00 Uhr. `-39:00:00` ergibt 9:00 Uhr zwei Tage vorher, `-327:00:00` ergibt 9:00 Uhr 14 Tage vorher.

## Gut zu wissen

- **Kalender:** Alle Posten mit Abbuchungstag erscheinen im Kalender `calendar.kontoblick`, dazu die Kündigungsfristen.
  Änderungen in der App sind sofort im Kalender.
- **Neues Gerät:** Den Token änderst du in der App unter Planung → Verbindung → Abmelden.
  Danach mit einem neuen Token wieder verbinden.
- **Sicherheit:** Die App-Dateien unter `/kontoblick/` enthalten keine Daten.
  Die Daten gibt Home Assistant nur mit gültigem Token heraus.
- **Updates:** Neue Versionen erscheinen unter Einstellungen als „Update verfügbar: Kontoblick“ → „Aktualisieren“.
  Danach will Home Assistant meist neu starten. Die App auf dem iPhone lädt die neue Version beim nächsten Öffnen.
