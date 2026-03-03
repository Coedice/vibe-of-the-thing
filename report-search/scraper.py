import importlib
import os

from harnesses import ScrapeResult


def _get_harness_instance(think_tank: dict):
    """Load the harness instance for a think tank, or return None if not found."""
    harness_name = think_tank.get("harness")
    if not harness_name:
        return None

    harness_dir = os.path.join(os.path.dirname(__file__), "harnesses")
    module_path = os.path.join(harness_dir, f"{harness_name}.py")

    if os.path.exists(module_path):
        module = importlib.import_module(f"harnesses.{harness_name}")
        # Get the harness class (e.g., GrattanHarness, SuperpowerHarness)
        class_name = (
            "".join(word.capitalize() for word in harness_name.split("_")) + "Harness"
        )
        if hasattr(module, class_name):
            return getattr(module, class_name)()

    return None


def create_driver():
    """Create a Selenium WebDriver."""
    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-blink-features=AutomationControlled")


def scrape_think_tank(think_tank: dict) -> ScrapeResult:
    """Scrape research reports for a think tank using its harness."""
    result = ScrapeResult(
        name=think_tank["name"],
        source_type="think_tank",
    )

    # Try to use harness
    harness = _get_harness_instance(think_tank)

    if harness:
        try:
            return harness.scrape(think_tank)
        except Exception as e:
            result.errors.append(f"Harness error: {str(e)}")

    result.errors.append("No harness available for this think tank")
    return result
