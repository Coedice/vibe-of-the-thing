from .common import GenericPdfHarness


class SafeAndEqualHarness(GenericPdfHarness):
    name = "Safe and Equal"
    seed_paths = [
        "/resources/",
        "/news/",
        "/about/annual-reports/",
    ]
