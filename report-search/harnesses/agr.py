from .common import GenericPdfHarness


class AgrHarness(GenericPdfHarness):
    name = "Alliance for Gambling Reform"
    seed_paths = [
        "/policiesandreports",
        "/in-the-news",
        "/take-action",
    ]
