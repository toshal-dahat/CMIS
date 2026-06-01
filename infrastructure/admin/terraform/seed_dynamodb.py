import sys
import boto3
from botocore.exceptions import ClientError

table_name = sys.argv[1]
region     = sys.argv[2]

client = boto3.client("dynamodb", region_name=region)

items = [
  {
    "PK":             {"S": "CONFIG#THEME"},
    "SK":             {"S": "METADATA"},
    "primaryColor":   {"S": "#500000"},
    "secondaryColor": {"S": "#FFFFFF"},
    "logoURL":        {"S": "https://cdn.cmis.tamu.edu/logo.png"},
    "updatedAt":      {"S": "2026-02-14T10:00:00Z"}
  },
  {
    "PK":               {"S": "TIER#gold"},
    "SK":               {"S": "METADATA"},
    "tierId":           {"S": "gold"},
    "name":             {"S": "Gold"},
    "rank":             {"N": "1"},
    "earlyAccessHours": {"N": "48"},
    "createdAt":        {"S": "2026-02-14T10:00:00Z"},
    "updatedAt":        {"S": "2026-02-14T10:00:00Z"}
  },
  {
    "PK":               {"S": "TIER#silver"},
    "SK":               {"S": "METADATA"},
    "tierId":           {"S": "silver"},
    "name":             {"S": "Silver"},
    "rank":             {"N": "2"},
    "earlyAccessHours": {"N": "24"},
    "createdAt":        {"S": "2026-02-14T10:00:00Z"},
    "updatedAt":        {"S": "2026-02-14T10:00:00Z"}
  },
  {
    "PK":        {"S": "COMPANY#c001"},
    "SK":        {"S": "METADATA"},
    "companyId": {"S": "c001"},
    "name":      {"S": "ExxonMobil"},
    "domain":    {"S": "exxonmobil.com"},
    "tierId":    {"S": "gold"},
    "createdAt": {"S": "2026-02-14T10:00:00Z"},
    "updatedAt": {"S": "2026-02-14T10:00:00Z"}
  }
]

for item in items:
  try:
    client.put_item(
      TableName=table_name,
      Item=item,
      ConditionExpression="attribute_not_exists(PK)"
    )
    print("Inserted: " + item["PK"]["S"])
  except ClientError as e:
    if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
      print("Skipped (already exists): " + item["PK"]["S"])
    else:
      raise
