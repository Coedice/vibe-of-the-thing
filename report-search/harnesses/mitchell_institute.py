from .common import GenericPdfHarness


class MitchellInstituteHarness(GenericPdfHarness):
    name = "Mitchell Institute"
    seed_paths = [
        "/mitchell-institute/education-policy-reports",
        "/mitchell-institute/publications",
    ]
