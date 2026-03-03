import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import Harness, ScrapeResult


class AustraliaInstituteHarness(Harness):
    """Harness for scraping Australia Institute research reports."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
        )

    def scrape(self, config: dict) -> ScrapeResult:
        """Scrape research reports from Australia Institute."""
        result = ScrapeResult(
            name=config.get("name", "Australia Institute"),
            source_type="think_tank",
        )

        url = config.get("reports_url", "https://australiainstitute.org.au/research/")

        if not url:
            result.errors.append("No reports_url found")
            return result

        try:
            pdf_urls = set()

            parsed = urlparse(url)
            base_host = parsed.netloc.replace("www.", "")
            base_url = f"{parsed.scheme}://{base_host}"

            # Strategy 1: WordPress media API (most reliable for this site)
            api_base = f"{base_url}/wp-json/wp/v2/media"
            for page in range(1, 6):
                api_url = (
                    f"{api_base}?per_page=100&mime_type=application/pdf&page={page}"
                )
                api_resp = self.session.get(api_url, timeout=20)
                if api_resp.status_code >= 400:
                    break

                media_items = api_resp.json()
                if not media_items:
                    break

                for item in media_items:
                    source_url = item.get("source_url", "")
                    if source_url and source_url.lower().endswith(".pdf"):
                        pdf_urls.add(source_url)

                if len(media_items) < 100:
                    break

            # Strategy 2: Fallback page scrape
            try:
                response = self.session.get(url, timeout=15)
                response.raise_for_status()
                soup = BeautifulSoup(response.content, "html.parser")

                # Look for direct PDF links
                for link in soup.find_all("a", href=True):
                    href = link.get("href", "")
                    if href and href.lower().endswith(".pdf"):
                        full_url = urljoin(url, href)
                        pdf_urls.add(full_url)

                # Look for research and publication links
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
                            if any(
                                x in href.lower()
                                for x in [
                                    "/research/",
                                    "/publication/",
                                    "/report/",
                                    "/wp-content/",
                                ]
                            ):
                                report_links.add(full_url)

                # Visit research pages
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
            except Exception:
                pass

            result.pdfs_found = len(pdf_urls)
            result.pdf_urls = sorted(list(pdf_urls))

        except Exception as e:
            result.errors.append(f"Error scraping Australia Institute: {str(e)}")

        return result
