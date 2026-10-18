"""Aggregate computation -- the single source of truth for ``stats.json``.

The rules deliberately mirror ``index.html:computeStatsFromCompanies`` so the
sidecar and the browser fallback can never disagree:

* "capital raised" sums **lifetime** ``total_raised_usd``, never the latest
  round's ``amount_usd``;
* ``current_market_cap_usd`` counts only for public companies, and only the
  numeric ones;
* undisclosed values (``null``/missing) are excluded, and each block reports how
  many companies actually contributed so the UI can show "16/40 disclosed".

``tests/test_contract.py`` keeps its *own* independent implementation of these
rules on purpose -- comparing the published file against a separate reference is
what makes the drift guard meaningful.
"""

from __future__ import annotations

from datetime import date, datetime, timezone


def as_number(value):
    """Return ``value`` as a number, or ``None``.  ``bool`` is not a number."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def is_public(company: dict) -> bool:
    """Public companies carry a market cap; private ones a post-money mark."""
    if "is_public" in company:
        return bool(company["is_public"])
    # Legacy data.json (pre-Phase-1) has no flag; these four are the public names.
    return company.get("name") in {"ServiceNow", "Snowflake", "DataDog", "AvePoint"}


def compute(companies: list[dict]) -> dict:
    """The aggregate blocks, with no timestamps."""
    total_count = len(companies)
    capital_total = latest_round_total = 0
    capital_disclosed = latest_round_count = 0
    private_val = public_val = 0
    private_count = public_count = 0
    arr_total = arr_disclosed = 0

    for company in companies:
        funding = company.get("funding") or {}

        raised = as_number(funding.get("total_raised_usd"))
        if raised is not None and raised > 0:
            capital_total += raised
            capital_disclosed += 1

        amount = as_number(funding.get("amount_usd"))
        if amount is not None and amount > 0:
            latest_round_total += amount
            latest_round_count += 1

        if is_public(company):
            market_cap = as_number(funding.get("current_market_cap_usd"))
            if market_cap is not None and market_cap > 0:
                public_val += market_cap
                public_count += 1
        else:
            post_money = as_number(funding.get("post_money_valuation_usd"))
            if post_money is not None and post_money > 0:
                private_val += post_money
                private_count += 1

        arr = as_number(company.get("arr_usd"))
        if arr is not None and arr > 0:
            arr_total += arr
            arr_disclosed += 1

    news_total = sum(len(company.get("latest_news") or []) for company in companies)
    categories = {company.get("category") for company in companies if company.get("category")}

    return {
        "companies_tracked": total_count,
        "categories": len(categories),
        "news_items": news_total,
        "capital_raised": {
            "total_usd": capital_total,
            "disclosed_count": capital_disclosed,
            "total_count": total_count,
            "latest_round_total_usd": latest_round_total,
            "latest_round_count": latest_round_count,
            "note": "sum of funding.total_raised_usd (lifetime)",
        },
        "combined_arr": {
            "total_usd": arr_total,
            "disclosed_count": arr_disclosed,
            "total_count": total_count,
            "note": "sum of arr_usd; only disclosed companies included",
        },
        "combined_valuation": {
            "total_usd": private_val + public_val,
            "private_post_money_usd": private_val,
            "private_count": private_count,
            "public_market_cap_usd": public_val,
            "public_count": public_count,
            "note": "private = post_money_valuation_usd; public = current_market_cap_usd",
        },
    }


def latest_news_date(companies: list[dict]) -> str | None:
    """Newest news date in the dataset, or ``None`` when there is no news."""
    dates = [
        item.get("date")
        for company in companies
        for item in (company.get("latest_news") or [])
        if item.get("date")
    ]
    return max(dates) if dates else None


def build(companies: list[dict], *, now: datetime | None = None) -> dict:
    """``compute`` plus the ``last_updated`` / ``as_of_date`` stamps."""
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    stats = compute(companies)
    stats["last_updated"] = moment.isoformat(timespec="seconds")
    stats["as_of_date"] = latest_news_date(companies) or date.today().isoformat()
    return stats
