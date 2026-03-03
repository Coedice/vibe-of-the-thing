"""Generate YAML data from PDF reports using markitdown."""

import base64
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import ollama
import requests
import yaml
from harnesses import ScrapeResult
from markitdown import MarkItDown


def _sanitize_filename(filename: str) -> str:
    """Convert a filename to a safe filesystem name."""
    # Remove extension if present
    if filename.lower().endswith(".pdf"):
        filename = filename[:-4]

    # Replace spaces and special characters
    filename = re.sub(r"[^\w\s-]", "", filename)
    filename = re.sub(r"[-\s]+", "-", filename)
    filename = filename.strip("-").lower()

    return filename or "report"


def _extract_filename_from_url(url: str) -> str:
    """Extract a reasonable filename from a URL."""
    try:
        # Try to get filename from URL path
        path = urlparse(url).path
        filename = os.path.basename(path)
        if filename and not filename.startswith("?"):
            return filename
    except:
        pass

    return "report.pdf"


def extract_recommendations_context(content: str) -> str:
    """
    Extract sections around each occurrence of 'recommendation' or 'recommendations'.
    Returns 100 lines above and below each occurrence, plus the first 30 lines for title.
    """
    lines = content.split("\n")
    num_lines = len(lines)

    # Always include first 60 lines for title extraction
    lines_to_include = set(range(0, min(60, num_lines)))

    # Find all line indices containing "recommendation" (case insensitive)
    matching_indices = []
    for i, line in enumerate(lines):
        if "recommendation" in line.lower():
            matching_indices.append(i)

    if matching_indices:
        # Keep context before and after each recommendation marker.
        for idx in matching_indices:
            start = max(0, idx - 120)
            end = min(num_lines, idx + 181)
            for i in range(start, end):
                lines_to_include.add(i)
    else:
        # Fallback for documents without explicit recommendation headings.
        for i in range(0, min(600, num_lines)):
            lines_to_include.add(i)

    # Extract the relevant lines, sorted by position
    relevant_lines = [lines[i] for i in sorted(lines_to_include)]

    return "\n".join(relevant_lines)


def extract_recommendations(content: str) -> dict:
    """
    Use Ollama to extract title and recommendations from markdown content.

    Returns:
        Dict with 'title' and 'recommendations' keys
    """
    # Extract relevant sections around "recommendation" keywords
    filtered_content = extract_recommendations_context(content)

    prompt = f"""You are a policy analyst. Extract ALL recommendations from the following report text.

Your response must be valid JSON in exactly this format:
{{
  "title": "The report title",
  "recommendations": [
    "Recommendation 1",
    "Recommendation 2",
    "Recommendation 3"
  ]
}}

CRITICAL RULES:
- You MUST include EVERY recommendation from the report - do not miss a single one
- Write each recommendation EXACTLY as it appears in the report (verbatim, no paraphrasing). Except that you may fix formatting issues like line breaks, spacing, or bullet points to make it more readable, but the wording must be identical to the source.
- Do not shorten, summarize, or modify any recommendation
- If there are numbered recommendations (1., 2., 3. or Recommendation 1, 2, 3), include ALL of them
- If recommendations are in a list or bullet points, include every item
- If no clear recommendations exist, return an empty recommendations array
- Do not include any other text or explanation
- Output ONLY valid JSON, nothing else

Report text:
{filtered_content}

JSON:"""

    try:
        response = ollama.chat(
            model="gpt-oss:120b-cloud",
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = response.message.content.strip()

        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        result = json.loads(response_text.strip())

        return {
            "title": result.get("title", "Untitled"),
            "recommendations": result.get("recommendations", []),
        }

    except Exception as e:
        print(f"Error extracting recommendations with Ollama: {e}")
        return {"title": "Untitled", "recommendations": []}


def convert_pdf_to_data(
    pdf_url: str,
    think_tank_name: str,
    slug: Optional[str] = None,
    report_num: Optional[int] = None,
) -> dict:
    """
    Download a PDF and convert it to a data structure with base64-encoded content.

    Returns:
        Dict with think_tank, source_url, slug, report_num, title, recommendations
    """
    try:
        # Download PDF to temporary file
        response = requests.get(pdf_url, timeout=30)
        response.raise_for_status()

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_file:
            tmp_file.write(response.content)
            tmp_path = tmp_file.name

        try:
            # Extract markdown from PDF using MarkItDown
            md_converter = MarkItDown()
            conversion_result = md_converter.convert(tmp_path)
            converted_body = getattr(conversion_result, "text_content", None) or str(
                conversion_result
            )

            # Extract title and recommendations using Ollama
            ai_result = extract_recommendations(converted_body)

            return {
                "think_tank": think_tank_name,
                "source_url": pdf_url,
                "slug": slug,
                "report_num": report_num,
                "title": ai_result.get("title", "Untitled"),
                "recommendations": ai_result.get("recommendations", []),
            }

        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except:
                pass

    except Exception as e:
        return {
            "think_tank": think_tank_name,
            "source_url": pdf_url,
            "slug": slug,
            "report_num": report_num,
            "title": "Error",
            "recommendations": [f"Error processing report: {str(e)}"],
            "error": str(e),
        }


def generate_report_data(
    result: ScrapeResult, tank_config: dict, existing_urls: Optional[set] = None
):
    """Generate data structures for all reports from a think tank."""
    if not result.pdf_urls:
        return []

    if existing_urls is None:
        existing_urls = set()

    report_data = []
    slug = tank_config.get("slug", "tank")

    for i, pdf_url in enumerate(result.pdf_urls, 1):
        # Skip if already processed
        if pdf_url in existing_urls:
            continue

        try:
            data = convert_pdf_to_data(pdf_url, result.name, slug=slug, report_num=i)
            report_data.append(data)
        except Exception as e:
            print(f"Error processing {pdf_url}: {e}")

    return report_data


def save_reports_yaml(all_reports: list, output_path: Path):
    """Save all reports to a YAML file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        yaml.dump(
            {"reports": all_reports},
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )
