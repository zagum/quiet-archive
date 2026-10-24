"""Exercise the real installer only against isolated temporary directories."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import install_chrome as installer


def extension(path, version='1.1.0'):
    path.mkdir(parents=True, exist_ok=True)
    (path / 'manifest.json').write_text(json.dumps({
        'manifest_version': 3, 'name': 'Closure', 'version': version,
        'background': {'service_worker': 'background.js'},
        'action': {'default_popup': 'popup.html'},
    }))
    (path / 'background.js').write_text('// local worker\n')
    (path / 'popup.html').write_text('<h1>Closure</h1>\n')
    return path


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.chrome = self.root / 'Chrome data'
        self.chrome.mkdir()
        self.source = extension(self.root / 'build')

    def archive(self, prefix=''):
        archive = self.root / 'closure-chrome.zip'
        with ZipFile(archive, 'w') as zipped:
            for file in self.source.iterdir():
                zipped.write(file, prefix + file.name)
        return archive

    def test_zip_is_unpacked_into_permanent_chrome_directory(self):
        result = installer.install_extension(self.chrome, archive=self.archive())
        self.assertEqual(result.target, self.chrome / 'Unpacked Extensions' / 'Closure')
        self.assertEqual((result.target / 'popup.html').read_text(), '<h1>Closure</h1>\n')
        self.assertIsNone(result.backup)

    def test_source_directory_and_zip_with_one_wrapper_folder_are_supported(self):
        target = self.chrome / 'Unpacked Extensions' / 'First'
        installer.install_extension(self.chrome, source=self.source, target=target)
        other = self.chrome / 'Unpacked Extensions' / 'Second'
        installer.install_extension(self.chrome, archive=self.archive('closure/'), target=other)
        self.assertEqual((target / 'background.js').read_bytes(), (other / 'background.js').read_bytes())

    def test_existing_legacy_path_is_reused_and_previous_files_are_backed_up(self):
        legacy = extension(self.chrome / 'Unpacked Extensions' / 'Quiet Archive', '1.0.0')
        (legacy / 'old-only.js').write_text('old code')
        profile = self.chrome / 'Default'
        profile.mkdir()
        preferences = profile / 'Secure Preferences'
        preferences.write_bytes(b'profile settings must stay untouched')
        state = profile / 'Local Extension Settings' / 'example-id'
        state.mkdir(parents=True)
        (state / 'state.ldb').write_bytes(b'archive and settings')
        result = installer.install_extension(self.chrome, source=self.source)
        self.assertEqual(result.target, legacy)
        self.assertEqual(json.loads((legacy / 'manifest.json').read_text())['version'], '1.1.0')
        self.assertFalse((legacy / 'old-only.js').exists())
        self.assertEqual((result.backup / 'old-only.js').read_text(), 'old code')
        self.assertEqual(preferences.read_bytes(), b'profile settings must stay untouched')
        self.assertEqual((state / 'state.ldb').read_bytes(), b'archive and settings')

    def test_dry_run_validates_without_writing_chrome_files(self):
        before = list(self.chrome.iterdir())
        result = installer.install_extension(self.chrome, archive=self.archive(), dry_run=True)
        self.assertFalse(result.target.exists())
        self.assertEqual(list(self.chrome.iterdir()), before)

    def test_unrelated_existing_folder_is_not_overwritten(self):
        target = self.chrome / 'Unpacked Extensions' / 'Closure'
        target.mkdir(parents=True)
        (target / 'personal.txt').write_text('keep me')
        with self.assertRaises(installer.InstallError):
            installer.install_extension(self.chrome, source=self.source)
        self.assertEqual((target / 'personal.txt').read_text(), 'keep me')

    def test_invalid_package_does_not_disturb_previous_installation(self):
        target = extension(self.chrome / 'Unpacked Extensions' / 'Closure', '1.0.0')
        (self.source / 'background.js').unlink()
        with self.assertRaises(installer.InstallError):
            installer.install_extension(self.chrome, source=self.source)
        self.assertEqual(json.loads((target / 'manifest.json').read_text())['version'], '1.0.0')

    def test_zip_traversal_absolute_and_windows_style_paths_are_rejected(self):
        for name in ['../escape.txt', '/escape.txt', 'C:/escape.txt', '..\\escape.txt']:
            archive = self.archive()
            with ZipFile(archive, 'a') as zipped:
                zipped.writestr(name, 'bad')
            with self.subTest(name=name), self.assertRaises(installer.InstallError):
                installer.install_extension(self.chrome, archive=archive)
            self.assertFalse((self.root / 'escape.txt').exists())
            self.assertFalse((self.chrome / 'Unpacked Extensions').exists())

    def test_symlinks_in_zip_and_source_are_rejected(self):
        archive = self.archive()
        with ZipFile(archive, 'a') as zipped:
            link = ZipInfo('linked')
            link.create_system = 3
            link.external_attr = 0o120777 << 16
            zipped.writestr(link, '../outside')
        with self.assertRaises(installer.InstallError):
            installer.install_extension(self.chrome, archive=archive)
        (self.source / 'linked').symlink_to(self.root)
        with self.assertRaises(installer.InstallError):
            installer.install_extension(self.chrome, source=self.source)

    def test_ambiguous_legacy_and_current_paths_require_explicit_target(self):
        first = extension(self.chrome / 'Unpacked Extensions' / 'Closure')
        extension(self.chrome / 'Unpacked Extensions' / 'Quiet Archive')
        with self.assertRaises(installer.InstallError):
            installer.install_extension(self.chrome, source=self.source)
        self.assertEqual(installer.install_extension(self.chrome, source=self.source, target=first).target, first)

    def test_browser_managed_profile_directories_are_never_targets(self):
        for target in [self.chrome, self.chrome / 'Default', self.chrome / 'Profile 2' / 'Extensions', self.chrome / 'Extensions']:
            with self.subTest(target=target), self.assertRaises(installer.InstallError):
                installer.install_extension(self.chrome, source=self.source, target=target)
        self.assertEqual(list(self.chrome.iterdir()), [])

    def test_profile_path_checks_reject_case_variants_on_case_insensitive_systems(self):
        targets = [
            self.chrome / 'default' / 'installed',
            self.chrome / 'pRoFiLe 2' / 'installed',
            self.chrome / 'extensions' / 'installed',
            self.chrome / 'guest PROFILE' / 'installed',
            self.chrome / 'system PROFILE' / 'installed',
            self.chrome.with_name('cHrOmE DaTa') / 'Default' / 'installed',
        ]
        for target in targets:
            with self.subTest(target=target), self.assertRaises(installer.InstallError):
                installer.install_extension(self.chrome, source=self.source, target=target)
        self.assertEqual(list(self.chrome.iterdir()), [])

    def test_failed_directory_swap_restores_old_installation(self):
        target = extension(self.chrome / 'Unpacked Extensions' / 'Closure', '1.0.0')
        original = Path.rename
        calls = 0
        def fail_second_rename(path, destination):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('simulated filesystem failure')
            return original(path, destination)
        with patch.object(Path, 'rename', fail_second_rename):
            with self.assertRaises(installer.InstallError):
                installer.install_extension(self.chrome, source=self.source)
        self.assertEqual(json.loads((target / 'manifest.json').read_text())['version'], '1.0.0')
        self.assertTrue((target / 'background.js').exists())

    def test_default_chrome_directory_respects_platform_and_xdg(self):
        home = self.root / 'home'
        self.assertEqual(installer.default_chrome_dir('darwin', home, {}), home / 'Library/Application Support/Google/Chrome')
        self.assertEqual(installer.default_chrome_dir('linux', home, {'XDG_CONFIG_HOME': str(self.root / 'config')}), self.root / 'config/google-chrome')
        self.assertEqual(installer.default_chrome_dir('win32', home, {'LOCALAPPDATA': str(self.root / 'local')}), self.root / 'local/Google/Chrome/User Data')

    def test_cli_reports_target_and_first_load_step_and_returns_nonzero_for_bad_zip(self):
        archive = self.archive()
        command = [sys.executable, str(ROOT / 'scripts/install_chrome.py'), '--zip', str(archive), '--chrome-data-dir', str(self.chrome)]
        result = subprocess.run(command, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(str(self.chrome / 'Unpacked Extensions' / 'Closure'), result.stdout)
        self.assertIn('Load unpacked', result.stdout)
        archive.write_bytes(b'not a zip')
        result = subprocess.run(command, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main()
