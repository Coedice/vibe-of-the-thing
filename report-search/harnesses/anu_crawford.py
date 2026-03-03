from .common import GenericPdfHarness


class AnuCrawfordHarness(GenericPdfHarness):
    name = "ANU Crawford School of Public Policy"
    seed_paths = [
        "/publication",
        "/research",
        "/policy",
    ]
