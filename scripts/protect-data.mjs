import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVault, openVault } from '../public/js/vault.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const dataDir = path.join(projectRoot, 'data');
const names = ['people', 'workstreams', 'teams', 'links', 'events', 'acronyms', 'config'];

function hiddenInput(label) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Run this command directly in a terminal so the passphrase can be hidden.');
  return new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    const finish = (error, result) => {
      input.off('data', onData);
      input.setRawMode(false);
      process.stdout.write('\n');
      error ? reject(error) : resolve(result);
    };
    const onData = chunk => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') return finish(new Error('Cancelled.'));
        if (character === '\r' || character === '\n') return finish(null, value);
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    process.stdout.write(label);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function main() {
  const vaultPath = path.join(dataDir, 'vault.json');
  try {
    await readFile(vaultPath);
    throw new Error('data/vault.json already exists; refusing to overwrite it.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const payload = {};
  for (const name of names) payload[name] = JSON.parse(await readFile(path.join(dataDir, `${name}.json`), 'utf8'));
  const passphrase = await hiddenInput('New shared passphrase (14+ characters): ');
  const confirmation = await hiddenInput('Confirm passphrase: ');
  if (passphrase !== confirmation) throw new Error('Passphrases do not match.');

  const envelope = await createVault(payload, passphrase);
  const verified = await openVault(envelope, passphrase);
  if (JSON.stringify(verified.data) !== JSON.stringify(payload)) throw new Error('Encrypted vault verification failed.');

  const backupDir = path.join(path.dirname(projectRoot), `${path.basename(projectRoot)}-plaintext-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(backupDir);
  const files = await readdir(dataDir);
  const sourceFiles = files.filter(file => names.includes(path.basename(file, '.json')) && file.endsWith('.json'));
  for (const file of sourceFiles) await copyFile(path.join(dataDir, file), path.join(backupDir, file));

  const tempPath = `${vaultPath}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(envelope, null, 2) + '\n', { flag: 'wx' });
    await rename(tempPath, vaultPath);
    for (const file of sourceFiles) await rm(path.join(dataDir, file));
  } catch (error) {
    await rm(tempPath, { force: true });
    for (const file of sourceFiles) await copyFile(path.join(backupDir, file), path.join(dataDir, file));
    await rm(vaultPath, { force: true });
    throw error;
  }

  console.log(`Encrypted vault created at data/vault.json. Plaintext backup: ${backupDir}`);
  console.log('After verifying the app unlocks, securely remove that backup and commit the JSON file removals plus encrypted vault.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
