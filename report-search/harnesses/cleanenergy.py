import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import Harness, ScrapeResult


class CleanenergyHarness(Harness):
    """Harness for scraping Clean Energy Council reports."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
        )

    def scrape(self, config: dict) -> ScrapeResult:
        """Scrape reports from Clean Energy Council."""
        result = ScrapeResult(
            name=config.get("name", "Clean Energy Council"),
            source_type="think_tank",
        )

        url = config.get("reports_url", "https://www.cleanenergycouncil.org.au/")

        if not url:
            result.errors.append("No reports_url found")
            return result

        try:
            pdf_urls = set()

            # Get the main page
            response = self.session.get(url, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "html.parser")

            # Look for direct PDF links
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                if href and href.lower().endswith(".pdf"):
                    full_url = urljoin(url, href)
                    pdf_urls.add(full_url)

            # Also check advocacy/resources pages
            resource_pages = set()
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                text = link.get_text(strip=True)
                if any(
                    k in (href + " " + text).lower()
                    for k in ["advocacy", "resource", "report", "publication"]
                ):
                    full_url = urljoin(url, href)
                    if urlparse(full_url).netloc == urlparse(url).netloc:
                        resource_pages.add(full_url)

            # Visit resource pages
            for res_page in sorted(list(resource_pages))[:10]:
                try:
                    resp = self.session.get(res_page, timeout=15)
                    resp.raise_for_status()
                    res_soup = BeautifulSoup(resp.content, "html.parser")

                    for link in res_soup.find_all("a", href=True):
                        href = link.get("href", "")
                        if href and href.lower().endswith(".pdf"):
                            pdf_url = urljoin(res_page, href)
                            pdf_urls.add(pdf_url)

                    time.sleep(0.2)
                except Exception:
                    pass

            result.pdfs_found = len(pdf_urls)
            result.pdf_urls = sorted(list(pdf_urls))

        except Exception as e:
            result.errors.append(f"Error scraping Clean Energy Council: {str(e)}")

        return result
