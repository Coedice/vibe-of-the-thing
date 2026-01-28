import os
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import requests
import yaml


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


@dataclass
class TimeseriesSource:
    name: str
    category: str
    source_title: str
    source_url: str
    weight: float
    inverted: bool
    color: str
    api_url: str


def get_last_completed_month() -> tuple[int, int]:
    today = datetime.now()
    if today.month == 1:
        return today.year - 1, 12
    return today.year, today.month - 1


def extend_to_last_completed_month(data: list[dict]) -> list[dict]:
    if not data:
        return data

    last_date_str = data[-1]["date"]
    last_year, last_month = map(int, last_date_str.split("-"))
    target_year, target_month = get_last_completed_month()

    if (last_year > target_year) or (
        last_year == target_year and last_month >= target_month
    ):
        return data

    last_value = data[-1]["value"]
    while last_year < target_year or (
        last_year == target_year and last_month < target_month
    ):
        if last_month == 12:
            last_month = 1
            last_year += 1
        else:
            last_month += 1
        data.append({"date": f"{last_year}-{last_month:02d}", "value": last_value})

    return data


def parse_abs_xml(xml_text: str) -> list[dict]:
    ns = {
        "sdmx": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic",
        "message": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message",
    }

    root = ET.fromstring(xml_text)

    data = []
    for series in root.findall(".//sdmx:Series", ns):
        for obs in series.findall("sdmx:Obs", ns):
            time_period = obs.find("sdmx:ObsDimension", ns)
            obs_value = obs.find("sdmx:ObsValue", ns)

            if time_period is not None and obs_value is not None:
                period = time_period.get("value")
                value = obs_value.get("value")

                if value and period:
                    try:
                        value = float(value)
                        monthly_dates = parse_period_to_monthly_dates(period)
                        for date in monthly_dates:
                            data.append({"date": date, "value": value})
                    except ValueError:
                        pass

    return sorted(data, key=lambda x: x["date"])


def parse_period_to_monthly_dates(period: str) -> list[str]:
    # Handle quarterly format: yyyy-Qx
    match = re.match(r"(\d{4})-Q([1-4])", period)
    if match:
        year, quarter = int(match.group(1)), int(match.group(2))
        start_month = (quarter - 1) * 3 + 1
        months = []
        for m in range(start_month, start_month + 3):
            month_str = f"{m:02d}"
            months.append(f"{year}-{month_str}")
        return months

    # Handle monthly format: yyyy-mm
    match = re.match(r"(\d{4})-(\d{2})", period)
    if match:
        year, month = match.groups()
        return [f"{year}-{month}"]

    # Handle yearly format: yyyy
    match = re.match(r"^(\d{4})$", period)
    if match:
        year = match.group(1)
        months = []
        for m in range(1, 13):
            month_str = f"{m:02d}"
            months.append(f"{year}-{month_str}")
        return months

    return [period]


def fetch_url(url: str, max_retries: int = 3) -> Optional[str]:
    for attempt in range(max_retries):
        try:
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            return response.text
        except requests.RequestException as e:
            if attempt < max_retries - 1:
                wait_time = 2**attempt
                print(f"Attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                print(f"Failed to fetch {url}: {e}")
                return None


def generate_timeseries_data(sources_path: str, output_path: str) -> None:
    with open(sources_path, "r") as f:
        sources_data = yaml.safe_load(f)

    sources = [TimeseriesSource(**s) for s in sources_data]

    print(f"Processing {len(sources)} sources...")

    results = {}
    for source in sources:
        slug = slugify(source.name)
        if source.api_url:
            print(f"Fetching {source.name} from {source.api_url}...")
            xml_content = fetch_url(source.api_url)
            if xml_content:
                data = parse_abs_xml(xml_content)
                data = extend_to_last_completed_month(data)
                results[slug] = data
                print(f"  Fetched {len(data)} data points")
            else:
                results[slug] = []
                print(f"  Failed to fetch data")
        else:
            results[slug] = []
            print(f"  No API URL configured - using empty data")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        yaml.dump(
            results, f, sort_keys=False, allow_unicode=True, default_flow_style=False
        )

    print(f"Wrote {len(results)} series to {output_path}")


if __name__ == "__main__":
    sources_file = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "_data", "timeseries_sources.yml")
    )
    output_file = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "_data", "timeseries_data.yml")
    )
    generate_timeseries_data(sources_file, output_file)
