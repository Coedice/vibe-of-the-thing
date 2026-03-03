import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import Harness, ScrapeResult


class CisHarness(Harness):
    """Harness for scraping Centre for Independent Studies research reports."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
        )

    def scrape(self, config: dict) -> ScrapeResult:
        """Scrape research reports from Centre for Independent Studies."""
        result = ScrapeResult(
            name=config.get("name", "Centre for Independent Studies"),
            source_type="think_tank",
        )

        url = config.get("reports_url", "https://www.cis.org.au/publications/")

        if not url:
            result.errors.append("No reports_url found")
            return result

        try:
            pdf_urls = set()

            # Get publications page
            response = self.session.get(url, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "html.parser")

            # Look for direct PDF links
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                if href and href.lower().endswith(".pdf"):
                    full_url = urljoin(url, href)
                    pdf_urls.add(full_url)

            # Look for publication links
            report_links = set()
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                text = link.get_text(strip=True)

                if (
                    href
                    and len(text) > 5
                    and not href.lower().endswith((".pdf", ".jpg", ".png"))
                ):
                    full_url = urljoin(url, href)
                    if urlparse(full_url).netloc == urlparse(url).netloc:
                        report_links.add(full_url)

            # Visit publication pages
            for report_url in sorted(list(report_links))[:50]:
                try:
                    resp = self.session.get(report_url, timeout=15)
                    resp.raise_for_status()
                    report_soup = BeautifulSoup(resp.content, "html.parser")

                    for link in report_soup.find_all("a", href=True):
                        href = link.get("href", "")
                        if href and href.lower().endswith(".pdf"):
                            pdf_url = urljoin(report_url, href)
                            pdf_urls.add(pdf_url)

                    time.sleep(0.5)
                except Exception:
                    pass

            result.pdfs_found = len(pdf_urls)
            result.pdf_urls = sorted(list(pdf_urls))

        except Exception as e:
            result.errors.append(
                f"Error scraping Centre for Independent Studies: {str(e)}"
            )

        return result
