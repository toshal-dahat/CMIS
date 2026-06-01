import shutil
import subprocess
import sys
from pathlib import Path


def copy_source(source_dir: Path, build_dir: Path) -> None:
    for item in source_dir.rglob("*"):
        if "__pycache__" in item.parts:
            continue
        if item.suffix == ".pyc":
            continue

        relative = item.relative_to(source_dir)
        destination = build_dir / relative
        if item.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
            continue

        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, destination)


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: build_pptx_extractor_package.py <source_dir> <build_dir> <requirements_path>"
        )

    source_dir = Path(sys.argv[1]).resolve()
    build_dir = Path(sys.argv[2]).resolve()
    requirements_path = Path(sys.argv[3]).resolve()

    if build_dir.exists():
        shutil.rmtree(build_dir)
    build_dir.mkdir(parents=True, exist_ok=True)

    subprocess.check_call(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-r",
            str(requirements_path),
            "-t",
            str(build_dir),
            "--no-compile",
        ]
    )

    copy_source(source_dir, build_dir)


if __name__ == "__main__":
    main()
