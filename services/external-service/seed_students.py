#!/usr/bin/env python3
"""Seed dummy graduating students into the students DynamoDB table.

Usage:
    STUDENTS_TABLE=<table-name> python seed_students.py

Notes:
- This is a local/dev helper; Lambda runtime does not import this module.
- Seed rows intentionally include a mix of personal-email-only and TAMU-backed
  records to exercise graduation-handover edge cases.
"""
import os
import sys
import boto3

TABLE = os.environ.get("STUDENTS_TABLE", "cmis-external-students")

DUMMY_STUDENTS = [
    {"uin": "100123456", "grad_date": "2025-01-15", "account_status": "STUDENT", "personal_email": "alice.grad@personal.gmail.com", "class_year": "25"},
    {"uin": "100234567", "grad_date": "2025-02-01", "account_status": "STUDENT", "personal_email": "bob.grad@personal.gmail.com", "class_year": "25"},
    {"uin": "100345678", "grad_date": "2025-02-14", "account_status": "STUDENT", "personal_email": "carol.grad@personal.gmail.com", "class_year": "25"},
    {"uin": "100888888", "grad_date": "2025-02-14", "account_status": "STUDENT", "personal_email": "yashassuresh775@gmail.com", "class_year": "25", "tamu_email": "yashassuresh@tamu.edu"},
    {"uin": "012364790", "grad_date": "2025-02-15", "account_status": "STUDENT", "personal_email": "test25@gmail.com", "class_year": "25"},
    {"uin": "112233445", "grad_date": "2025-03-01", "account_status": "STUDENT", "personal_email": "shreya.rprakash@tamu.edu", "class_year": "25", "tamu_email": "shreya.rprakash@tamu.edu"},
]


def main():
    dynamo = boto3.resource("dynamodb")
    table = dynamo.Table(TABLE)
    for s in DUMMY_STUDENTS:
        table.put_item(Item=s)
        print(f"Seeded: {s['uin']} ({s['personal_email']})")
    print(f"Done. Seeded {len(DUMMY_STUDENTS)} students.")


if __name__ == "__main__":
    main()
