import base64
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_configuration import release_build_number, update_configuration


class UpdateConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.environment = {
            'DOOMPILE_MACOS_UPDATE_FEED_URL': 'https://notes.example.org/doompile/downloads/macos/appcast.xml',
            'DOOMPILE_MACOS_UPDATE_PUBLIC_KEY': base64.b64encode(bytes(range(32))).decode(),
        }

    def test_unconfigured_developer_build_and_required_release(self):
        self.assertEqual(update_configuration({}, defaults={}), {})
        with self.assertRaises(ValueError):
            update_configuration({}, defaults={}, required=True)

    def test_signed_updates_and_daily_checks_are_enabled_without_silent_install(self):
        config = update_configuration(self.environment, defaults={})
        self.assertEqual(config['SUFeedURL'], self.environment['DOOMPILE_MACOS_UPDATE_FEED_URL'])
        self.assertTrue(config['SURequireSignedFeed'])
        self.assertTrue(config['SUVerifyUpdateBeforeExtraction'])
        self.assertTrue(config['SUEnableAutomaticChecks'])
        self.assertFalse(config['SUAutomaticallyUpdate'])
        self.assertFalse(config['SUEnableSystemProfiling'])

    def test_unsafe_feeds_and_invalid_public_keys_fail_the_build(self):
        for feed in ('http://example.com/appcast.xml', 'file:///appcast.xml',
                     'https://user:password@example.com/appcast.xml',
                     'https://example.com/appcast.xml?token=private',
                     'https://example.com/appcast.xml#fragment', 'https://example.com/',
                     'https://exa mple.com/appcast.xml'):
            with self.subTest(feed=feed), self.assertRaises(ValueError):
                update_configuration({**self.environment, 'DOOMPILE_MACOS_UPDATE_FEED_URL': feed}, defaults={})
        for key in ('invalid', base64.b64encode(bytes(31)).decode(), base64.b64encode(bytes(64)).decode()):
            with self.subTest(key=key), self.assertRaises(ValueError):
                update_configuration({**self.environment, 'DOOMPILE_MACOS_UPDATE_PUBLIC_KEY': key}, defaults={})

    def test_public_defaults_and_explicit_overrides(self):
        defaults = {'feedURL': self.environment['DOOMPILE_MACOS_UPDATE_FEED_URL'],
                    'publicKey': self.environment['DOOMPILE_MACOS_UPDATE_PUBLIC_KEY']}
        self.assertEqual(update_configuration({}, defaults=defaults), update_configuration(self.environment, defaults={}))
        self.assertEqual(update_configuration({'DOOMPILE_MACOS_UPDATE_FEED_URL': 'https://staging.example.com/appcast.xml'}, defaults=defaults)['SUFeedURL'], 'https://staging.example.com/appcast.xml')

    def test_build_numbers_do_not_silently_reuse_one_for_local_releases(self):
        self.assertEqual(release_build_number({'GITHUB_RUN_NUMBER': '123', 'GITHUB_RUN_ATTEMPT': '2'}), '123.2')
        self.assertEqual(release_build_number({'GITHUB_RUN_NUMBER': '123', 'DOOMPILE_MACOS_BUILD_NUMBER': '124.1'}), '124.1')
        for build in ('', '0', '-1', 'build-seven', '1.2.3.4', '1/2', '1\n2'):
            with self.subTest(build=build), self.assertRaises(ValueError):
                release_build_number({'DOOMPILE_MACOS_BUILD_NUMBER': build})


if __name__ == '__main__':
    unittest.main()
