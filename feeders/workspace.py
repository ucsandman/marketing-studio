"""Shared product-workspace boundary for native render feeders."""

import re
import tempfile
from pathlib import Path


def _inside(parent: Path, child: Path) -> bool:
    return child == parent or child.is_relative_to(parent)


def resolve_feeder_output(
    *,
    engine_root: Path,
    feeder: str,
    scene: Path,
    out: str | None,
    project: str | None,
    brand: str | None,
    diagnostic_temp: bool,
) -> tuple[Path, Path | None]:
    """Return a bounded output directory and optional product repository."""
    engine = engine_root.resolve()
    if diagnostic_temp:
        if project:
            raise ValueError("--diagnostic-temp cannot be combined with --project")
        temp_root = Path(tempfile.gettempdir()).resolve()
        default = temp_root / "marketing-studio-diagnostics" / feeder / scene.stem
        output = (
            (temp_root / out).resolve()
            if out and not Path(out).is_absolute()
            else Path(out or default).resolve()
        )
        if not _inside(temp_root, output):
            raise ValueError(
                f"diagnostic output must stay inside the OS temp directory: {temp_root}"
            )
        return output, None

    if not project:
        raise ValueError("production render requires --project <external-product-repo>")
    if not brand or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*", brand):
        raise ValueError("production render requires --brand <safe-slug>")
    project_root = Path(project).resolve()
    if not project_root.is_dir() or not (project_root / ".git").exists():
        raise ValueError(
            f"product repository does not exist or has no .git marker: {project_root}"
        )
    if _inside(engine, project_root) or _inside(project_root, engine):
        raise ValueError("product repository must be outside the animation engine")
    sequence = scene.stem.replace("_", "-")
    default = project_root / "marketing" / "assets" / brand / "assets" / sequence
    output = (
        (project_root / out).resolve()
        if out and not Path(out).is_absolute()
        else Path(out or default).resolve()
    )
    if not _inside(project_root, output):
        raise ValueError(f"output must stay inside product repository: {project_root}")
    return output, project_root
