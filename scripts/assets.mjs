import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, lstat, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
// Project guardrails, not a promise about the public mirror's quotas.
const maxImageBytes = 20 * 1024 * 1024;
const maxTotalBytes = 50 * 1024 * 1024;
export function baseForCommit(commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A full 40-character Git commit is required');
  return `https://cdn.jsdmirror.com/gh/Fantasyguide/hkts3-assets@${commit}/public/`;
}

export async function walk(directory, prefix = '') {
  if (!(await lstat(directory)).isDirectory()) throw new Error(`Not a real directory: ${directory}`);
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = prefix + name;
    const stat = await lstat(join(directory, name));
    if (stat.isDirectory()) result.push(...await walk(join(directory, name), `${path}/`));
    else if (stat.isFile()) result.push(path);
    else throw new Error(`Symlink or non-regular file: ${path}`);
  }
  return result.sort();
}

function assertImage(file, bytes) {
  const ext = file.path.split('.').at(-1);
  const magic = ext === 'webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    : ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : ['jpg', 'jpeg'].includes(ext) ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(bytes.toString('ascii', 8, 32));
  if (!magic || sha256(bytes) !== file.sha256 || bytes.length !== file.bytes || bytes.length > maxImageBytes) {
    throw new Error(`Image content/hash/size mismatch: ${file.path}`);
  }
}

// Validate every upload file, including unlisted files; never follow symlinks.
export async function validate(directory, { bundle = false } = {}) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.event !== 'hkts3' || !Array.isArray(manifest.files)) throw new Error('Invalid manifest');
  const publicRoot = bundle ? directory : join(directory, 'public');
  const actual = await walk(publicRoot);
  const seen = new Set();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !/^[A-Za-z][A-Za-z0-9-]*\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+-[a-f0-9]{20}\.(?:webp|png|jpg|jpeg|avif)$/.test(file.path)
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !file.path.endsWith(`-${file.sha256.slice(0, 20)}.${file.path.split('.').at(-1)}`)
      || seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 1
      || file.puzzle !== file.path.split('/')[0] || !/^[A-Za-z0-9_-]{1,64}$/.test(file.version)
      || !/^public\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:webp|png|jpg|jpeg|avif)$/.test(file.source)) {
      throw new Error('Invalid or duplicate manifest path/metadata');
    }
    seen.add(file.path);
    // walk() rejects symlinks before any asset is read.
    if (!actual.includes(file.path)) throw new Error(`Missing image: ${file.path}`);
    assertImage(file, await readFile(join(publicRoot, file.path)));
  }
  const expected = [...seen, ...(bundle ? ['manifest.json'] : [])].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Unlisted or missing public files');
  if (manifest.files.reduce((n, file) => n + file.bytes, 0) > maxTotalBytes) throw new Error('Project image budget exceeds 50 MiB');
  return manifest;
}

export async function sync(bundle, repository = root, { apply = false } = {}) {
  const incoming = await validate(bundle, { bundle: true });
  let old;
  try { old = await validate(repository); }
  catch (error) {
    // Bootstrap is only allowed for an empty manifest with no public directory.
    if (error.code !== 'ENOENT') throw error;
    old = JSON.parse(await readFile(join(repository, 'manifest.json'), 'utf8'));
    if (old.schemaVersion !== 1 || old.event !== 'hkts3' || old.files?.length !== 0) throw error;
    try { await lstat(join(repository, 'public')); throw error; } catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
  }
  const merged = new Map(old.files.map((file) => [file.path, file]));
  const added = [];
  for (const file of incoming.files) {
    const previous = merged.get(file.path);
    if (previous && (previous.sha256 !== file.sha256 || previous.bytes !== file.bytes)) throw new Error(`Immutable conflict: ${file.path}`);
    if (!previous) { merged.set(file.path, file); added.push(file); }
  }
  if (apply) {
    for (const file of added) {
      const destination = join(repository, 'public', file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(join(bundle, file.path)), { flag: 'wx' });
    }
    await mkdir(join(repository, 'public'), { recursive: true });
    const manifest = { schemaVersion: 1, event: 'hkts3', files: [...merged.values()].sort((a, b) => a.path.localeCompare(b.path)) };
    await writeFile(join(repository, 'manifest.json.tmp'), json(manifest));
    await rename(join(repository, 'manifest.json.tmp'), join(repository, 'manifest.json'));
    await validate(repository);
  }
  return { applied: apply, added: added.map((file) => file.path), reused: incoming.files.length - added.length,
    retained: old.files.length, total: merged.size, addedBytes: added.reduce((sum, file) => sum + file.bytes, 0), uploaded: false };
}

export async function pack(repository = root) {
  const manifest = await validate(repository);
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Commit or remove pending changes before packing');
  const commit = git('rev-parse', 'HEAD');
  const directory = join(repository, 'dist', commit);
  await mkdir(join(repository, 'dist'), { recursive: true });
  await mkdir(directory); // Never overwrite an earlier artifact.
  const archive = join(directory, 'public.zip');
  // Portable backup of images only; the mirror serves the Git commit directly.
  execFileSync('git', ['archive', '--format=zip', `--output=${archive}`, 'HEAD:public'], { cwd: repository });
  const bytes = await readFile(archive);
  const receipt = { commit, archive: 'public.zip', sha256: sha256(bytes), bytes: bytes.length,
    images: manifest.files.length, imageBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), uploaded: false };
  await writeFile(join(directory, 'receipt.json'), json(receipt));
  return { directory, ...receipt };
}

// Small, sequential correctness check against the dedicated CDN only; no load test.
export async function verify(baseUrl, manifest, fetcher = fetch) {
  if (!/^https:\/\/cdn\.jsdmirror\.com\/gh\/Fantasyguide\/hkts3-assets@[a-f0-9]{40}\/public\/$/.test(baseUrl)) throw new Error('Only the dedicated CDN repository at a fixed commit is allowed');
  const results = [];
  for (const file of manifest.files) {
    const start = performance.now();
    const response = await fetcher(new URL(file.path, baseUrl), { redirect: 'error', signal: AbortSignal.timeout(15000), credentials: 'omit' });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('image/')
      || !/(?:^|[,\s])max-age=31536000(?:[,\s]|$)/.test(response.headers.get('cache-control') || '')
      || /no-store|no-cache|private/.test(response.headers.get('cache-control') || '')
      || response.headers.get('cross-origin-resource-policy') !== 'cross-origin'
      || response.headers.has('set-cookie')) throw new Error(`CDN status/headers mismatch: ${file.path}`);
    assertImage(file, bytes);
    results.push({ path: file.path, bytes: bytes.length, sha256: sha256(bytes), milliseconds: Math.round(performance.now() - start),
      cacheControl: response.headers.get('cache-control'), cacheStatus: response.headers.get('eo-cache-status') });
  }
  const missing = await fetcher(new URL(`__missing-${Date.now()}.webp`, baseUrl), { redirect: 'error', signal: AbortSignal.timeout(15000), credentials: 'omit' });
  await missing.arrayBuffer();
  if (missing.status !== 404) throw new Error('Missing CDN image must return 404');
  return { checkedAt: new Date().toISOString(), baseUrl, results, missingStatus: missing.status, loadTest: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (command === 'import' && (args.length === 1 || (args.length === 2 && args[1] === '--apply'))) result = await sync(resolve(args[0]), root, { apply: args[1] === '--apply' });
    else if (command === 'check' && !args.length) {
      const manifest = await validate(root);
      result = { valid: true, images: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
    } else if (command === 'pack' && !args.length) result = await pack();
    else if ((command === 'base' || command === 'verify') && args.length === 1) {
      const baseUrl = baseForCommit(args[0]);
      if (command === 'base') { console.log(baseUrl); process.exit(0); }
      const manifest = JSON.parse(execFileSync('git', ['show', `${args[0]}:manifest.json`], { cwd: root, encoding: 'utf8' }));
      result = await verify(baseUrl, manifest);
      await mkdir(join(root, 'dist'), { recursive: true });
      await writeFile(join(root, 'dist', `verify-${Date.now()}.json`), json(result));
    } else throw new Error('Usage: assets.mjs import <export> [--apply] | check | pack | base <commit> | verify <commit>');
    console.log(json(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
