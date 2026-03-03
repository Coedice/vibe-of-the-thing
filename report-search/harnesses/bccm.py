from .common import GenericPdfHarness


class BccmHarness(GenericPdfHarness):
    name = "Business Council of Co-operatives and Mutuals"
    seed_paths = [
        "/news/",
        "/about/key-projects/",
        "/campaign/",
    ]
