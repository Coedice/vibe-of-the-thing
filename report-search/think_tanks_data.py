import os
from pathlib import Path

import yaml

_yaml_cache = None
# Point to _data/think_tanks.yml in the project root
_yaml_path = Path(__file__).parent.parent / "_data" / "think_tanks.yml"


def _load_yaml():
    """Load think tank data from YAML file."""
    global _yaml_cache
    if _yaml_cache is not None:
        return _yaml_cache

    with open(_yaml_path, "r") as f:
        data = yaml.safe_load(f)

    _yaml_cache = data.get("think_tanks", [])
    return _yaml_cache


def save_yaml(think_tanks):
    """Save think tank data to YAML file."""
    global _yaml_cache
    with open(_yaml_path, "w") as f:
        yaml.dump(
            {"think_tanks": think_tanks}, f, default_flow_style=False, sort_keys=False
        )
    _yaml_cache = think_tanks


def get_all_think_tanks():
    """Return all think tanks as a flat list."""
    return _load_yaml()


def get_think_tank_by_slug(slug):
    """Return a think tank by its slug."""
    for tank in _load_yaml():
        if tank.get("slug") == slug:
            return tank
    return None


def get_total_count():
    """Return total number of think tanks."""
    return len(_load_yaml())
