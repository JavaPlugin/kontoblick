"""Kalender calendar.kontoblick: Abbuchungen, Eingänge und Kündigungsfristen aus Kontoblick."""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.core import HomeAssistant, callback
from homeassistant.util import dt as dt_util

from . import DOMAIN

INTERVAL = {"monthly": 1, "quarterly": 3, "halfyearly": 6, "yearly": 12}


async def async_setup_platform(hass: HomeAssistant, config, async_add_entities, discovery_info=None):
    if discovery_info is None:
        return
    async_add_entities([KontoblickCalendar(hass)], True)


def _eur(value: float) -> str:
    text = f"{abs(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{text} €"


def _resolve(doc: dict, key: str) -> dict | None:
    """Stand eines Postens für den Monat key (YYYY-MM), inkl. Versionen ab einem Monat."""
    versions = doc.get("versions")
    if not versions:
        return doc
    current = None
    for version in versions:
        if (version.get("vfrom") or "0000-00") <= key:
            current = version
    if not current or current.get("removed"):
        return None
    return current


def _months(start: date, end: date):
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield y, m
        m += 1
        if m > 12:
            y, m = y + 1, 1


def build_events(docs: dict, start: date, end: date) -> list[CalendarEvent]:
    items = {path.split("/", 1)[1]: doc for path, doc in docs.items() if path.startswith("items/")}
    events: list[CalendarEvent] = []
    for y, m in _months(start, end):
        key = f"{y:04d}-{m:02d}"
        last = monthrange(y, m)[1]
        for item_id, doc in items.items():
            it = _resolve(doc, key)
            if not it or it.get("paused"):
                continue
            if it.get("from") and key < it["from"]:
                continue
            if it.get("until") and key > it["until"]:
                continue
            name = it.get("name") or "Posten"

            deadline_day, deadline_month = it.get("cancelDay"), it.get("cancelMonth")
            if deadline_day and deadline_month == m:
                day = date(y, m, min(int(deadline_day), last))
                if start <= day <= end:
                    events.append(CalendarEvent(
                        start=day, end=day + timedelta(days=1),
                        summary=f"Kündigungsfrist: {name}",
                        description=it.get("cancelNote") or "Letzter Tag zum Kündigen",
                        uid=f"{item_id}-kuendigung-{y}",
                    ))

            n = INTERVAL.get(it.get("interval") or "monthly", 1)
            if n > 1 and (m - int(it.get("month") or 1)) % n != 0:
                continue
            if not it.get("day"):
                continue
            day = date(y, m, min(int(it["day"]), last))
            if not start <= day <= end:
                continue
            amount = float(it.get("amount") or 0)
            kind = it.get("kind")
            if kind == "income":
                summary = f"+ {name} {_eur(amount)}"
                description = "Erwarteter Eingang"
            else:
                summary = f"{name} −{_eur(amount)}"
                description = "Sparrate" if kind == "saving" else "Abbuchung"
            if it.get("dayNote"):
                description += f" · {it['dayNote']}"
            events.append(CalendarEvent(
                start=day, end=day + timedelta(days=1),
                summary=summary, description=description, uid=f"{item_id}-{key}",
            ))
    events.sort(key=lambda e: (e.start, e.summary))
    return events


class KontoblickCalendar(CalendarEntity):
    _attr_name = "Kontoblick"
    _attr_unique_id = "kontoblick_calendar"
    _attr_icon = "mdi:wallet-outline"

    def __init__(self, hass: HomeAssistant) -> None:
        self._state = hass.data[DOMAIN]
        self._event: CalendarEvent | None = None

    async def async_added_to_hass(self) -> None:
        self._state["listeners"].append(self._data_changed)

    async def async_will_remove_from_hass(self) -> None:
        if self._data_changed in self._state["listeners"]:
            self._state["listeners"].remove(self._data_changed)

    @callback
    def _data_changed(self) -> None:
        self.async_schedule_update_ha_state(True)

    @property
    def event(self) -> CalendarEvent | None:
        return self._event

    async def async_update(self) -> None:
        today = dt_util.now().date()
        upcoming = build_events(self._state["data"]["docs"], today, today + timedelta(days=400))
        self._event = upcoming[0] if upcoming else None

    async def async_get_events(self, hass: HomeAssistant, start_date: datetime, end_date: datetime) -> list[CalendarEvent]:
        start = dt_util.as_local(start_date).date()
        end = dt_util.as_local(end_date).date()
        return build_events(self._state["data"]["docs"], start, end)
