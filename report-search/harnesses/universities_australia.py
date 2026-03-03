from .common import GenericPdfHarness


class UniversitiesAustraliaHarness(GenericPdfHarness):
    name = "Universities Australia"
    seed_paths = [
        "/policy-submissions/",
        "/stats-publications/",
        "/submission/",
        "/publication/",
    ]
