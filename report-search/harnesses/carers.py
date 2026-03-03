import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import Harness, ScrapeResult


class CarersHarness(Harness):
    """Harness for scraping Carers Australia research reports."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
        )

    def scrape(self, config: dict) -> ScrapeResult:
        """Scrape research reports from Carers Australia."""
        result = ScrapeResult(
            name=config.get("name", "Carers Australia"),
            source_type="think_tank",
        )

        url = config.get(
            "reports_url", "https://www.carersaustralia.com.au/submissions-rep"
        )

        if not url:
            result.errors.append("No reports_url found")
            return result

        try:
            pdf_urls = set()

            # Get the submissions/reports page
            response = self.session.get(url, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "html.parser")

            # Look for direct PDF links
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                if href and href.lower().endswith(".pdf"):
                    full_url = urljoin(url, href)
                    pdf_urls.add(full_url)

            result.pdfs_found = len(pdf_urls)
            result.pdf_urls = sorted(list(pdf_urls))

        except Exception as e:
            result.errors.append(f"Error scraping Carers Australia: {str(e)}")

        return result
