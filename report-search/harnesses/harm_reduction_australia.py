from .common import GenericPdfHarness


class HarmReductionAustraliaHarness(GenericPdfHarness):
    name = "Harm Reduction Australia"
    seed_paths = [
        "/",
        "/resources/",
        "/news/",
        "/publications/",
        "/submissions/",
    ]
