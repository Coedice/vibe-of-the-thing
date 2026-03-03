from .common import GenericPdfHarness


class CotaHarness(GenericPdfHarness):
    name = "COTA Australia"
    seed_paths = [
        "/our-work/",
        "/our-work/cota-submissions/",
        "/resources/",
        "/report/",
    ]
