import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
import urllib.error


spec = importlib.util.spec_from_file_location(
    'apple_api', Path(__file__).resolve().parents[1]/'.agents/ci/apple_api.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


def http_error(status, headers=None):
    return urllib.error.HTTPError('https://api.appstoreconnect.apple.com/v1/builds',
        status, 'error', headers or {}, io.BytesIO(b'{"errors":[{"code":"UNEXPECTED_ERROR"}]}'))


def response(value):
    result = MagicMock()
    result.__enter__.return_value.read.return_value = json.dumps(value).encode()
    return result


class AppleAPITests(unittest.TestCase):
    def setUp(self):
        self.token = patch.object(api, 'access_token', return_value='test-token').start()
        self.sleep = patch.object(api.time, 'sleep').start()
        patch.object(api.sys, 'stderr', new_callable=io.StringIO).start()
        self.addCleanup(patch.stopall)

    def test_transient_read_recovers_without_restarting_upload(self):
        with patch.object(api.urllib.request, 'urlopen', side_effect=[
                http_error(500), http_error(503), response({'data': []})]) as send:
            self.assertEqual(api.request('/v1/builds'), {'data': []})
        self.assertEqual(send.call_count, 3)
        self.assertEqual([call.args[0] for call in self.sleep.call_args_list], [2, 4])

    def test_rate_limit_respects_retry_after(self):
        with patch.object(api.urllib.request, 'urlopen', side_effect=[
                http_error(429, {'Retry-After': '25'}), response({})]):
            api.request('/v1/builds')
        self.sleep.assert_called_once_with(25)

    def test_retry_is_bounded_and_does_not_expose_response_body(self):
        def fail(*args, **kwargs):
            raise http_error(500)
        with patch.object(api.urllib.request, 'urlopen', side_effect=fail) as send:
            with self.assertRaisesRegex(RuntimeError, '^App Store Connect HTTP 500 UNEXPECTED_ERROR$'):
                api.request('/v1/builds')
        self.assertEqual(send.call_count, 6)
        self.assertEqual(self.sleep.call_count, 5)

    def test_client_errors_and_mutations_are_not_retried(self):
        for method, status in [('GET', 400), ('GET', 401), ('GET', 403), ('POST', 500)]:
            with self.subTest(method=method, status=status), patch.object(
                    api.urllib.request, 'urlopen', side_effect=http_error(status)) as send:
                with self.assertRaises(RuntimeError):
                    api.request('/v1/builds', method, {'data': {}} if method=='POST' else None)
                self.assertEqual(send.call_count, 1)
        self.sleep.assert_not_called()

    def test_network_failure_is_retried_without_logging_exception(self):
        with patch.object(api.urllib.request, 'urlopen', side_effect=[
                urllib.error.URLError('sensitive transport details'), response({})]):
            self.assertEqual(api.request('/v1/builds'), {})
        self.assertNotIn('sensitive', api.sys.stderr.getvalue())

    def test_build_number_uses_all_app_scoped_pages(self):
        with patch.object(api, 'request', side_effect=[
                {'data': [{'attributes': {'version': '22.1'}}],
                 'links': {'next': 'https://api.appstoreconnect.apple.com/v1/apps/test/builds?cursor=next'}},
                {'data': [{'attributes': {'version': '30.1'}}], 'links': {'next': None}}]) as send:
            self.assertEqual(api.next_build(), '31.1')
        self.assertTrue(send.call_args_list[0].args[0].startswith('/v1/apps/'+api.APP_ID+'/builds?'))
        self.assertNotIn('include', send.call_args_list[0].args[0])
        self.assertEqual(send.call_args_list[1].args[0], '/v1/apps/test/builds?cursor=next')

    def test_pagination_cannot_redirect_credentials_or_loop(self):
        query = api.urllib.parse.urlencode({'limit': 200,
            'fields[builds]': 'version,uploadedDate,processingState'})
        first = 'https://api.appstoreconnect.apple.com/v1/apps/'+api.APP_ID+'/builds?'+query
        for next_url in ['https://example.com/v1/builds', first]:
            with self.subTest(next_url=next_url), patch.object(api, 'request', return_value={
                    'data': [], 'links': {'next': next_url}}) as send:
                with self.assertRaises(RuntimeError):
                    api.builds()
                send.assert_called_once()
