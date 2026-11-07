import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('upload_ios', Path(__file__).resolve().parents[1]/'.agents/ci/upload_ios.py')
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)


class IOSUploadTests(unittest.TestCase):
    def test_accepts_only_positive_receipt(self):
        receipt = {'success-message': "No errors uploading 'Doompile.ipa'"}
        self.assertEqual(upload.require_upload_success(0, json.dumps(receipt)), receipt)

    def test_zero_exit_does_not_hide_apple_validation_error(self):
        receipt = {'product-errors': [{'code': 409, 'message': 'Invalid manifest file'}]}
        with self.assertRaisesRegex(RuntimeError, 'rejected'):
            upload.require_upload_success(0, json.dumps(receipt))

    def test_rejects_unconfirmed_or_failed_upload(self):
        for status, output in [(0, '{}'), (0, 'UPLOAD FAILED with 1 error'), (0, '[]'),
                               (1, '{"success-message":"stale receipt"}')]:
            with self.subTest(status=status, output=output), self.assertRaises(RuntimeError):
                upload.require_upload_success(status, output)
