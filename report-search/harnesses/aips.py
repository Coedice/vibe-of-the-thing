from .common import GenericPdfHarness


class AipsHarness(GenericPdfHarness):
    name = "Australian Institute of Policy and Science"
    max_pages = 60
    seed_paths = [
        "/aq-magazine/",
        "/aq-magazine/back-issues/",
        "/aq-magazine/aq-history/",
        "/about/",
    ]
