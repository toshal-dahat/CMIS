#!/bin/bash
# Seed dummy graduating students for the graduation handover automation.
# Run after: terraform apply
# Usage: ./scripts/seed-students.sh
# Table name from Terraform: cmis-external-students

set -e
TABLE="${STUDENTS_TABLE:-cmis-external-students}"

echo "Seeding dummy students into $TABLE"

# Dummy students: grad_date in past or near future for testing
# Format: uin, grad_date (YYYY-MM-DD), account_status, personal_email, class_year
aws dynamodb batch-write-item --request-items "{
  \"$TABLE\": [
    {
      \"PutRequest\": {
        \"Item\": {
          \"uin\": {\"S\": \"100123456\"},
          \"grad_date\": {\"S\": \"2025-01-15\"},
          \"account_status\": {\"S\": \"STUDENT\"},
          \"personal_email\": {\"S\": \"alice.grad@personal.gmail.com\"},
          \"class_year\": {\"S\": \"25\"}
        }
      }
    },
    {
      \"PutRequest\": {
        \"Item\": {
          \"uin\": {\"S\": \"100234567\"},
          \"grad_date\": {\"S\": \"2025-02-01\"},
          \"account_status\": {\"S\": \"STUDENT\"},
          \"personal_email\": {\"S\": \"bob.grad@personal.gmail.com\"},
          \"class_year\": {\"S\": \"25\"}
        }
      }
    },
    {
      \"PutRequest\": {
        \"Item\": {
          \"uin\": {\"S\": \"100345678\"},
          \"grad_date\": {\"S\": \"2025-02-14\"},
          \"account_status\": {\"S\": \"STUDENT\"},
          \"personal_email\": {\"S\": \"carol.grad@personal.gmail.com\"},
          \"class_year\": {\"S\": \"25\"}
        }
      }
    },
    {
      \"PutRequest\": {
        \"Item\": {
          \"uin\": {\"S\": \"100888888\"},
          \"grad_date\": {\"S\": \"2025-02-14\"},
          \"account_status\": {\"S\": \"STUDENT\"},
          \"personal_email\": {\"S\": \"yashassuresh775@gmail.com\"},
          \"class_year\": {\"S\": \"25\"},
          \"tamu_email\": {\"S\": \"yashassuresh@tamu.edu\"}
        }
      }
    },
    {
      \"PutRequest\": {
        \"Item\": {
          \"uin\": {\"S\": \"012364790\"},
          \"grad_date\": {\"S\": \"2025-02-15\"},
          \"account_status\": {\"S\": \"STUDENT\"},
          \"personal_email\": {\"S\": \"test25@gmail.com\"},
          \"class_year\": {\"S\": \"25\"}
        }
      }
    },
    {
      \"PutRequest\": {
        \"Item\": {
          \"uin\": {\"S\": \"112233445\"},
          \"grad_date\": {\"S\": \"2025-03-01\"},
          \"account_status\": {\"S\": \"STUDENT\"},
          \"personal_email\": {\"S\": \"shreya.rprakash@tamu.edu\"},
          \"class_year\": {\"S\": \"25\"},
          \"tamu_email\": {\"S\": \"shreya.rprakash@tamu.edu\"}
        }
      }
    },
    {
      \"PutRequest\": {
        \"Item\": {
          \"uin\": {\"S\": \"100456789\"},
          \"grad_date\": {\"S\": \"2025-02-15\"},
          \"account_status\": {\"S\": \"STUDENT\"},
          \"personal_email\": {\"S\": \"abin.harshansindhil@tamu.edu\"},
          \"class_year\": {\"S\": \"25\"},
          \"tamu_email\": {\"S\": \"abin.harshansindhil@tamu.edu\"}
        }
      }
    }
  ]
}"

echo "Seeded 7 students (including abin.harshansindhil@tamu.edu, shreya.rprakash@tamu.edu, test25@gmail.com, yashassuresh775@gmail.com)."
echo "To trigger scan: aws lambda invoke --function-name cmis-external-external-service --cli-binary-format raw-in-base64-out --payload '{\"source\":\"aws.events\",\"detail-type\":\"Scheduled Event\"}' out.json && cat out.json"
