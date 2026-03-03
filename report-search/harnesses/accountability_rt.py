from .common import GenericPdfHarness


class AccountabilityRtHarness(GenericPdfHarness):
    name = "Accountability Round Table"
    seed_paths = [
        "/category/submissions/",
        "/category/annual-integrity-lecture/",
        "/integrity-lecture-awards/",
    ]
