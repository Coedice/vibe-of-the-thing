from .common import GenericPdfHarness


class PwdHarness(GenericPdfHarness):
    name = "People with Disability Australia"
    seed_paths = [
        "/resources/",
        "/disability-rights/",
        "/news/",
    ]
