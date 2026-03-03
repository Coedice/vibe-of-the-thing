import re
import time
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from . import Harness, ScrapeResult


class GenericPdfHarness(Harness):
    """Generic in-domain crawler that prioritises publication/report pages and PDF links."""

    name = "Generic Source"
    seed_paths = []
    max_pages = 40
    timeout = 10

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
        )

    def _is_same_domain(self, base_url: str, test_url: str) -> bool:
        base_host = urlparse(base_url).netloc.replace("www.", "")
        test_host = urlparse(test_url).netloc.replace("www.", "")
        return base_host == test_host

    def _looks_like_pdf(self, url: str) -> bool:
        lowered = url.lower()
        return ".pdf" in lowered or lowered.endswith("/pdf")

    def _looks_like_listing(self, url: str) -> bool:
        parsed = urlparse(url)
        lowered = url.lower()
        path = parsed.path.lower()
        query = parsed.query.lower()

        if lowered.endswith(".xml"):
            return True
        if "page=" in query:
            return True

        listing_tokens = [
            "/page/",
            "/category/",
            "/tag/",
            "/author/",
            "/news",
            "/media",
            "/report",
            "/publication",
            "/resource",
            "/submission",
            "/policy",
            "/research",
            "/library",
        ]
        return any(token in path for token in listing_tokens)

    def scrape(self, config: dict) -> ScrapeResult:
        result = ScrapeResult(
            name=config.get("name", self.name), source_type="think_tank"
        )

        start_url = config.get("reports_url") or config.get("website")
        if not start_url:
            result.errors.append("No reports_url or website found")
            return result

        candidate_paths = list(self.seed_paths)
        extra_paths = config.get("seed_paths")
        if isinstance(extra_paths, list):
            candidate_paths.extend(extra_paths)

        to_visit = [start_url]
        for path in candidate_paths:
            to_visit.append(urljoin(start_url, path))

        # Many sites only expose full sitemap URLs via robots.txt.
        try:
            parsed_start = urlparse(start_url)
            robots_url = f"{parsed_start.scheme}://{parsed_start.netloc}/robots.txt"
            robots_response = self.session.get(robots_url, timeout=self.timeout)
            if robots_response.ok:
                for match in re.findall(
                    r"(?im)^\s*sitemap:\s*(\S+)", robots_response.text
                ):
                    to_visit.append(match.strip())
        except Exception:
            pass

        pdf_urls = set()
        visited = set()
        queued = set(to_visit)

        keywords = [
            "report",
            "reports",
            "publication",
            "publications",
            "submission",
            "submissions",
            "resource",
            "resources",
            "paper",
            "papers",
            "research",
            "policy",
            "media",
            "library",
            "download",
            "journal",
            "magazine",
            "issue",
        ]

        while to_visit and len(visited) < self.max_pages:
            current = to_visit.pop(0)
            if current in visited:
                continue
            visited.add(current)

            try:
                response = self.session.get(current, timeout=self.timeout)
                response.raise_for_status()
            except Exception:
                continue

            final_url = response.url
            if not self._is_same_domain(start_url, final_url):
                continue

            content_type = (response.headers.get("content-type") or "").lower()
            if "application/pdf" in content_type:
                pdf_urls.add(final_url)
                continue

            if "xml" in content_type or final_url.lower().endswith(".xml"):
                xml = BeautifulSoup(response.content, "xml")
                for loc in xml.find_all("loc"):
                    loc_url = (loc.get_text() or "").strip()
                    if not loc_url:
                        continue

                    if self._looks_like_pdf(loc_url):
                        pdf_urls.add(loc_url)
                        continue

                    if self._is_same_domain(start_url, loc_url):
                        if loc_url not in visited and loc_url not in queued:
                            to_visit.append(loc_url)
                            queued.add(loc_url)
                continue

            soup = BeautifulSoup(response.content, "html.parser")
            for link in soup.find_all("a", href=True):
                href = link.get("href", "").strip()
                if not href:
                    continue

                full_url = urljoin(final_url, href)

                # Keep direct PDF links even when they are served from a CDN.
                if self._looks_like_pdf(full_url):
                    pdf_urls.add(full_url)
                    continue

                if not self._is_same_domain(start_url, full_url):
                    continue

                text = link.get_text(" ", strip=True).lower()
                token = (href + " " + text).lower()

                if any(k in token for k in keywords) or self._looks_like_listing(
                    full_url
                ):
                    if full_url not in visited and full_url not in queued:
                        to_visit.append(full_url)
                        queued.add(full_url)

            time.sleep(0.05)

        result.pdf_urls = sorted(pdf_urls)
        result.pdfs_found = len(result.pdf_urls)
        return result
