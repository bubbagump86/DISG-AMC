"""Funding-event detection and the review queue.

Policy agreed at takeover: **numeric fields auto-apply, prose goes to review.**
So this module parses amounts, round labels and valuations out of fresh news
items, decides whether a signal is safe to apply, and always queues everything
it finds -- the long LLM-written ``source_note`` is never generated here.

A signal is applied only when it is high confidence *and* clears the 10%
no-churn threshold, so the same round reported slightly differently day to day
does not cause the numbers to flap.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

#: Minimum relative change before a parsed number replaces the stored one.
CHURN_THRESHOLD = 0.10

CURRENCY = r"(?:US\$|USD|\$|£|€|¥)"

_SCALE = {
    "t": 1e12, "trillion": 1e12,
    "b": 1e9, "bn": 1e9, "billion": 1e9,
    "m": 1e6, "mn": 1e6, "million": 1e6,
    "k": 1e3, "thousand": 1e3,
}

_AMOUNT_RE = re.compile(
    rf"{CURRENCY}\s?([\d][\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|bn|mn|[TBMK])\b",
    re.IGNORECASE,
)
_WORD_AMOUNT_RE = re.compile(
    r"([\d][\d,]*(?:\.\d+)?)\s*(trillion|billion|million)\b",
    re.IGNORECASE,
)
_VALUATION_RE = re.compile(
    rf"(?:valuation of|valued at|at a|worth|valuation at)\s*{CURRENCY}\s?"
    r"([\d][\d,]*(?:\.\d+)?)\s*(trillion|billion|million|bn|mn|[TBM])\b",
    re.IGNORECASE,
)

#: An amount only counts as the *round* amount when a raise verb introduces it,
#: so "possible $2 trillion IPO" cannot become a funding figure.
_RAISE_AMOUNT_RE = re.compile(
    rf"\b(?:rais\w*|clos\w*|secur\w*|land\w*|fetch\w*|nabs?|nets?|bags?|gets?|"
    rf"announc\w*|receiv\w*|inject\w*|invest\w*)\b[^.;]{{0,60}}?"
    rf"{CURRENCY}\s?([\d][\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|bn|mn|[TBMK])\b",
    re.IGNORECASE,
)

#: Forward-looking or hedged wording: never auto-apply numbers from these.
_SPECULATION_RE = re.compile(
    r"\b(?:possible|possibly|could|would|reportedly|rumou?r\w*|expects?|expected|"
    r"plans?|planned|seeks?|seeking|targets?|targeting|may|might|consider\w*|expectation\w*|"
    r"in talks|weigh\w*|speculat\w*|poised|aims?)\b",
    re.IGNORECASE,
)

#: Round types safe enough to apply automatically.  An IPO, tender offer or
#: debt package is an event, not a priced round: those always go to review.
AUTO_APPLY_ROUND_RE = re.compile(r"^(?:Seed|Series [A-K])$")

#: Text immediately after an amount that makes it a valuation, not money raised.
_VALUATION_SUFFIX_RE = re.compile(r"\s*(?:post-money\s*)?valuation\b", re.IGNORECASE)
_ROUND_RES = [
    (re.compile(r"\bseries\s+([a-k])\b", re.IGNORECASE), lambda m: f"Series {m.group(1).upper()}"),
    (re.compile(r"\bpre-?ipo\b", re.IGNORECASE), lambda m: "Pre-IPO"),
    (re.compile(r"\bseed\b", re.IGNORECASE), lambda m: "Seed"),
    (re.compile(r"\btender offer\b", re.IGNORECASE), lambda m: "Tender Offer"),
    (re.compile(r"\bipo\b", re.IGNORECASE), lambda m: "IPO"),
    (re.compile(r"\b(?:debt|credit facility|convertible)\b", re.IGNORECASE), lambda m: "Debt"),
]

#: Words that put a bare "1.2 billion" in a funding context.
_FUNDING_CONTEXT = (
    "rais", "funding", "round", "invest", "valuation", "valued", "backed",
    "financing", "series", "seed", "ipo", "capital",
)


@dataclass
class FundingSignal:
    """A funding event read out of one or more news items."""

    company_id: str
    company_name: str
    kind: str  # "round" | "valuation"
    round_label: str | None
    amount_usd: int | None
    valuation_usd: int | None
    date: str | None
    headline: str
    source: str
    origin: str  # feed label -- "official" feeds outrank Google News
    official: bool  # came from a publisher's own feed
    confidence: str  # "high" | "medium" | "low"
    reasons: list[str] = field(default_factory=list)
    applied: bool = False
    decision: str = "queued"

    def key(self) -> tuple:
        """Group identity: the same round reported by several outlets."""
        return (
            self.company_id,
            self.round_label or "",
            (self.date or "")[:7],  # same month
        )


def _to_int(raw: str, scale_word: str) -> int | None:
    try:
        value = float(raw.replace(",", ""))
    except ValueError:
        return None
    scale = _SCALE.get(scale_word.lower())
    if scale is None:
        return None
    return int(round(value * scale))


def parse_amounts(text: str) -> list[int]:
    """Every dollar amount stated in ``text``."""
    found: list[int] = []
    for raw, scale_word in _AMOUNT_RE.findall(text):
        value = _to_int(raw, scale_word)
        if value:
            found.append(value)
    if not found:
        # No currency symbol: only trust it when the sentence is about funding,
        # which keeps "600B MoE" and "1M context" out.
        lowered = text.lower()
        if any(word in lowered for word in _FUNDING_CONTEXT):
            for raw, scale_word in _WORD_AMOUNT_RE.findall(text):
                value = _to_int(raw, scale_word)
                if value:
                    found.append(value)
    return found


def is_speculative(text: str) -> bool:
    """True when the wording is hedged or forward-looking."""
    return bool(_SPECULATION_RE.search(text))


def parse_valuation(text: str) -> int | None:
    match = _VALUATION_RE.search(text)
    if not match:
        return None
    return _to_int(match.group(1), match.group(2))


def parse_raise_amount(text: str) -> int | None:
    """The amount actually being raised, or ``None``.

    Requires a raise verb *and* rejects hedged wording, so a valuation quoted in
    an IPO story is not mistaken for a round size.
    """
    if is_speculative(text):
        return None
    match = _RAISE_AMOUNT_RE.search(text)
    if not match:
        return None
    trailing = text[match.end(): match.end() + 30]
    if _VALUATION_SUFFIX_RE.match(trailing):
        # "closes round at a $965B valuation" states a valuation, not money raised.
        return None
    return _to_int(match.group(1), match.group(2))


def parse_round(text: str) -> str | None:
    for pattern, formatter in _ROUND_RES:
        match = pattern.search(text)
        if match:
            return formatter(match)
    return None


def find_signals(company: dict, items: list[dict]) -> list[FundingSignal]:
    """Extract funding signals from ``items``, grouped by round.

    Only a raise-verb amount counts as the round size; hedged wording is ignored
    entirely.  Confidence reflects how well corroborated a signal is.
    """
    grouped: dict[tuple, FundingSignal] = {}

    for item in items:
        headline = item.get("headline") or ""
        summary = item.get("summary") or ""
        text = f"{headline}. {summary}"
        round_label = parse_round(text)
        amount = parse_raise_amount(text)
        valuation = parse_valuation(text)

        if not round_label and not amount and not valuation:
            continue

        signal = FundingSignal(
            company_id=company.get("_id") or "",
            company_name=company.get("name") or "",
            kind="round" if round_label else "valuation",
            round_label=round_label,
            amount_usd=amount,
            valuation_usd=valuation,
            date=item.get("date"),
            headline=headline,
            source=item.get("source") or "",
            origin=item.get("source_name") or item.get("feed") or "",
            official=item.get("_type") == "official",
            confidence="low",
            reasons=[],
        )

        existing = grouped.get(signal.key())
        if existing is None:
            grouped[signal.key()] = signal
        else:
            # Corroboration: another outlet reporting the same round.
            existing.reasons.append(f"corroborated by: {headline[:80]}")
            existing.amount_usd = existing.amount_usd or signal.amount_usd
            existing.valuation_usd = existing.valuation_usd or signal.valuation_usd
            existing.round_label = existing.round_label or signal.round_label
            existing.official = existing.official or signal.official

    signals = []
    for signal in grouped.values():
        corroborated = len(signal.reasons)
        if signal.round_label and signal.amount_usd and (signal.official or corroborated >= 1):
            signal.confidence = "high"
        elif signal.round_label and (signal.amount_usd or signal.valuation_usd):
            signal.confidence = "medium"
        else:
            signal.confidence = "low"
        if signal.official:
            signal.reasons.append("from an official/PR feed")
        if corroborated:
            signal.reasons.append(f"{corroborated} corroborating item(s)")
        signals.append(signal)

    signals.sort(key=lambda s: (s.date or "", s.confidence), reverse=True)
    return signals


def normalize_round(label: str | None) -> str:
    """Fold trailing noise so "Series B Funding" and "Series B" compare equal.

    Upstream labels mix forms ("Series B Funding", "Series D", "Public (NYSE: X)").
    Without folding, a known round reads as a brand-new one.
    """
    text = (label or "").strip()
    text = re.sub(r"\s*\([^()]*\)\s*$", "", text)          # drop a trailing "(NYSE: X)"
    text = re.sub(r"\s*\b(?:funding|round|financing|raise|raised)\b\s*$", "", text, flags=re.IGNORECASE)
    return text.strip().lower()


def _relative_change(old, new) -> float | None:
    old_n, new_n = _as_num(old), _as_num(new)
    if old_n is None or new_n is None or old_n == 0:
        return None
    return abs(new_n - old_n) / abs(old_n)


def _as_num(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def decide(signal: FundingSignal, funding: dict) -> tuple[bool, str]:
    """Whether to apply ``signal`` to ``funding``, and why.

    Auto-apply is deliberately hard to satisfy.  It is off by default (see
    ``refresh.py``) because regex extraction over curated data produced
    confidently-wrong results in testing -- an "$22B valuation" headline was read
    as a new round.  When enabled, the guard rails are: high confidence, a
    priced VC round (not IPO/tender/debt), a round label that really differs, and
    a signal date newer than what is stored.
    """
    if signal.confidence != "high":
        return False, f"confidence={signal.confidence}; queued for review"

    label = (signal.round_label or "").strip()
    if not label:
        return False, "no round label parsed"
    if not AUTO_APPLY_ROUND_RE.match(label):
        # IPO, tender offer, debt package: an event, not a priced round.
        return False, f"round type '{label}' is always reviewed by a human"

    if not signal.amount_usd:
        return False, "no raise amount parsed"

    stored_date = funding.get("date")
    if stored_date and signal.date and signal.date <= stored_date:
        return False, f"signal date {signal.date} is not newer than stored {stored_date}"

    current_round = normalize_round(funding.get("latest_round"))
    new_round = normalize_round(label)
    same_round = bool(new_round) and new_round == current_round

    if same_round:
        changes = []
        if signal.amount_usd and _as_num(funding.get("amount_usd")):
            delta = _relative_change(funding.get("amount_usd"), signal.amount_usd)
            if delta is not None and delta <= CHURN_THRESHOLD:
                return False, f"same round '{signal.round_label}' within {CHURN_THRESHOLD:.0%}; no churn"
            changes.append("amount")
        if signal.valuation_usd and _as_num(funding.get("post_money_valuation_usd")):
            delta = _relative_change(funding.get("post_money_valuation_usd"), signal.valuation_usd)
            if delta is not None and delta <= CHURN_THRESHOLD:
                return False, f"valuation within {CHURN_THRESHOLD:.0%}; no churn"
            changes.append("valuation")
        if not changes:
            return False, "no new numeric information"
        return True, "same round, material change in " + ", ".join(changes)

    if not new_round:
        return False, "no round label parsed"
    return True, f"new round '{signal.round_label}'"


def apply_signal(funding: dict, signal: FundingSignal) -> dict:
    """Return a copy of ``funding`` with the signal's numbers applied.

    Only numeric fields are touched.  ``source_note`` is intentionally left
    alone: that prose is human/LLM-authored and is reviewed from the queue.
    """
    updated = dict(funding)
    if signal.round_label:
        updated["latest_round"] = signal.round_label
    if signal.amount_usd:
        updated["amount_usd"] = signal.amount_usd
    if signal.valuation_usd:
        updated["post_money_valuation_usd"] = signal.valuation_usd
    if signal.date and (signal.round_label or signal.amount_usd or signal.valuation_usd):
        # Only move the date when something else moved with it, so an empty
        # signal cannot silently restamp the round.
        updated["date"] = signal.date
    return updated


def write_queue(path: Path, signals: list[FundingSignal], *, now: datetime | None = None) -> None:
    """Write the review queue, newest first, with the decision for each item."""
    moment = now or datetime.now(timezone.utc)
    payload = {
        "generated_at": moment.isoformat(timespec="seconds"),
        "policy": "numeric fields auto-apply when high-confidence and >10% change; prose reviewed by a human",
        "pending": [asdict(signal) for signal in signals if not signal.applied],
        "applied": [asdict(signal) for signal in signals if signal.applied],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
