from .common import GenericPdfHarness


class JcrcHarness(GenericPdfHarness):
    name = "John Curtin Research Centre"
    seed_paths = [
        "/",
        "/publications/",
        "/resources/",
    ]
