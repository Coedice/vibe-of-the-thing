from .common import GenericPdfHarness


class ChifleyHarness(GenericPdfHarness):
    name = "Chifley Research Centre"
    seed_paths = [
        "/publications/",
        "/latest-from-the-centre/",
    ]
