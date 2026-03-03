from .common import GenericPdfHarness


class BlueprintInstituteHarness(GenericPdfHarness):
    name = "Blueprint Institute"
    seed_paths = [
        "/publications",
        "/research",
    ]
