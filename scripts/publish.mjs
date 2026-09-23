import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Makers } from '@edgeone/makers-sdk';
import { root, validate, pack, sha256 } from './assets.mjs';

export async function selectProject(client, config) {
  if (config.site !== 'china' || config.area !== 'mainland' || config.projectName !== 'hkts3-assets') {
    throw new Error('Expected the dedicated China-site mainland project');
  }
  let projectId = config.projectId;
  if (!projectId) {
    const existing = await client.projects.list({ name: config.projectName, pageSize: 100 });
    if (existing.items.some((item) => item.name === config.projectName)) {
      throw new Error('Project already exists: record its verified projectId in deployment.json before publishing');
    }
    ({ projectId } = await client.projects.create({ name: config.projectName, area: 'mainland' }));
    console.log(`Created mainland project: ${projectId}`);
  }
  const project = await client.projects.get({ projectId });
  if (project.name !== config.projectName || project.area !== 'mainland') throw new Error('Remote project name/area mismatch; upload refused');
  return project;
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--apply') throw new Error('Explicit publish requires: node scripts/publish.mjs --apply');
  const token = process.env.EDGEONE_PAGES_API_TOKEN;
  if (!token) throw new Error('Missing EDGEONE_PAGES_API_TOKEN; use the private repository Actions secret');
  await validate(root);
  const artifact = await pack(root);
  const config = JSON.parse(await readFile(join(root, 'deployment.json'), 'utf8'));
  const client = new Makers({ token, region: 'china', timeout: 30, retries: 2 });
  const project = await selectProject(client, config);
  const record = { ...artifact, directory: undefined, site: 'china', area: project.area, projectId: project.projectId,
    projectName: project.name, baseUrl: config.baseUrl, presetDomain: project.presetDomain, createdAt: new Date().toISOString() };
  const receipt = join(artifact.directory, 'deployment.json');
  const save = async () => writeFile(receipt, JSON.stringify(record, null, 2) + '\n');
  await save(); // Preserve the new project ID even if the first upload fails.
  const archive = join(artifact.directory, 'public.zip');
  if (sha256(await readFile(archive)) !== artifact.sha256) throw new Error('Artifact changed after packing');
  const pending = await client.deployments.deploy({ projectId: project.projectId, artifact: { archive }, env: 'Production' });
  record.deploymentId = pending.deploymentId;
  record.uploaded = true;
  await save();
  const result = await client.deployments.wait({ projectId: project.projectId, deploymentId: pending.deploymentId,
    timeout: 600, pollInterval: 5, onStatusChange: ({ deployment }) => console.log(`CDN deployment: ${deployment.status}`) });
  record.status = result.status;
  record.code = result.code;
  await save();
  // Do not store expiring signed preview URLs or credentials in logs/artifacts.
  console.log(JSON.stringify(record, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## HKTS3 static assets\n\nCommit: \`${record.commit}\`\n\nProject: \`${record.projectId}\` (mainland)\n\nDeployment: \`${record.deploymentId}\` — ${record.status}\n\nImages: ${record.images}, ${record.imageBytes} bytes.\n\nBind \`hkts3-assets.fantasyguide.cn\` in the Tencent Cloud console, then configure its actual CNAME and HTTPS. The riddle application is unchanged.\n`);
  if (result.status !== 'Success') throw new Error(`CDN deployment did not succeed: ${result.status}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = String(error.message).replaceAll(process.env.EDGEONE_PAGES_API_TOKEN || '\u0000', '[REDACTED]');
    console.error(message); process.exitCode = 1;
  });
}
