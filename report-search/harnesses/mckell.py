from .common import GenericPdfHarness


class MckellHarness(GenericPdfHarness):
    name = "McKell Institute"
    seed_paths = [
        "/research/",
        "/research/reports/",
        "/policy-area/",
    ]
