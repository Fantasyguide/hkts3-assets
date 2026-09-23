import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { root, sync, validate, verify, pack, sha256, baseForCommit } from '../scripts/assets.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hkts3-assets-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(join(root, 'public'), join(dir, 'public'), { recursive: true });
  await cp(join(root, 'manifest.json'), join(dir, 'manifest.json'));
  return dir;
}

test('prepared public directory contains only validated images', async () => {
  const manifest = await validate(root);
  assert.ok(manifest.files.length > 0);
  assert.ok(manifest.files.reduce((sum, file) => sum + file.bytes, 0) > 0);
});

test('changed bytes, unlisted private files, traversal and symlinks are rejected', async (t) => {
  const dir = await fixture(t);
  const manifest = await validate(dir); const first = manifest.files[0];
  const path = join(dir, 'public', first.path); const bytes = await readFile(path);
  await writeFile(path, Buffer.concat([bytes, Buffer.from('tamper')]));
  await assert.rejects(() => validate(dir), /mismatch/);
  await writeFile(path, bytes);
  await writeFile(join(dir, 'public', 'answer.json'), '{}');
  await assert.rejects(() => validate(dir), /Unlisted/);
  await rm(join(dir, 'public', 'answer.json'));
  await rm(path); await symlink(join(root, 'public', first.path), path);
  await assert.rejects(() => validate(dir), /Symlink/);
  await rm(path); await writeFile(path, bytes);
  first.path = '../private.webp';
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(() => validate(dir), /Invalid/);
});

test('import previews without writing and preserves old hashes on image replacement', async (t) => {
  const dir = await fixture(t); const manifest = await validate(dir);
  const bundle = join(dir, 'bundle'); await mkdir(bundle);
  const file = { ...manifest.files[0] };
  // Alter WebP metadata bytes for this fixture; the publisher verifies format signature and hash, not image decoding.
  const bytes = Buffer.concat([await readFile(join(dir, 'public', file.path)), Buffer.from('new-version')]);
  file.sha256 = sha256(bytes); file.bytes = bytes.length;
  file.path = file.path.replace(/-[a-f0-9]{20}\./, `-${file.sha256.slice(0, 20)}.`);
  await mkdir(dirname(join(bundle, file.path)), { recursive: true });
  await writeFile(join(bundle, file.path), bytes);
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify({ schemaVersion: 1, event: 'hkts3', files: [file] }));
  assert.equal((await sync(bundle, dir)).total, manifest.files.length + 1);
  assert.equal((await validate(dir)).files.length, manifest.files.length);
  assert.equal((await sync(bundle, dir, { apply: true })).added.length, 1);
  assert.equal((await validate(dir)).files.length, manifest.files.length + 1);
  assert.equal((await sync(bundle, dir, { apply: true })).added.length, 0);
});

test('archive contains public assets only and refuses uncommitted edits', async (t) => {
  const dir = await fixture(t);
  await writeFile(join(dir, '.gitignore'), 'dist/\n');
  await writeFile(join(dir, 'private.key'), 'must-not-upload');
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-b', 'main'); git('add', '.');
  git('-c', 'user.name=Asset Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const result = await pack(dir);
  const entries = execFileSync('python3', ['-c', 'import sys,zipfile,json; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', join(result.directory, 'public.zip')], { encoding: 'utf8' });
  const names = JSON.parse(entries);
  assert.equal(names.filter(name => name.endsWith('.webp')).length, 20);
  assert.ok(!names.some(name => name.endsWith('.html') || name.endsWith('.json')));
  assert.ok(!names.some((name) => name.startsWith('public/') || name.includes('private') || name.includes('manifest')));
  await writeFile(join(dir, 'private.key'), 'changed');
  await assert.rejects(() => pack(dir), /pending changes/);
});

test('CDN probe checks content and missing-image status without following redirects or querying the app', async () => {
  const manifest = await validate(root); const paths = [];
  const fetcher = async (url, options) => {
    assert.equal(url.hostname, 'cdn.jsdmirror.com');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    paths.push(url.pathname);
    const file = manifest.files.find((entry) => url.pathname.endsWith('/public/' + entry.path));
    if (!file) return new Response('Not found', { status: 404 });
    return new Response(await readFile(join(root, 'public', file.path)), { headers: {
      'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable', 'cross-origin-resource-policy': 'cross-origin',
    } });
  };
  assert.equal((await verify(baseForCommit('a'.repeat(40)), manifest, fetcher)).results.length, manifest.files.length);
  assert.equal(paths.length, manifest.files.length + 1);
  await assert.rejects(() => verify('https://riddle.fantasyguide.cn/', manifest, fetcher), /dedicated CDN/);
});

test('CDN addresses require the correct repository and immutable commit', async () => {
  assert.throws(() => baseForCommit('main'), /commit/);
  const manifest = await validate(root);
  for (const base of ['https://cdn.jsdmirror.com/gh/Fantasyguide/hkts3-assets@main/public/', 'https://cdn.jsdmirror.com/gh/other/repo@' + 'a'.repeat(40) + '/public/']) {
    await assert.rejects(() => verify(base, manifest, () => { throw new Error('must not fetch'); }), /dedicated CDN/);
  }
  const bad = async () => new Response('<html>upstream error</html>', { headers: {'content-type':'text/html'} });
  await assert.rejects(() => verify(baseForCommit('a'.repeat(40)), manifest, bad), /mismatch/);
});
