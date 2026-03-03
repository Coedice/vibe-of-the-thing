from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List


@dataclass
class ScrapeResult:
    """Result of scraping a source."""

    name: str
    source_type: str
    pdfs_found: int = 0
    errors: List[str] = field(default_factory=list)
    pdf_urls: List[str] = field(default_factory=list)


class Harness(ABC):
    """Base class for scraping harnesses."""

    @abstractmethod
    def scrape(self, config: dict) -> ScrapeResult:
        """
        Scrape reports from a source.

        Args:
            config: Configuration dictionary with source details

        Returns:
            ScrapeResult with found URLs
        """
        pass
