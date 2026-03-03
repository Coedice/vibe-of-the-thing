from .common import GenericPdfHarness


class AspiHarness(GenericPdfHarness):
    name = "Australian Strategic Policy Institute"
    seed_paths = [
        "/all-work/?s=&filter_tag=all&filter_programs=all&filter_category=report",
        "/report/",
        "/RSS_Feed",
    ]
