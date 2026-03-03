import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import Harness, ScrapeResult


class SuperpowerHarness(Harness):
    """Harness for scraping Superpower Institute research reports."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
        )

    def scrape(self, config: dict) -> ScrapeResult:
        """Scrape research reports from Superpower Institute."""
        result = ScrapeResult(
            name=config.get("name", "Superpower Institute"),
            source_type="think_tank",
        )

        url = config.get("reports_url", "https://www.superpowerinstitute.com.au/work")

        if not url:
            result.errors.append("No reports_url found")
            return result

        try:
            pdf_urls = set()

            # Get the main research page
            response = self.session.get(url, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "html.parser")

            # Strategy 1: Look for direct PDF links
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                if href and href.lower().endswith(".pdf"):
                    full_url = urljoin(url, href)
                    pdf_urls.add(full_url)

            # Strategy 2: Find research/publication article links
            research_links = set()

            # Look for research containers and articles
            for container in soup.find_all(
                ["article", "div", "li"],
                class_=lambda x: x
                and any(
                    c in str(x).lower()
                    for c in [
                        "research",
                        "paper",
                        "publication",
                        "work",
                        "post",
                        "item",
                    ]
                ),
            ):
                for link in container.find_all("a", href=True):
                    href = link.get("href", "")
                    if href and not href.lower().endswith(
                        (".pdf", ".jpg", ".png", ".gif")
                    ):
                        full_url = urljoin(url, href)
                        if urlparse(full_url).netloc == urlparse(url).netloc:
                            research_links.add(full_url)

            # Also look for main content links with heuristics
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                text = link.get_text(strip=True)

                # Look for article-like links
                if (
                    href
                    and len(text) > 10
                    and not href.lower().endswith((".pdf", ".jpg", ".png", ".gif"))
                    and any(
                        x in href.lower()
                        for x in [
                            "/work/",
                            "/research/",
                            "/paper/",
                            "/publication",
                            "/report/",
                            "/blog/",
                            "/post/",
                        ]
                    )
                ):
                    full_url = urljoin(url, href)
                    if (
                        urlparse(full_url).netloc == urlparse(url).netloc
                        and full_url != url
                    ):
                        research_links.add(full_url)

            # Visit each research link to find PDFs
            for research_url in sorted(list(research_links))[:50]:
                try:
                    resp = self.session.get(research_url, timeout=15)
                    resp.raise_for_status()
                    research_soup = BeautifulSoup(resp.content, "html.parser")

                    # Look for PDF download links
                    for link in research_soup.find_all("a", href=True):
                        pdf_href = link.get("href", "")
                        link_text = link.get_text(strip=True).lower()

                        # Direct PDF links
                        if pdf_href and pdf_href.lower().endswith(".pdf"):
                            pdf_url = urljoin(research_url, pdf_href)
                            pdf_urls.add(pdf_url)

                        # Look for download buttons or PDF links
                        elif pdf_href and any(
                            x in link_text
                            for x in ["download", "pdf", "paper", "report"]
                        ):
                            if pdf_href.lower().endswith(".pdf"):
                                pdf_url = urljoin(research_url, pdf_href)
                                pdf_urls.add(pdf_url)

                    time.sleep(0.5)  # Be polite
                except Exception:
                    pass  # Continue to next research item

            result.pdfs_found = len(pdf_urls)
            result.pdf_urls = sorted(list(pdf_urls))

        except Exception as e:
            result.errors.append(f"Error scraping Superpower Institute: {str(e)}")

        return result
