"""HTTP fetching with a polite user-agent, retries and an on-disk cache.

Stdlib only.  The cache exists for two reasons: news feeds are refetched on
every run, and per-URL resolution work should be paid once.  ``offline`` mode
serves exclusively from the cache so the pipeline can be exercised with no
network at all (used by the tests).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (compatible; AIIntelDashboard/1.0; "
    "+https://github.com/bubbagump86/DISG-AMC)"
)

#: Feeds are text, but some servers only honour Accept-Encoding when asked.
_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"


class FetchError(RuntimeError):
    """A request failed after all retries, or offline mode had no cached copy."""


@dataclass
class Fetcher:
    """Fetches URLs, caching successful responses on disk.

    Parameters
    ----------
    cache_dir:
        Where cached bodies live.  ``None`` disables caching entirely.
    cache_ttl:
        Seconds a cached body stays fresh.  ``0`` means the cache never expires
        (useful for the tests); ``None`` means never read from cache, only write.
    offline:
        When true, never touch the network -- a cache miss raises ``FetchError``.
    min_interval:
        Minimum seconds between two network requests, to stay polite.
    """

    timeout: float = 20.0
    retries: int = 2
    backoff: float = 1.5
    cache_dir: Path | None = None
    cache_ttl: float | None = 6 * 3600
    offline: bool = False
    min_interval: float = 0.4
    user_agent: str = DEFAULT_USER_AGENT

    _last_request: float = field(default=0.0, repr=False)
    stats: dict = field(default_factory=lambda: {"network": 0, "cache_hit": 0, "error": 0}, repr=False)

    # -- cache ---------------------------------------------------------------

    def _cache_paths(self, url: str) -> tuple[Path, Path]:
        assert self.cache_dir is not None
        key = hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]
        return self.cache_dir / f"{key}.bin", self.cache_dir / f"{key}.json"

    def _read_cache(self, url: str, *, allow_expired: bool = False) -> bytes | None:
        if self.cache_dir is None:
            return None
        body_path, meta_path = self._cache_paths(url)
        if not body_path.exists():
            return None
        if not allow_expired and self.cache_ttl is not None and self.cache_ttl > 0:
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                age = time.time() - float(meta.get("fetched_at", 0))
            except (OSError, ValueError, TypeError):
                age = float("inf")
            if age > self.cache_ttl:
                return None
        self.stats["cache_hit"] += 1
        return body_path.read_bytes()

    def _write_cache(self, url: str, body: bytes) -> None:
        if self.cache_dir is None:
            return
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        body_path, meta_path = self._cache_paths(url)
        atomic_write_bytes(body_path, body)
        atomic_write_bytes(
            meta_path,
            json.dumps({"url": url, "fetched_at": time.time(), "bytes": len(body)}).encode("utf-8"),
        )

    # -- network -------------------------------------------------------------

    def _sleep_if_needed(self) -> None:
        if self.min_interval <= 0:
            return
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self._last_request = time.monotonic()

    def _request_once(self, url: str) -> bytes:
        self._sleep_if_needed()
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": self.user_agent,
                "Accept": _ACCEPT,
                "Accept-Encoding": "gzip",
            },
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            body = response.read()
            if response.headers.get("Content-Encoding", "").lower() == "gzip":
                body = gzip.decompress(body)
        self.stats["network"] += 1
        return body

    def get(self, url: str) -> bytes:
        """Return the body for ``url``, from cache when possible."""
        if not self.offline:
            cached = self._read_cache(url)
            if cached is not None:
                return cached
        elif self.cache_dir is not None:
            cached = self._read_cache(url, allow_expired=True)
            if cached is None:
                raise FetchError(f"offline mode and nothing cached for {url}")
            return cached

        if self.offline:
            raise FetchError(f"offline mode and caching disabled for {url}")

        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                body = self._request_once(url)
                self._write_cache(url, body)
                return body
            except (urllib.error.URLError, OSError, TimeoutError) as exc:
                last_error = exc
                if attempt < self.retries:
                    time.sleep(self.backoff * (2**attempt))
        self.stats["error"] += 1
        raise FetchError(f"failed to fetch {url}: {last_error}") from last_error


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write ``data`` to ``path`` atomically (temp file + replace).

    ``data.json`` is fetched by the live page every load, so a half-written file
    would be served to a reader.  A rename is atomic on the same filesystem.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp{os.getpid()}")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def write_json(path: Path, payload, *, indent: int = 2) -> None:
    """Atomically write ``payload`` as UTF-8 JSON with a trailing newline."""
    text = json.dumps(payload, indent=indent, ensure_ascii=False) + "\n"
    atomic_write_text(path, text)


def decode_text(body: bytes, declared: str | None = None) -> str:
    """Decode feed bytes defensively.

    Feeds advertise an encoding but sometimes contain stray bytes, so fall back
    through the usual suspects rather than failing the whole run.
    """
    candidates = [declared, "utf-8", "utf-8-sig", "latin-1"]
    for encoding in candidates:
        if not encoding:
            continue
        try:
            return body.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return body.decode("utf-8", errors="replace")
