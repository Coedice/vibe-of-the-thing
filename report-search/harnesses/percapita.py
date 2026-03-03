import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import Harness, ScrapeResult


class PercapitaHarness(Harness):
    """Harness for scraping Per Capita research reports."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
        )

    def scrape(self, config: dict) -> ScrapeResult:
        """Scrape research reports from Per Capita."""
        result = ScrapeResult(
            name=config.get("name", "Per Capita"),
            source_type="think_tank",
        )

        url = config.get("reports_url", "https://percapita.org.au/publications/")

        if not url:
            result.errors.append("No reports_url found")
            return result

        try:
            pdf_urls = set()

            # Get the publications page
            response = self.session.get(url, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "html.parser")

            # Strategy 1: Look for direct PDF links
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                if href and href.lower().endswith(".pdf"):
                    full_url = urljoin(url, href)
                    pdf_urls.add(full_url)

            # Strategy 2: Look for publication listing page links and follow them
            if not pdf_urls:
                report_links = set()
                for link in soup.find_all("a", href=True):
                    href = link.get("href", "")
                    text = link.get_text(strip=True)

                    if (
                        href
                        and len(text) > 8
                        and not href.lower().endswith((".pdf", ".jpg", ".png", ".gif"))
                        and any(
                            x in href.lower()
                            for x in ["/publication", "/report", "/paper", "/insight"]
                        )
                    ):
                        full_url = urljoin(url, href)
                        if urlparse(full_url).netloc == urlparse(url).netloc:
                            report_links.add(full_url)

                # Visit each publication page to find PDFs
                for pub_url in sorted(list(report_links))[:50]:
                    try:
                        resp = self.session.get(pub_url, timeout=15)
                        resp.raise_for_status()
                        pub_soup = BeautifulSoup(resp.content, "html.parser")

                        # Look for PDF links
                        for link in pub_soup.find_all("a", href=True):
                            pdf_href = link.get("href", "")
                            if pdf_href and pdf_href.lower().endswith(".pdf"):
                                pdf_url = urljoin(pub_url, pdf_href)
                                pdf_urls.add(pdf_url)

                        time.sleep(0.3)
                    except Exception:
                        pass

            result.pdfs_found = len(pdf_urls)
            result.pdf_urls = sorted(list(pdf_urls))

        except Exception as e:
            result.errors.append(f"Error scraping Per Capita: {str(e)}")

        return result
