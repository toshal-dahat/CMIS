import json
import os
import tempfile
from pathlib import Path

import boto3

from pptx_extraction import extract_presentation


s3_client = boto3.client("s3")


def lambda_handler(event, _context):
    bucket = (event or {}).get("bucket")
    s3_key = (event or {}).get("s3Key")
    if not bucket or not s3_key:
        return {
            "ok": False,
            "error": "Both 'bucket' and 's3Key' are required.",
        }

    max_images_returned = int(os.environ.get("PPTX_MAX_IMAGES_RETURNED", "6"))
    max_image_bytes = int(os.environ.get("PPTX_MAX_IMAGE_BYTES", str(400 * 1024)))

    with tempfile.TemporaryDirectory() as temp_dir:
        local_path = Path(temp_dir) / "submission.pptx"
        s3_client.download_file(bucket, s3_key, str(local_path))

        extraction = extract_presentation(
            local_path,
            max_images_returned=max_images_returned,
            max_image_bytes=max_image_bytes,
        )

    return {
        "ok": True,
        "extraction": extraction,
    }
