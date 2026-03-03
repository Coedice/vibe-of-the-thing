from .common import GenericPdfHarness


class AmaHarness(GenericPdfHarness):
    name = "Australian Medical Association"
    max_pages = 80
    seed_paths = [
        "/advocacy-policy",
        "/advocacy-policy?f%5B0%5D=type%3A5",
        "/advocacy-policy?f%5B0%5D=type%3A50",
        "/advocacy-policy?f%5B0%5D=type%3A51",
        "/resources",
    ]
