from time import sleep
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from harnesses import Harness, ScrapeResult


class JbwereHarness(Harness):
    """Discovers PDF reports from JBWere Foundation resources page."""

    def scrape(self, config: dict) -> ScrapeResult:
        """
        Scrapes JBWere Foundation resources for PDF reports.

        JBWere publishes investment-related research and guidelines as PDFs
        in their resources section.
        """
        base_url = config["reports_url"]
        pdf_urls = set()

        try:
            # Set up session with headers
            session = requests.Session()
            session.headers.update(
                {"User-Agent": "Mozilla/5.0 (compatible; ReportBot/1.0)"}
            )

            # Get resources page
            response = session.get(base_url, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "html.parser")

            # Find all PDF links on resources page
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")

                if href and ".pdf" in href.lower():
                    # Resolve relative URLs
                    full_url = urljoin(base_url, href)

                    # Normalize URL (remove fragments, session params)
                    parsed = urlparse(full_url)
                    clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

                    pdf_urls.add(clean_url)
                    sleep(0.1)  # Rate limiting

            # Optionally follow resource category pages for more PDFs
            nav_links = set()
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                text = link.get_text(strip=True).lower()

                if href and ("/resource" in href.lower() or "resource" in text):
                    full_url = urljoin(base_url, href)
                    if full_url != base_url and "jbwere.com.au" in full_url:
                        nav_links.add(full_url)

            # Check a few navigation links for additional PDFs
            for nav_url in list(nav_links)[:5]:
                try:
                    response = session.get(nav_url, timeout=10)
                    soup_page = BeautifulSoup(response.content, "html.parser")

                    for link in soup_page.find_all("a", href=True):
                        href = link.get("href", "")

                        if href and ".pdf" in href.lower():
                            full_url = urljoin(nav_url, href)
                            parsed = urlparse(full_url)
                            clean_url = (
                                f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
                            )
                            pdf_urls.add(clean_url)

                    sleep(0.2)

                except Exception:
                    pass

            return ScrapeResult(
                name=config.get("name", "JBWere Foundation"),
                source_type="think_tank",
                pdf_urls=list(pdf_urls),
                pdfs_found=len(pdf_urls),
            )

        except Exception as e:
            return ScrapeResult(
                name=config.get("name", "JBWere Foundation"),
                source_type="think_tank",
                pdf_urls=[],
                pdfs_found=0,
                errors=[str(e)],
            )
