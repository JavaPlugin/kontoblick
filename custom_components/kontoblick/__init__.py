"""Kontoblick: liefert die Kontoblick-App aus und speichert ihre Daten in Home Assistant.

- App:       /kontoblick/index.html        (statische Dateien, ohne Daten)
- Daten-API: /api/kontoblick/data           (nur mit Home-Assistant-Token)
- Kalender:  calendar.kontoblick            (Abbuchungen, Eingänge, Kündigungsfristen)
"""
from __future__ import annotations

import json
import logging
import os

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.discovery import async_load_platform
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType

DOMAIN = "kontoblick"
IMPORT_FILE = "kontoblick_import.json"
_LOGGER = logging.getLogger(__name__)


def _read_json(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    store = Store(hass, 1, DOMAIN)
    data = await store.async_load()
    if not data or "docs" not in data:
        data = {"rev": 0, "docs": {}}
        path = hass.config.path(IMPORT_FILE)
        if os.path.exists(path):
            try:
                imported = await hass.async_add_executor_job(_read_json, path)
                data["docs"] = imported.get("docs", imported)
                _LOGGER.info("Kontoblick: %s Einträge aus %s übernommen", len(data["docs"]), IMPORT_FILE)
            except (OSError, ValueError):
                _LOGGER.exception("Kontoblick: %s konnte nicht gelesen werden", IMPORT_FILE)
        await store.async_save(data)

    state = {"store": store, "data": data, "listeners": []}
    hass.data[DOMAIN] = state
    hass.http.register_view(KontoblickDataView(state))

    www = os.path.join(os.path.dirname(__file__), "www")
    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths([StaticPathConfig("/kontoblick", www, False)])
    except ImportError:  # Home Assistant vor 2024.6
        hass.http.register_static_path("/kontoblick", www, False)

    hass.async_create_task(async_load_platform(hass, "calendar", DOMAIN, {}, config))
    return True


class KontoblickDataView(HomeAssistantView):
    """Liest und schreibt alle Kontoblick-Dokumente. Nur mit gültigem Token erreichbar."""

    url = "/api/kontoblick/data"
    name = "api:kontoblick:data"
    requires_auth = True

    def __init__(self, state: dict) -> None:
        self._state = state

    async def get(self, request):
        data = self._state["data"]
        return self.json({"rev": data["rev"], "docs": data["docs"]})

    async def post(self, request):
        try:
            body = await request.json()
        except ValueError:
            return self.json_message("Ungültiges JSON", 400)
        ops = body.get("ops") if isinstance(body, dict) else None
        if not isinstance(ops, list):
            return self.json_message("ops fehlt", 400)

        data = self._state["data"]
        prev = data["rev"]
        for op in ops:
            if not isinstance(op, dict):
                continue
            path = op.get("path")
            if not isinstance(path, str) or not path:
                continue
            if op.get("op") == "delete":
                data["docs"].pop(path, None)
            elif op.get("op") == "set" and isinstance(op.get("data"), dict):
                data["docs"][path] = op["data"]
        data["rev"] = prev + 1
        self._state["store"].async_delay_save(lambda: data, 1)
        for listener in list(self._state["listeners"]):
            listener()
        return self.json({"rev": data["rev"], "prev": prev})
