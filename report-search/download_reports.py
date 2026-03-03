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
import json
import tempfile
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


def process_single_report(pdf_url: str, tank: dict) -> bool:
    """Process a single report through all phases: download, convert, shrink, AI extract, save."""
    tank_slug = tank["slug"]

    # Use temporary files that get cleaned up automatically
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as pdf_file:
        pdf_path = Path(pdf_file.name)
    md_path = pdf_path.with_suffix(".md")

    try:
        # Phase 1: Download PDF to temporary file
        print(f"  Downloading PDF...")
        response = requests.get(pdf_url, timeout=60)
        response.raise_for_status()
        with open(pdf_path, "wb") as f:
            f.write(response.content)

        # Phase 2: Convert to markdown
        print(f"  Converting to markdown...")
        md_converter = MarkItDown()

        pdf_converted = False
        try:
            result = md_converter.convert(str(pdf_path))
            content = getattr(result, "text_content", None) or str(result)
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(content)
            pdf_converted = True
        except:
            # Catch ANY exception from PDF conversion
            print(f"  Error converting PDF, creating blank markdown")
            try:
                md_path.write_text("", encoding="utf-8")
            except:
                pass

        # Delete PDF after conversion attempt (success or failure)
        try:
            if pdf_path.exists():
                pdf_path.unlink()
        except:
            pass

        # Phase 3: Shrink markdown
        print(f"  Shrinking markdown...")
        with open(md_path, "r", encoding="utf-8") as f:
            content = f.read()
        reduced_content = extract_recommendations_context(content)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(reduced_content)

        # Phase 4: Extract AI summary
        print(f"  Extracting AI summary...")
        with open(md_path, "r", encoding="utf-8") as f:
            content = f.read()
        ai_result = extract_recommendations(content)

        # Phase 5: Add to YAML and cleanup
        print(f"  Adding to YAML: {ai_result.get('title', 'Untitled')[:50]}...")
        report = {
            "think_tank": tank["name"],
            "source_url": pdf_url,
            "slug": tank_slug,
            "title": ai_result.get("title", "Untitled"),
            "recommendations": ai_result.get("recommendations", []),
        }

        # Load existing reports
        YAML_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        existing_reports = []
        if YAML_OUTPUT.exists():
            with open(YAML_OUTPUT, "r", encoding="utf-8") as f:
                existing_data = yaml.safe_load(f)
                if existing_data:
                    existing_reports = existing_data.get("reports", []) or []

        # Add new report
        existing_reports.append(report)

        # Save to YAML
        with open(YAML_OUTPUT, "w", encoding="utf-8") as f:
            yaml.dump(
                {"reports": existing_reports},
                f,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
            )

        # Delete markdown file after successful save
        md_path.unlink()

        print(f"  ✓ Completed: {report['title'][:50]}...\n")
        return True

    except Exception as e:
        print(f"  ✗ Error processing {pdf_url}: {type(e).__name__}: {e}\n")
        # Cleanup any leftover files
        for p in [pdf_path, md_path]:
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Collect research reports from think tanks and convert to YAML"
    )
    parser.add_argument(
        "--delay",
        "-d",
        type=float,
        default=1.0,
        help="Delay between requests in seconds (default: 1.0)",
    )
    parser.add_argument(
        "--count", action="store_true", help="Show think tank count and exit"
    )

    args = parser.parse_args()

    if args.count:
        print(f"Total think tanks: {get_total_count()}")
        return 0

    # Setup
    think_tanks = get_all_think_tanks()
    print(f"Found {len(think_tanks)} think tanks")

    existing_urls = load_existing_json_reports()
    if existing_urls:
        print(f"Found {len(existing_urls)} existing reports in YAML, will skip those\n")

    # Process reports
    total_processed = 0
    total_errors = 0

    console = Console()
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Processing reports...", total=len(think_tanks))

        for tank in think_tanks:
            print(f"\n{'=' * 60}")
            print(f"Think Tank: {tank['name']}")
            print(f"{'=' * 60}")

            try:
                # Scrape to get report URLs
                result = scrape_think_tank(tank)
                tank_slug = tank["slug"]

                for pdf_url in result.pdf_urls:
                    if pdf_url in existing_urls:
                        continue

                    # Process this single report through all phases
                    success = process_single_report(pdf_url, tank)

                    if success:
                        total_processed += 1
                    else:
                        total_errors += 1

                    # Add delay between reports
                    time.sleep(args.delay)

            except Exception as e:
                print(f"Error scraping {tank.get('name', 'Unknown')}: {e}\n")
                total_errors += 1

            progress.update(task, advance=1)

    print(f"\n{'=' * 60}")
    print(f"Processing complete!")
    print(f"Successfully processed: {total_processed} reports")
    print(f"Errors: {total_errors}")
    print(f"Output: {YAML_OUTPUT}")
    print(f"{'=' * 60}")

    return 0


if __name__ == "__main__":
    exit(main())
