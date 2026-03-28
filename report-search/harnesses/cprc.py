from .common import GenericPdfHarness


class CprcHarness(GenericPdfHarness):
    name = "Consumer Policy Research Centre"
    seed_paths = [
        "/research/reports/",
        "/report/",
        "/submission/",
    ]
