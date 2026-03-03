from .common import GenericPdfHarness


class SydneyPolicyLabHarness(GenericPdfHarness):
    name = "Sydney Policy Lab"
    seed_paths = [
        "/sydney-policy-lab/news-and-events.html",
        "/sydney-policy-lab.html",
    ]
