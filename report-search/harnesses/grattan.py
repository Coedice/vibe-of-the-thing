import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import Harness, ScrapeResult


class GrattanHarness(Harness):
    """Harness for scraping Grattan Institute research reports."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
        )

    def scrape(self, config: dict) -> ScrapeResult:
        """Scrape research reports from Grattan Institute."""
        result = ScrapeResult(
            name=config.get("name", "Grattan Institute"),
            source_type="think_tank",
        )

        url = config.get("reports_url", "https://grattan.edu.au/work/")

        if not url:
            result.errors.append("No reports_url found")
            return result

        try:
            pdf_urls = set()

            # First, get the main page and look for reports/articles
            response = self.session.get(url, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "html.parser")

            # Strategy 1: Look for direct PDF links
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                if href and href.lower().endswith(".pdf"):
                    full_url = urljoin(url, href)
                    pdf_urls.add(full_url)

            # Strategy 2: Find article/report links and visit them
            report_links = set()

            # Look for links in common report containers
            for container in soup.find_all(
                ["article", "div"],
                class_=lambda x: x
                and any(
                    c in str(x).lower()
                    for c in ["report", "work", "publication", "news", "post"]
                ),
            ):
                for link in container.find_all("a", href=True):
                    href = link.get("href", "")
                    if href and not href.lower().endswith(
                        (".pdf", ".jpg", ".png", ".gif")
                    ):
                        full_url = urljoin(url, href)
                        if urlparse(full_url).netloc == urlparse(url).netloc:
                            report_links.add(full_url)

            # Also look for main content links with heuristics
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                text = link.get_text(strip=True)

                # Look for report links and article-like links with meaningful text
                if (
                    href
                    and len(text) > 8
                    and not href.lower().endswith((".pdf", ".jpg", ".png", ".gif"))
                ):
                    full_url = urljoin(url, href)
                    if (
                        urlparse(full_url).netloc == urlparse(url).netloc
                        and full_url != url
                    ):
                        # Prioritize /report/ links, then check other patterns
                        if any(
                            x in href.lower()
                            for x in [
                                "/report/",
                                "/work/",
                                "/research/",
                                "/news/",
                                "/opinion/",
                                "/publications/",
                            ]
                        ):
                            report_links.add(full_url)

            # Visit each report link to find PDFs (limit to 50 to avoid too much scraping)
            for report_url in sorted(list(report_links))[:50]:
                try:
                    resp = self.session.get(report_url, timeout=15)
                    resp.raise_for_status()
                    report_soup = BeautifulSoup(resp.content, "html.parser")

                    # Look for PDF download links on the report page
                    for link in report_soup.find_all("a", href=True):
                        pdf_href = link.get("href", "")
                        link_text = link.get_text(strip=True).lower()

                        # Direct PDF links
                        if pdf_href and pdf_href.lower().endswith(".pdf"):
                            pdf_url = urljoin(report_url, pdf_href)
                            pdf_urls.add(pdf_url)

                        # Look for download buttons (might link to PDF)
                        elif pdf_href and any(
                            x in link_text for x in ["download", "pdf", "report"]
                        ):
                            if pdf_href.lower().endswith(".pdf"):
                                pdf_url = urljoin(report_url, pdf_href)
                                pdf_urls.add(pdf_url)

                    time.sleep(0.5)  # Be polite
                except Exception:
                    pass  # Continue to next report

            result.pdfs_found = len(pdf_urls)
            result.pdf_urls = sorted(list(pdf_urls))

        except Exception as e:
            result.errors.append(f"Error scraping Grattan: {str(e)}")

        return result
