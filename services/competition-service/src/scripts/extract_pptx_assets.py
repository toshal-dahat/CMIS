import json
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_pptx_assets.py <input_pptx> <output_json>")

    script_path = Path(__file__).resolve()
    extractor_root = script_path.parents[3] / "pptx-extractor"
    sys.path.insert(0, str(extractor_root))

    from pptx_extraction import extract_presentation

    input_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()

    extraction = extract_presentation(input_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(extraction, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
