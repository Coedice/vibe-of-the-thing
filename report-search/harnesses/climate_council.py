from .common import GenericPdfHarness


class ClimateCouncilHarness(GenericPdfHarness):
    name = "Climate Council"
    seed_paths = [
        "/resources/",
        "/reports/",
    ]
