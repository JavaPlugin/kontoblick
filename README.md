# Kontoblick

Persönlicher Finanzplaner von Gehalt zu Gehalt, als Web-App für den iPhone-Home-Bildschirm.
Die Daten liegen in Home Assistant.

- **App:** `https://<home-assistant>/kontoblick/index.html`, Vollbild, offline nutzbar
- **Daten:** in Home Assistant gespeichert, nur mit Zugangs-Token abrufbar
- **Kalender:** `calendar.kontoblick` mit Abbuchungen, Eingängen und Kündigungsfristen, für Push-Erinnerungen per Automation

## Installation über HACS

1. HACS → oben rechts ⋮ → „Benutzerdefinierte Repositories“.
2. `https://github.com/JavaPlugin/kontoblick` eintragen, Typ „Integration“ → „Hinzufügen“.
3. Kontoblick in HACS suchen → „Herunterladen“.
4. In `configuration.yaml` die Zeile `kontoblick:` ergänzen und Home Assistant neu starten.

Updates erscheinen danach unter Einstellungen als „Update verfügbar“.

Einrichtung der App, des Tokens und der Push-Erinnerungen: siehe [ANLEITUNG.md](ANLEITUNG.md).

## Entwicklung

- `src/kontoblick.html`: die App selbst
- `src/ha-adapter.js`: Speicherung über Home Assistant
- `src/ha-shell.txt`: iPhone-Rahmen und Anmeldung
- `custom_components/kontoblick/`: die Integration

```bash
node tools/build.js 1.0.1
```

Der Befehl baut `custom_components/kontoblick/www/` neu und setzt die Version.
