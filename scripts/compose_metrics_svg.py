#!/usr/bin/env python3
"""Replace Metrics' isocalendar plot with the animated night-green grid only."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


SVG_NS = "http://www.w3.org/2000/svg"
SVG_TAG = f"{{{SVG_NS}}}svg"
GROUP_TAG = f"{{{SVG_NS}}}g"
STYLE_TAG = f"{{{SVG_NS}}}style"

ET.register_namespace("", SVG_NS)
ET.register_namespace("xhtml", "http://www.w3.org/1999/xhtml")


def require_one(items: list[ET.Element], message: str) -> ET.Element:
    if len(items) != 1:
        raise ValueError(f"{message}: expected one match, found {len(items)}")
    return items[0]


def compose(metrics_path: Path, night_green_path: Path, output_path: Path) -> None:
    metrics_tree = ET.parse(metrics_path)
    metrics = metrics_tree.getroot()
    night_green = ET.parse(night_green_path).getroot()

    charts = []
    for node in metrics.iter(SVG_TAG):
        values = re.findall(r"-?\d+(?:\.\d+)?", node.attrib.get("viewBox", ""))
        if values == ["0", "0", "480", "270"]:
            charts.append(node)
    chart = require_one(charts, "Metrics isocalendar SVG")

    # The old file has one large group for the 3D contribution grid, followed
    # by separate radar, language donut, and footer groups. Keep the grid only.
    grid_groups = [
        node for node in night_green if node.tag == GROUP_TAG and len(list(node)) > 300
    ]
    grid = require_one(grid_groups, "night-green contribution grid")

    old_styles = "\n".join(
        "".join(node.itertext()) for node in night_green if node.tag == STYLE_TAG
    )
    grid_rules = re.findall(
        r"\.cont-(?:top|left|right)-[0-4]\s*\{[^}]+\}", old_styles
    )
    if len(grid_rules) != 15:
        raise ValueError(f"Expected 15 night-green color rules, found {len(grid_rules)}")

    metrics_style = require_one(
        [
            node
            for node in metrics
            if node.tag == STYLE_TAG and "animation-gauge" in (node.text or "")
        ],
        "Metrics root stylesheet",
    )
    metrics_style.text = (metrics_style.text or "") + "\n" + "\n".join(grid_rules)

    # The crop keeps the full grid while matching Metrics' 16:9 plot area.
    # No source background rectangle is copied, so the composite stays clear.
    chart.set("viewBox", "0 130 1280 720")
    chart.set("aria-label", "Animated night-green contribution grid")
    for child in list(chart):
        chart.remove(child)
    chart.append(deepcopy(grid))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_tree.write(output_path, encoding="utf-8", xml_declaration=False)

    # Fail the workflow rather than publish an incomplete or wrong composition.
    result = ET.parse(output_path).getroot()
    foreign_object = require_one(
        [node for node in result.iter() if node.tag.endswith("foreignObject")],
        "Metrics annotations",
    )
    annotation_text = " ".join("".join(foreign_object.itertext()).split())
    annotation_classes = {
        token
        for node in foreign_object.iter()
        for token in node.attrib.get("class", "").split()
    }
    if "avatar" not in annotation_classes or "calendar" not in annotation_classes:
        raise ValueError("Avatar or small header calendar annotations are missing")
    if "Joined GitHub" not in annotation_text or "Contributed to" not in annotation_text:
        raise ValueError("Profile name/joined/contributed header annotations are missing")
    if "Commits streaks" not in annotation_text or "Current streak" not in annotation_text:
        raise ValueError("Streak annotations are missing")
    if re.search(r"Followed by\s+\d+\s+users?", annotation_text, re.IGNORECASE):
        raise ValueError("Followers annotation was not removed")
    if sum(node.tag.endswith("animate") for node in result.iter()) == 0:
        raise ValueError("Night-green animation elements are missing")
    if any(node.attrib.get("class") == "fill-bg" for node in result.iter()):
        raise ValueError("A background rectangle was copied; output must stay transparent")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: compose_metrics_svg.py METRICS.svg NIGHT_GREEN.svg OUTPUT.svg"
        )
    try:
        compose(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
    except (ET.ParseError, OSError, ValueError) as error:
        raise SystemExit(f"SVG composition failed: {error}") from error
