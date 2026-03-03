from .common import GenericPdfHarness


class AcciHarness(GenericPdfHarness):
    name = "Australian Chamber of Commerce and Industry"
    seed_paths = [
        "/resource?collection=4",
        "/resource?collection=5",
        "/Web/Shared_Content/Smart-Suite/Smart-Library/Public/ACCI-Resources.aspx",
    ]
