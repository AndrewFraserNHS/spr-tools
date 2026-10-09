import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const publishDir = await mkdtemp(path.join(tmpdir(), 'spr-tools-gh-pages-'));

try {
  await cp(path.join(projectRoot, 'public'), publishDir, { recursive: true });
  await cp(path.join(projectRoot, 'data'), path.join(publishDir, 'data'), { recursive: true });

  const cli = path.join(projectRoot, 'node_modules', 'gh-pages', 'bin', 'gh-pages.js');
  const result = spawnSync(process.execPath, [cli, '-d', publishDir], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(publishDir, { recursive: true, force: true });
}
