#!/usr/bin/env python3
"""
Idempotent seed for MasterSkills DynamoDB table.
Inserts each default skill once (ConditionExpression on skillId).
Re-running after adding new names to default_master_skills.json inserts only the new rows.
"""
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

# Deterministic UUIDs per normalized key so seed and app logic can match without a scan.
SKILL_NAMESPACE = uuid.UUID("a3bb189e-8bf9-3888-8fa9-aa6088a1fc2d")


def normalize_key(canonical: str) -> str:
    s = canonical.lower().strip()
    for old, new in (
        ("c++", "cplusplus"),
        ("c#", "csharp"),
        ("f#", "fsharp"),
        (".net", "dotnet"),
    ):
        s = s.replace(old, new)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: seed_master_skills.py <table_name> <region>", file=sys.stderr)
        sys.exit(1)

    table_name = sys.argv[1]
    region = sys.argv[2]

    data_path = Path(__file__).resolve().parent / "data" / "default_master_skills.json"
    with open(data_path, encoding="utf-8") as f:
        payload = json.load(f)

    names = payload.get("skills") or []
    if not isinstance(names, list):
        print("default_master_skills.json must contain a 'skills' array", file=sys.stderr)
        sys.exit(1)

    seen_keys: set[str] = set()
    deduped: list[str] = []
    for n in names:
        if not isinstance(n, str):
            continue
        t = n.strip()
        if not t:
            continue
        k = normalize_key(t)
        if k in seen_keys:
            print(f"Skip duplicate normalized key '{k}' for '{t}'")
            continue
        seen_keys.add(k)
        deduped.append(t)

    table = boto3.resource("dynamodb", region_name=region).Table(table_name)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    inserted = 0
    skipped = 0
    for canonical in sorted(deduped, key=str.lower):
        nk = normalize_key(canonical)
        skill_id = str(uuid.uuid5(SKILL_NAMESPACE, nk))
        try:
            table.put_item(
                Item={
                    "skillId": skill_id,
                    "canonicalName": canonical,
                    "normalizedKey": nk,
                    "source": "seed",
                    "createdAt": now,
                },
                ConditionExpression="attribute_not_exists(skillId)",
            )
            inserted += 1
            print(f"Inserted: {canonical} ({skill_id})")
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                skipped += 1
            else:
                raise

    print(f"Done. Inserted {inserted}, skipped (already present) {skipped}.")


if __name__ == "__main__":
    main()
