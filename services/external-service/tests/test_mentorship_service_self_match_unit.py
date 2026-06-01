"""Unit tests for mentorship_service self-match guardrails."""

import unittest
from unittest.mock import patch

import mentorship_service


class _FakeMatchesTable:
    def __init__(self) -> None:
        self.writes = []

    def get_item(self, Key):  # noqa: N802 (boto3 style)
        return {}

    def put_item(self, **kwargs):  # noqa: N802 (boto3 style)
        self.writes.append(kwargs)
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}


class TestMentorshipServiceSelfMatch(unittest.TestCase):
    def test_upsert_suggestions_skips_self_match_candidate(self) -> None:
        table = _FakeMatchesTable()
        candidates = [
            {"menteeUserId": "mentor-1", "finalScore": 0.99},
            {"menteeUserId": "mentee-1", "finalScore": 0.75},
        ]
        with (
            patch.object(mentorship_service, "_matches_table", return_value=table),
            patch.object(mentorship_service, "_count_channel_opened_for_mentee", return_value=0),
            patch.object(mentorship_service, "_mentee_has_active_queue_elsewhere", return_value=False),
            patch.object(mentorship_service, "mentee_max_active_matches", return_value=3),
            patch.object(mentorship_service, "_top_k", return_value=10),
        ):
            saved = mentorship_service.upsert_suggestions("mentor-1", candidates, mentor_display_name="Mentor")

        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]["menteeUserId"], "mentee-1")
        self.assertEqual(len(table.writes), 1)


if __name__ == "__main__":
    unittest.main()
