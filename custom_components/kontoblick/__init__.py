"""Kontoblick: liefert die Kontoblick-App aus und speichert ihre Daten in Home Assistant.

Jeder Home-Assistant-Benutzer hat seine eigenen Daten. Wer mit welchem Konto
angemeldet ist, ergibt sich aus dem Zugangs-Token. Andere Benutzer kommen an
diese Daten nicht heran.

- App:       /kontoblick/index.html             (statische Dateien, ohne Daten)
- Daten-API: /api/kontoblick/data                (nur die Daten des angemeldeten Benutzers)
- Push:      täglich 9:00 Uhr an den Benachrichtigungsdienst, den der Benutzer in der App wählt
"""
from __future__ import annotations

import json
import logging
import os
from datetime import timedelta

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .events import build_events, eur

DOMAIN = "kontoblick"
IMPORT_FILE = "kontoblick_import.json"
_LOGGER = logging.getLogger(__name__)


def _read_json(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


class KontoblickData:
    """Speicher: {"users": {user_id: {"rev": int, "docs": {...}}}, "unassigned": {...} | None}."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        # Version bleibt 1: Home Assistant verlangt sonst eine Migrationsfunktion.
        # Der Umbau vom gemeinsamen auf getrennte Bestände passiert in async_load.
        self.store = Store(hass, 1, DOMAIN)
        self.data: dict = {"users": {}, "unassigned": None}

    async def async_load(self) -> None:
        raw = await self.store.async_load()
        if raw and "users" in raw:
            self.data = raw
            return
        legacy = None
        if raw and "docs" in raw:  # Version 1: ein gemeinsamer Datenbestand
            legacy = {"rev": raw.get("rev", 0), "docs": raw["docs"]}
        else:
            path = self.hass.config.path(IMPORT_FILE)
            if os.path.exists(path):
                try:
                    imported = await self.hass.async_add_executor_job(_read_json, path)
                    legacy = {"rev": 0, "docs": imported.get("docs", imported)}
                except (OSError, ValueError):
                    _LOGGER.exception("Kontoblick: %s konnte nicht gelesen werden", IMPORT_FILE)
        if legacy:
            owner = await self.hass.auth.async_get_owner()
            if owner:
                self.data["users"][owner.id] = legacy
                _LOGGER.info("Kontoblick: bisherige Daten dem Besitzer %s zugeordnet", owner.name)
            else:
                self.data["unassigned"] = legacy
        await self.store.async_save(self.data)

    def for_user(self, user) -> dict:
        users = self.data["users"]
        if user.id not in users:
            if self.data.get("unassigned") and user.is_admin:
                users[user.id] = self.data["unassigned"]
                self.data["unassigned"] = None
                _LOGGER.info("Kontoblick: bisherige Daten dem Administrator %s zugeordnet", user.name)
            else:
                users[user.id] = {"rev": 0, "docs": {}}
            self.save()
        return users[user.id]

    def save(self) -> None:
        self.store.async_delay_save(lambda: self.data, 1)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    store = KontoblickData(hass)
    await store.async_load()
    hass.data[DOMAIN] = store

    hass.http.register_view(KontoblickDataView(store))
    hass.http.register_view(KontoblickNotifyView(store))

    www = os.path.join(os.path.dirname(__file__), "www")
    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths([StaticPathConfig("/kontoblick", www, False)])
    except ImportError:  # Home Assistant vor 2024.6
        hass.http.register_static_path("/kontoblick", www, False)

    @callback
    def _daily(now) -> None:
        for user_id, entry in store.data["users"].items():
            hass.async_create_task(_async_notify_user(hass, user_id, entry["docs"]))

    async_track_time_change(hass, _daily, hour=9, minute=0, second=0)
    return True


def _reminder_text(docs: dict) -> tuple[str, str] | None:
    """Text für die heutige Erinnerung, oder None, wenn nichts ansteht."""
    cfg = docs.get("config/main") or {}
    try:
        days = max(0, min(30, int(cfg.get("remindDays", 2))))
    except (TypeError, ValueError):
        days = 2
    today = dt_util.now().date()
    target = today + timedelta(days=days)
    debits = [e for e in build_events(docs, target, target) if e.kind in ("expense", "saving")]
    deadlines = [e for e in build_events(docs, today + timedelta(days=14), today + timedelta(days=14)) if e.kind == "deadline"]
    lines = []
    if debits:
        when = {0: "Heute", 1: "Morgen", 2: "Übermorgen"}.get(days, f"Am {target:%d.%m.}")
        total = sum(e.amount for e in debits)
        lines.append(f"{when} gehen {eur(total)} ab:")
        lines += [f"• {e.name} −{eur(e.amount)}" for e in debits]
    for e in deadlines:
        lines.append(f"Kündigungsfrist {e.name}: noch 14 Tage (bis {e.day:%d.%m.})")
    if not lines:
        return None
    title = "Kontoblick: Abbuchung" if debits else "Kontoblick: Kündigungsfrist"
    return title, "\n".join(lines)


async def _async_notify_user(hass: HomeAssistant, user_id: str, docs: dict, test: bool = False) -> str:
    cfg = docs.get("config/main") or {}
    service = cfg.get("notifyService")
    if not service or not hass.services.has_service("notify", service):
        return "no_service"
    text = ("Kontoblick", "Testnachricht: Erinnerungen kommen ab jetzt auf dieses Gerät.") if test else _reminder_text(docs)
    if not text:
        return "nothing"
    try:
        await hass.services.async_call("notify", service, {"title": text[0], "message": text[1]}, blocking=True)
    except Exception:  # noqa: BLE001 – ein fehlerhafter Dienst darf andere Benutzer nicht stören
        _LOGGER.exception("Kontoblick: Benachrichtigung über notify.%s fehlgeschlagen", service)
        return "error"
    return "sent"


class KontoblickDataView(HomeAssistantView):
    """Liest und schreibt die Kontoblick-Dokumente des angemeldeten Benutzers."""

    url = "/api/kontoblick/data"
    name = "api:kontoblick:data"
    requires_auth = True

    def __init__(self, store: KontoblickData) -> None:
        self._store = store

    async def get(self, request):
        user = request["hass_user"]
        entry = self._store.for_user(user)
        return self.json({"rev": entry["rev"], "docs": entry["docs"], "user": user.name})

    async def post(self, request):
        try:
            body = await request.json()
        except ValueError:
            return self.json_message("Ungültiges JSON", 400)
        ops = body.get("ops") if isinstance(body, dict) else None
        if not isinstance(ops, list):
            return self.json_message("ops fehlt", 400)

        entry = self._store.for_user(request["hass_user"])
        prev = entry["rev"]
        for op in ops:
            if not isinstance(op, dict):
                continue
            path = op.get("path")
            if not isinstance(path, str) or not path:
                continue
            if op.get("op") == "delete":
                entry["docs"].pop(path, None)
            elif op.get("op") == "set" and isinstance(op.get("data"), dict):
                entry["docs"][path] = op["data"]
        entry["rev"] = prev + 1
        self._store.save()
        return self.json({"rev": entry["rev"], "prev": prev})


class KontoblickNotifyView(HomeAssistantView):
    """Verfügbare Handys auflisten (GET) und eine Testnachricht senden (POST)."""

    url = "/api/kontoblick/notify"
    name = "api:kontoblick:notify"
    requires_auth = True

    def __init__(self, store: KontoblickData) -> None:
        self._store = store

    async def get(self, request):
        hass = self._store.hass
        services = sorted(s for s in hass.services.async_services().get("notify", {}) if s.startswith("mobile_app_"))
        return self.json({"services": services})

    async def post(self, request):
        user = request["hass_user"]
        entry = self._store.for_user(user)
        result = await _async_notify_user(self._store.hass, user.id, entry["docs"], test=True)
        return self.json({"result": result})
