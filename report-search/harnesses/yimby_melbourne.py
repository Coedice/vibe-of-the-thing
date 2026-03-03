from .common import GenericPdfHarness


class YimbyMelbourneHarness(GenericPdfHarness):
    name = "YIMBY Melbourne"
    seed_paths = [
        "/",
        "/news/",
        "/submissions/",
        "/policy/",
    ]
