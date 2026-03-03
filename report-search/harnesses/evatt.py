from .common import GenericPdfHarness


class EvattHarness(GenericPdfHarness):
    name = "Evatt Foundation"
    max_pages = 70
    seed_paths = [
        "/papers",
        "/news",
        "/publications",
        "/evatt-journal-vol-20",
        "/evatt-journal-vol-19",
    ]
