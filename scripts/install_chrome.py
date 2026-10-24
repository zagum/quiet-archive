#!/usr/bin/env python3
"""Prepare Closure in a permanent directory; Chrome confirms first loading in its UI.

Python 3.10+, standard library only. Never edits browser preferences, policies,
registration, or extension storage. Suitable for a release ZIP or a built dist/.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import unicodedata
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

MAX_BYTES = 64 * 1024 * 1024
MAX_FILES = 5000
NAMES = {'Closure', 'Quiet Archive'}


class InstallError(Exception):
    """An expected validation or installation failure, safe to show without a traceback."""


@dataclass
class InstallResult:
    target: Path
    backup: Path | None = None


def default_chrome_dir(system=None, home=None, env=None):
    system = sys.platform if system is None else system
    home = Path.home() if home is None else Path(home)
    env = os.environ if env is None else env
    if system == 'darwin':
        return home / 'Library/Application Support/Google/Chrome'
    if system == 'win32':
        return Path(env.get('LOCALAPPDATA', str(home / 'AppData/Local'))) / 'Google/Chrome/User Data'
    if system.startswith('linux'):
        return Path(env.get('XDG_CONFIG_HOME', str(home / '.config'))) / 'google-chrome'
    raise InstallError('Unsupported platform. Pass --chrome-data-dir for your Chrome installation.')


def _manifest(directory):
    try:
        manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        raise InstallError(f'Not a Closure extension directory: {directory}') from error
    if (not isinstance(manifest, dict) or manifest.get('manifest_version') != 3
            or manifest.get('name') not in NAMES
            or not isinstance(manifest.get('version'), str)
            or not re.fullmatch(r'\d+(?:\.\d+){0,3}', manifest['version'])):
        raise InstallError(f'Expected a Closure / Quiet Archive Manifest V3 package: {directory}')
    return manifest


def _relative_path(name):
    if (not isinstance(name, str) or not name or '\\' in name or ':' in name
            or name.startswith('/') or '\x00' in name
            or any(part in ('', '.', '..') for part in name.rstrip('/').split('/'))):
        raise InstallError(f'Unsafe package path: {name!r}')
    return PurePosixPath(name.rstrip('/'))


def _validate_tree(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise InstallError('The source must be a regular extension directory, not a symlink.')
    count = total = 0
    for root, directories, files in os.walk(directory, followlinks=False):
        for name in directories + files:
            path = Path(root) / name
            mode = path.lstat().st_mode
            if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise InstallError(f'Unsupported file or symlink in package: {path}')
            if stat.S_ISREG(mode):
                count += 1
                total += path.stat().st_size
    if count > MAX_FILES or total > MAX_BYTES:
        raise InstallError('Package is too large (maximum 64 MiB / 5000 files).')
    manifest = _manifest(directory)
    references = []
    worker = manifest.get('background', {}).get('service_worker')
    popup = manifest.get('action', {}).get('default_popup')
    if not worker or not popup:
        raise InstallError('Package must contain a service worker and popup.')
    references.extend([worker, popup])
    references.extend(manifest.get('icons', {}).values())
    action_icons = manifest.get('action', {}).get('default_icon', {})
    references.extend(action_icons.values() if isinstance(action_icons, dict) else [action_icons])
    for content in manifest.get('content_scripts', []):
        references.extend(content.get('js', []))
        references.extend(content.get('css', []))
    for name in references:
        relative = _relative_path(name)
        if not directory.joinpath(*relative.parts).is_file():
            raise InstallError(f'Missing manifest resource: {name}')
    return manifest


def _unpack(archive, destination):
    try:
        with ZipFile(archive) as zipped:
            entries = zipped.infolist()
            if len(entries) > MAX_FILES or sum(e.file_size for e in entries) > MAX_BYTES:
                raise InstallError('ZIP is too large (maximum 64 MiB / 5000 entries).')
            seen = set()
            for entry in entries:
                relative = _relative_path(entry.filename)
                key = str(relative).casefold()
                mode = stat.S_IFMT(entry.external_attr >> 16)
                if key in seen or mode not in (0, stat.S_IFREG, stat.S_IFDIR):
                    raise InstallError(f'Duplicate path, symlink or special file in ZIP: {entry.filename}')
                seen.add(key)
                if entry.flag_bits & 1:
                    raise InstallError('Encrypted ZIP files are not supported.')
            zipped.extractall(destination)
    except (BadZipFile, RuntimeError, NotImplementedError) as error:
        raise InstallError(f'Cannot read extension ZIP: {error}') from error
    if (destination / 'manifest.json').is_file():
        return destination
    children = [p for p in destination.iterdir() if p.name not in ('__MACOSX', '.DS_Store')]
    if len(children) == 1 and children[0].is_dir() and (children[0] / 'manifest.json').is_file():
        return children[0]
    raise InstallError('ZIP must contain manifest.json at its root or in one enclosing folder.')


def _target(chrome_dir, explicit=None):
    base = chrome_dir / 'Unpacked Extensions'
    if explicit is not None:
        return Path(explicit).expanduser().absolute()
    existing = [p for p in (base / 'Closure', base / 'Quiet Archive') if p.exists() or p.is_symlink()]
    if len(existing) > 1:
        raise InstallError('Both Closure and Quiet Archive directories exist. Use --target with the currently loaded path.')
    return existing[0] if existing else base / 'Closure'


def _path_parts(path):
    # macOS/Windows may compare case-insensitively; macOS also normalizes Unicode.
    # Apply the conservative comparison on every OS for predictable protection.
    return tuple(unicodedata.normalize('NFC', part).casefold() for part in path.parts)


def _contains(parent, child):
    return child[:len(parent)] == parent


def _validate_target(target, chrome_dir, source=None):
    resolved = _path_parts(target.resolve())
    chrome = _path_parts(chrome_dir.resolve())
    if resolved == chrome:
        raise InstallError('The Chrome data directory itself cannot be an installation target.')
    if _contains(chrome, resolved):
        first = resolved[len(chrome)]
        if first in ('default', 'extensions', 'system profile', 'guest profile') or first.startswith('profile '):
            raise InstallError('Do not install into browser-managed profile or Extensions directories.')
    paths = [target]
    # System aliases such as macOS /var -> /private/var are normal. Only reject
    # redirected installation folders beneath the selected Chrome data root.
    parent = target.parent
    chrome_lexical = _path_parts(chrome_dir)
    while _path_parts(parent) != chrome_lexical and _contains(chrome_lexical, _path_parts(parent)):
        paths.append(parent)
        parent = parent.parent
    if any(p.is_symlink() for p in paths):
        raise InstallError('The installation directory must not contain symlinks. Use its real path explicitly.')
    if source is not None:
        origin = _path_parts(source.resolve())
        if _contains(origin, resolved) or _contains(resolved, origin):
            raise InstallError('The source and target directories must be separate and must not contain each other.')
    if target.exists():
        if not target.is_dir():
            raise InstallError(f'Target exists and is not an extension directory: {target}')
        _manifest(target)  # never replace an unrelated folder


def install_extension(chrome_dir, *, source=None, archive=None, target=None, dry_run=False):
    if (source is None) == (archive is None):
        raise InstallError('Provide exactly one source: --zip or --source.')
    chrome_dir = Path(chrome_dir).expanduser().absolute()
    chosen = _target(chrome_dir, target)
    source = Path(source).expanduser().absolute() if source is not None else None
    _validate_target(chosen, chrome_dir, source)
    backup = None
    stage = None
    try:
        with tempfile.TemporaryDirectory(prefix='closure-package-') as scratch:
            payload = _unpack(Path(archive).expanduser(), Path(scratch)) if archive is not None else source
            _validate_tree(payload)
            if dry_run:
                return InstallResult(chosen)
            chosen.parent.mkdir(parents=True, exist_ok=True)
            stage = Path(tempfile.mkdtemp(prefix='.closure-install-', dir=chosen.parent))
            # Populate a sibling on the same filesystem before changing the live path.
            shutil.copytree(payload, stage, dirs_exist_ok=True)
            _validate_tree(stage)
            _validate_target(chosen, chrome_dir, source)
            if chosen.exists():
                stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
                backup = chosen.with_name(f'{chosen.name}.backup-{stamp}-{uuid4().hex[:8]}')
                chosen.rename(backup)
            try:
                stage.rename(chosen)
                stage = None
            except OSError as error:
                if backup is not None and not chosen.exists():
                    try:
                        backup.rename(chosen)
                    except OSError as rollback_error:
                        raise InstallError(f'Install failed; restore the code backup at {backup} to {chosen}: {rollback_error}') from error
                raise InstallError(f'Install failed; previous installation restored: {error}') from error
    except InstallError:
        raise
    except (OSError, ValueError, TypeError, AttributeError) as error:
        raise InstallError(f'Installation failed: {error}') from error
    finally:
        if stage is not None:
            shutil.rmtree(stage, ignore_errors=True)
    return InstallResult(chosen, backup)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    inputs = parser.add_mutually_exclusive_group()
    inputs.add_argument('--zip', type=Path, dest='archive', help='Release ZIP (no npm dependencies needed)')
    inputs.add_argument('--source', type=Path, help='Built extension directory, normally dist/')
    parser.add_argument('--chrome-data-dir', type=Path, help='Chrome user-data root; defaults to your OS location')
    parser.add_argument('--target', type=Path, help='Existing loaded extension path, or a new permanent directory')
    parser.add_argument('--dry-run', action='store_true', help='Validate and print the target without changing Chrome files')
    args = parser.parse_args(argv)
    try:
        chrome = args.chrome_data_dir or default_chrome_dir()
        if args.chrome_data_dir is None and not chrome.is_dir():
            raise InstallError('Chrome data directory not found. Launch Chrome once or pass --chrome-data-dir.')
        source, archive = args.source, args.archive
        if source is None and archive is None:
            beside_script = Path(__file__).resolve().parent / 'closure-chrome.zip'
            built = Path(__file__).resolve().parents[1] / 'dist'
            if beside_script.is_file():
                archive = beside_script
            elif built.is_dir():
                source = built
            else:
                raise InstallError('Pass --zip closure-chrome.zip, or build the project and pass --source dist.')
        result = install_extension(chrome, source=source, archive=archive, target=args.target, dry_run=args.dry_run)
        print('Dry run; no Chrome files changed.' if args.dry_run else 'Closure files installed successfully.')
        print(f'Extension directory: {result.target}')
        if result.backup:
            print(f'Previous code backup: {result.backup}')
        print('\nFirst install: chrome://extensions -> Developer mode -> Load unpacked -> select the directory above.')
        print('Update an existing install: click Reload on the extension card. Keep the same loaded directory.')
        print('Chrome settings, registration and profile archive data were not modified.')
        return 0
    except (InstallError, OSError) as error:
        print(f'Closure installer: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
