"""Unit tests for pure helpers in mentorship_board (no AWS)."""

import unittest

from mentorship_board import (
    _classic_slug_rank,
    _display_slug,
    _normalize_tier_value,
    _prefer_better_tier,
)


class TestMentorshipBoardHelpers(unittest.TestCase):
    def test_classic_slug_rank_order(self) -> None:
        self.assertEqual(_classic_slug_rank("gold"), 1)
        self.assertEqual(_classic_slug_rank("silver"), 2)
        self.assertEqual(_classic_slug_rank("bronze"), 3)
        self.assertEqual(_classic_slug_rank("unknown"), 99)

    def test_normalize_tier_value(self) -> None:
        self.assertEqual(_normalize_tier_value("GOLD"), "gold")
        self.assertEqual(_normalize_tier_value("board_silver"), "silver")
        self.assertEqual(_normalize_tier_value(None), "none")

    def test_display_slug(self) -> None:
        self.assertEqual(_display_slug("  Platinum Partner  "), "platinum-partner")

    def test_prefer_better_tier(self) -> None:
        gold = ("gold", 1)
        silver = ("silver", 2)
        self.assertEqual(_prefer_better_tier(None, gold), gold)
        self.assertEqual(_prefer_better_tier(silver, gold), gold)
        self.assertEqual(_prefer_better_tier(gold, silver), gold)


if __name__ == "__main__":
    unittest.main()
