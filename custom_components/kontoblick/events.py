"""Termine aus Kontoblick-Daten: Abbuchungen, Eingänge und Kündigungsfristen."""
from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date

INTERVAL = {"monthly": 1, "quarterly": 3, "halfyearly": 6, "yearly": 12}


@dataclass
class Event:
    day: date
    kind: str  # "expense", "saving", "income" oder "deadline"
    name: str
    amount: float = 0.0
    note: str = ""


def eur(value: float) -> str:
    text = f"{abs(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{text} €"


def resolve(doc: dict, key: str) -> dict | None:
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


def build_events(docs: dict, start: date, end: date) -> list[Event]:
    items = [doc for path, doc in docs.items() if path.startswith("items/")]
    events: list[Event] = []
    for y, m in _months(start, end):
        key = f"{y:04d}-{m:02d}"
        last = monthrange(y, m)[1]
        for doc in items:
            it = resolve(doc, key)
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
                    events.append(Event(day, "deadline", name, note=it.get("cancelNote") or ""))

            n = INTERVAL.get(it.get("interval") or "monthly", 1)
            if n > 1 and (m - int(it.get("month") or 1)) % n != 0:
                continue
            if not it.get("day"):
                continue
            day = date(y, m, min(int(it["day"]), last))
            if start <= day <= end:
                events.append(Event(day, it.get("kind") or "expense", name, float(it.get("amount") or 0)))
    events.sort(key=lambda e: (e.day, e.name))
    return events
