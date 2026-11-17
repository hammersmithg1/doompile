import copy
import importlib.util
import unittest
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location("composer_fixture", Path(__file__).parents[1] / "scripts/composer-fixture.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class SyncFixtureTests(unittest.TestCase):
    def test_revision_retries_and_real_conflicts(self):
        review = fixture.SyncReview()
        note = review.start()
        edit = copy.deepcopy(note)
        edit["plainText"] += " local"
        saved, status, _ = review.write(edit, 1)
        self.assertEqual(status, 200)
        self.assertEqual(saved["note"]["revision"], 2)
        self.assertEqual(review.write(edit, 1)[:2], (saved, 200))
        remote = review.remote_edit()
        edit["plainText"] += " newer"
        conflict, status, delay = review.write(edit, 2)
        self.assertEqual((status, delay), (409, 2))
        self.assertEqual(conflict["current"], remote)
        branch = {**edit, "id": str(uuid.uuid4()), "revision": 0}
        _, status, _ = review.write(branch, 0)
        self.assertEqual(status, 200)
        state = review.snapshot()
        self.assertEqual(state["conflicts"], 1)
        self.assertEqual(len(state["notes"]), 2)
        self.assertEqual(next(n for n in state["notes"] if n["id"] == note["id"]), remote)

    def test_normal_composer_reviews_remain_stateless(self):
        review = fixture.SyncReview()
        note = {"id": str(uuid.uuid4()), "plainText": "Composer"}
        self.assertEqual(review.write(note, 0), ({"note": {**note, "revision": 1}}, 201, 0))
        review.start()
        review.reset()
        self.assertEqual(review.snapshot()["notes"], [])
        self.assertFalse(review.snapshot()["active"])
