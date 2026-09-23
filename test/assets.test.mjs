import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { root, sync, validate, verify, pack, sha256 } from '../scripts/assets.mjs';
import { selectProject } from '../scripts/publish.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hkts3-assets-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(join(root, 'public'), join(dir, 'public'), { recursive: true });
  await cp(join(root, 'manifest.json'), join(dir, 'manifest.json'));
  return dir;
}

test('prepared public directory contains only validated images and hosting controls', async () => {
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
  await mkdir(join(bundle, 'Grill-The-Grid', 'characters'), { recursive: true });
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
  assert.ok(names.includes('index.html')); assert.ok(names.includes('edgeone.json'));
  assert.ok(!names.some((name) => name.startsWith('public/') || name.includes('private') || name.includes('manifest')));
  await writeFile(join(dir, 'private.key'), 'changed');
  await assert.rejects(() => pack(dir), /pending changes/);
});

test('CDN probe checks content and missing-image status without following redirects or querying the app', async () => {
  const manifest = await validate(root); const paths = [];
  const fetcher = async (url, options) => {
    assert.equal(url.hostname, 'hkts3-assets.fantasyguide.cn');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    paths.push(url.pathname);
    const file = manifest.files.find((entry) => `/${entry.path}` === url.pathname);
    if (!file) return new Response('Not found', { status: 404 });
    return new Response(await readFile(join(root, 'public', file.path)), { headers: {
      'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable', 'cross-origin-resource-policy': 'cross-origin',
    } });
  };
  assert.equal((await verify('https://hkts3-assets.fantasyguide.cn/', manifest, fetcher)).results.length, manifest.files.length);
  assert.equal(paths.length, manifest.files.length + 1);
  await assert.rejects(() => verify('https://riddle.fantasyguide.cn/', manifest, fetcher), /dedicated CDN/);
});

test('remote publishing creates mainland only and refuses mismatched or unbound existing projects', async () => {
  const config = JSON.parse(await readFile(join(root, 'deployment.json'), 'utf8')); config.projectId = null;
  const creates = [];
  const client = { projects: {
    list: async () => ({ items: [] }),
    create: async (value) => { creates.push(value); return { projectId: 'test-id' }; },
    get: async () => ({ projectId: 'test-id', name: 'hkts3-assets', area: 'mainland' }),
  } };
  assert.equal((await selectProject(client, config)).projectId, 'test-id');
  assert.deepEqual(creates, [{ name: 'hkts3-assets', area: 'mainland' }]);
  client.projects.list = async () => ({ items: [{ name: 'hkts3-assets' }] });
  await assert.rejects(() => selectProject(client, config), /already exists/);
  config.projectId = 'test-id';
  client.projects.get = async () => ({ name: 'hkts3-assets', area: 'overseas' });
  await assert.rejects(() => selectProject(client, config), /mismatch/);
});
