from .common import GenericPdfHarness


class E61Harness(GenericPdfHarness):
    name = "e61 Institute"
    seed_paths = [
        "/category/research/",
        "/category/news/",
        "/data/",
    ]
