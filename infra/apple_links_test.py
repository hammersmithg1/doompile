import unittest
from apple_links import link_configuration


class AppleLinksTests(unittest.TestCase):
    def test_unconfigured_builds_keep_their_existing_signing_capabilities(self):
        self.assertEqual(link_configuration(''), ({}, {}))

    def test_https_origin_configures_only_applinks(self):
        self.assertEqual(link_configuration('https://Notes.Example.com/'), (
            {'DoompilePublicURL': 'https://notes.example.com'},
            {'com.apple.developer.associated-domains': ['applinks:notes.example.com']}))

    def test_loopback_is_copyable_but_not_associated(self):
        self.assertEqual(link_configuration('http://localhost:3000'), ({'DoompilePublicURL': 'http://localhost:3000'}, {}))

    def test_migration_keeps_the_old_origin_for_local_account_storage(self):
        self.assertEqual(link_configuration('https://notes.example.com', previous='https://Old.Example.com/'), (
            {'DoompilePublicURL': 'https://notes.example.com', 'DoompilePreviousPublicURL': 'https://old.example.com'},
            {'com.apple.developer.associated-domains': ['applinks:notes.example.com']}))
        with self.assertRaises(ValueError):
            link_configuration('https://notes.example.com', previous='http://localhost:3000')

    def test_invalid_and_credential_bearing_origins_fail(self):
        for origin in ['http://notes.example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?token=x', 'https://example.com:8443']:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                link_configuration(origin)


if __name__ == '__main__':
    unittest.main()
