from .common import GenericPdfHarness


class MavHarness(GenericPdfHarness):
    name = "Municipal Association of Victoria"
    seed_paths = [
        "/news-resources/publications/submissions",
        "/news-resources/publications",
        "/what-we-do/policy-advocacy",
    ]
