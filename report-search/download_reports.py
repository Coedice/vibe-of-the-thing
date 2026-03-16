#!/usr/bin/env python3
"""CLI tool to collect research reports from think tanks and convert to YAML.

Workflow (per report):
1. Download PDF to temporary file
2. Convert PDF to .md file (delete PDF after)
3. Shrink markdown file in-place (overwrite .md)
4. Extract AI summary with Ollama (delete .md after)
5. Add to recommendations.yml
"""

import argparse
import concurrent.futures
import tempfile
import threading
import time
from pathlib import Path

import requests
import yaml
from markdown_generator import extract_recommendations, extract_recommendations_context
from markitdown import MarkItDown
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
)
from scraper import scrape_think_tank
from think_tanks_data import get_all_think_tanks, get_total_count

YAML_OUTPUT = Path("../_data/recommendations.yml")
MAX_RETRIES = 2

yaml_lock = threading.Lock()


def load_existing_json_reports() -> set:
    """Load existing report URLs from recommendations.yml."""
    if not YAML_OUTPUT.exists():
        return set()
    try:
        with open(YAML_OUTPUT, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
            if data:
                reports = data.get("reports", []) or []
                return {report["source_url"] for report in reports}
            return set()
    except Exception:
        return set()


def process_single_report(pdf_url: str, tank: dict, skip_ai: bool = False) -> dict:
    """Process a single report through all phases: download, convert, shrink, AI extract, save."""
    tank_slug = tank["slug"]
    tank_name = tank["name"]

    for attempt in range(MAX_RETRIES + 1):
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as pdf_file:
            pdf_path = Path(pdf_file.name)
        md_path = pdf_path.with_suffix(".md")

        try:
            response = requests.get(pdf_url, timeout=60)
            response.raise_for_status()
            with open(pdf_path, "wb") as f:
                f.write(response.content)

            md_converter = MarkItDown()

            try:
                result = md_converter.convert(str(pdf_path))
                content = getattr(result, "text_content", None) or str(result)
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(content)
            except Exception:
                try:
                    md_path.write_text("", encoding="utf-8")
                except:
                    pass

            try:
                if pdf_path.exists():
                    pdf_path.unlink()
            except:
                pass

            with open(md_path, "r", encoding="utf-8") as f:
                content = f.read()
            reduced_content = extract_recommendations_context(content)
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(reduced_content)

            if skip_ai:
                ai_result = {"title": "Untitled (AI skipped)", "recommendations": []}
            else:
                with open(md_path, "r", encoding="utf-8") as f:
                    content = f.read()
                ai_result = extract_recommendations(content)

            report = {
                "think_tank": tank_name,
                "source_url": pdf_url,
                "slug": tank_slug,
                "title": ai_result.get("title", "Untitled"),
                "recommendations": ai_result.get("recommendations", []),
            }

            with yaml_lock:
                existing_reports = []
                if YAML_OUTPUT.exists():
                    with open(YAML_OUTPUT, "r", encoding="utf-8") as f:
                        existing_data = yaml.safe_load(f)
                        if existing_data:
                            existing_reports = existing_data.get("reports", []) or []

                existing_reports.append(report)

                YAML_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
                with open(YAML_OUTPUT, "w", encoding="utf-8") as f:
                    yaml.dump(
                        {"reports": existing_reports},
                        f,
                        default_flow_style=False,
                        allow_unicode=True,
                        sort_keys=False,
                    )

            md_path.unlink()

            return {"success": True, "title": report["title"]}

        except Exception as e:
            for p in [pdf_path, md_path]:
                if p.exists():
                    try:
                        p.unlink()
                    except:
                        pass

            if attempt < MAX_RETRIES:
                time.sleep((attempt + 1) * 2)
            else:
                return {"success": False, "error": str(e), "url": pdf_url}

    return {"success": False, "error": "Max retries exceeded", "url": pdf_url}


def scrape_single_think_tank(tank: dict) -> dict:
    """Scrape a single think tank and return PDF URLs."""
    try:
        result = scrape_think_tank(tank)
        return {"tank": tank, "pdf_urls": result.pdf_urls, "errors": result.errors}
    except Exception as e:
        return {"tank": tank, "pdf_urls": [], "errors": [str(e)]}


def main():
    parser = argparse.ArgumentParser(
        description="Collect research reports from think tanks and convert to YAML"
    )
    parser.add_argument(
        "--delay",
        "-d",
        type=float,
        default=0.0,
        help="Delay between requests in seconds (default: 0.0)",
    )
    parser.add_argument(
        "--workers",
        "-w",
        type=int,
        default=4,
        help="Number of parallel workers (default: 4)",
    )
    parser.add_argument(
        "--scrape-workers",
        type=int,
        default=8,
        help="Number of parallel scrapers (default: 8)",
    )
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="Skip AI extraction (for CI or quick scraping)",
    )
    parser.add_argument(
        "--count", action="store_true", help="Show think tank count and exit"
    )

    args = parser.parse_args()

    if args.count:
        print(f"Total think tanks: {get_total_count()}")
        return 0

    think_tanks = get_all_think_tanks()
    print(f"Found {len(think_tanks)} think tanks")

    existing_urls = load_existing_json_reports()
    if existing_urls:
        print(f"Found {len(existing_urls)} existing reports in YAML, will skip those\n")

    console = Console()

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        scrape_task = progress.add_task(
            "Scraping think tanks...", total=len(think_tanks)
        )

        tank_results = []
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=args.scrape_workers
        ) as executor:
            futures = {
                executor.submit(scrape_single_think_tank, tank): tank
                for tank in think_tanks
            }
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                tank_results.append(result)
                progress.update(scrape_task, advance=1)

        all_pdf_urls = []
        total_scrape_errors = 0
        for tr in tank_results:
            all_pdf_urls.extend(tr["pdf_urls"])
            total_scrape_errors += len(tr["errors"])
            if tr["errors"]:
                console.print(
                    f"[yellow]Warning:[/yellow] {tr['tank']['name']}: {tr['errors'][0]}"
                )

        new_urls = [url for url in all_pdf_urls if url not in existing_urls]
        console.print(
            f"\nFound {len(new_urls)} new reports to process (from {len(all_pdf_urls)} total)\n"
        )

        if new_urls:
            process_task = progress.add_task(
                "Processing reports...", total=len(new_urls)
            )

            total_processed = 0
            total_errors = 0

            tank_to_urls = {}
            for url in new_urls:
                for tr in tank_results:
                    if url in tr["pdf_urls"]:
                        tank_to_urls[url] = tr["tank"]
                        break

            with concurrent.futures.ThreadPoolExecutor(
                max_workers=args.workers
            ) as executor:
                futures = {
                    executor.submit(
                        process_single_report, url, tank_to_urls[url], args.no_ai
                    ): url
                    for url in new_urls
                }
                for future in concurrent.futures.as_completed(futures):
                    result = future.result()
                    if result.get("success"):
                        total_processed += 1
                    else:
                        total_errors += 1
                    progress.update(process_task, advance=1)

        else:
            total_processed = 0
            total_errors = 0

    console.print(f"\n{'=' * 60}")
    console.print(f"Processing complete!")
    console.print(f"Successfully processed: {total_processed} reports")
    console.print(f"Errors: {total_errors}")
    console.print(f"Output: {YAML_OUTPUT}")
    console.print(f"{'=' * 60}")

    return 0


if __name__ == "__main__":
    exit(main())
