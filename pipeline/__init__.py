"""AI Intel Dashboard data pipeline.

Stdlib-only by design: the target environment has no PyPI access, and the
dashboard itself has no build step.  Everything here is Python 3.10+ standard
library.

Entry point::

    python -m pipeline.refresh --help
"""

__all__ = ["httpio", "rss", "sources", "stats", "funding", "config"]
