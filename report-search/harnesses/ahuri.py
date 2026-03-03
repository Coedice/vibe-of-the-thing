from .common import GenericPdfHarness


class AhuriHarness(GenericPdfHarness):
    name = "Australian Housing and Urban Research Institute"
    seed_paths = [
        "/research",
        "/publications",
    ]
