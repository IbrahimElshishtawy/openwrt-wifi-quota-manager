import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { FileFirewallRepository } from '../src/modules/firewall/storage/FileFirewallRepository.js';
import { QuotaStorageError } from '../src/modules/quota/types.js';
import { FirewallStorageError } from '../src/modules/firewall/storage/FileFirewallRepository.js';

async function run() {
  console.log('🧪 Starting Stage 13: Persistence Corruption & Backup/Restore Validation...');
  const testDir = path.resolve(process.cwd(), 'scratch/corruption-test-data');
  await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => {});
  await fs.promises.mkdir(testDir, { recursive: true });

  const dataDir = path.join(testDir, 'data');
  const backupDir = path.join(testDir, 'backups');
  await fs.promises.mkdir(dataDir, { recursive: true });
  await fs.promises.mkdir(backupDir, { recursive: true });

  const quotaFile = path.join(dataDir, 'quotas.json');
  const fwFile = path.join(dataDir, 'firewall-blocks.json');

  // ============================================================================
  // Test 1: Corrupted quotas.json is strictly rejected
  // ============================================================================
  console.log('\n--- Scenario 13.1: Corrupted quotas.json detection ---');
  {
    // Write invalid JSON
    await fs.promises.writeFile(quotaFile, '{"mac": "broken-json, missing brackets', 'utf-8');

    const repo = new FileQuotaRepository(quotaFile);
    await assert.rejects(
      async () => repo.getAll(),
      (err: any) => err instanceof QuotaStorageError || err.name === 'QuotaStorageError'
    );

    // Verify file was NOT overwritten with empty array
    const rawAfter = await fs.promises.readFile(quotaFile, 'utf-8');
    assert.ok(rawAfter.includes('broken-json'), 'Corrupt file must not be silently overwritten');
    console.log('  ✅ Repository strictly rejects corrupted quotas.json and does not overwrite it.');
  }

  // ============================================================================
  // Test 2: Corrupted firewall-blocks.json is strictly rejected
  // ============================================================================
  console.log('\n--- Scenario 13.2: Corrupted firewall-blocks.json detection ---');
  {
    await fs.promises.writeFile(fwFile, '{"manualBlockedMacs": [unquoted text', 'utf-8');

    const fwRepo = new FileFirewallRepository(fwFile);
    await assert.rejects(
      async () => fwRepo.getSources('02:00:AA:BB:CC:01'),
      (err: any) => err instanceof FirewallStorageError || err.name === 'FirewallStorageError'
    );

    const rawAfter = await fs.promises.readFile(fwFile, 'utf-8');
    assert.ok(rawAfter.includes('unquoted text'), 'Corrupt firewall file must not be silently overwritten');
    console.log('  ✅ Repository strictly rejects corrupted firewall state and protects disk state.');
  }

  // ============================================================================
  // Test 3: Backup Tool Rejects Corrupt Active State
  // ============================================================================
  console.log('\n--- Scenario 13.3: Backup tool rejects corrupt active state ---');
  {
    // dataDir still contains corrupt files from above
    let backupFailed = false;
    try {
      execSync(`DATA_DIR="${dataDir}" BACKUP_DIR="${backupDir}" bash deploy/backup.sh`, {
        stdio: 'pipe',
      });
    } catch {
      backupFailed = true;
    }
    assert.ok(backupFailed, 'backup.sh must abort when active files are corrupt');
    console.log('  ✅ backup.sh safely refused to create backup from corrupt data.');
  }

  // ============================================================================
  // Test 4: Restore Tool Detects Checksum Tampering / Corruption
  // ============================================================================
  console.log('\n--- Scenario 13.4: Restore tool detects checksum mismatch ---');
  {
    // 1. Create valid data files
    const validQuotas = [{
      mac: '52:54:00:11:22:33',
      quotaBytes: 10_000_000,
      usedBytes: 5_000_000,
      remainingBytes: 5_000_000,
      percentage: 50,
      status: 'active',
      lastSeenTotalBytes: 5_000_000,
      accumulatedUsedBytes: 5_000_000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    const validFw = {
      manualBlockedMacs: ['52:54:00:AA:BB:CC'],
      quotaBlockedMacs: [],
    };

    await fs.promises.writeFile(quotaFile, JSON.stringify(validQuotas, null, 2), 'utf-8');
    await fs.promises.writeFile(fwFile, JSON.stringify(validFw, null, 2), 'utf-8');

    // 2. Take healthy backup
    const backupOutput = execSync(`DATA_DIR="${dataDir}" BACKUP_DIR="${backupDir}" bash deploy/backup.sh`, {
      encoding: 'utf-8',
    });
    assert.ok(backupOutput.includes('Backup successfully created'));

    const latestBackup = path.join(backupDir, 'latest');

    // 3. Tamper with quotas.json in the backup (checksum mismatch)
    const backupQuotaPath = path.join(latestBackup, 'quotas.json');
    const backupContent = await fs.promises.readFile(backupQuotaPath, 'utf-8');
    await fs.promises.writeFile(backupQuotaPath, backupContent + '   \n', 'utf-8'); // Alter byte content

    // 4. Attempt restore: must fail on SHA-256 verification
    let restoreFailed = false;
    try {
      execSync(`DATA_DIR="${dataDir}" BACKUP_DIR="${backupDir}" bash deploy/restore.sh "${latestBackup}"`, {
        stdio: 'pipe',
      });
    } catch {
      restoreFailed = true;
    }
    assert.ok(restoreFailed, 'restore.sh must fail when SHA-256 checksum does not match');
    console.log('  ✅ restore.sh successfully detected checksum mismatch and rejected tampered backup.');
  }

  // ============================================================================
  // Test 5: Full Disaster Recovery: Healthy Backup -> Corruption -> Restore -> Reconciliation
  // ============================================================================
  console.log('\n--- Scenario 13.5: Full Disaster Recovery Workflow ---');
  {
    // Clean data and create valid backup
    const goldenQuotas = [{
      mac: '52:54:00:77:88:99',
      quotaBytes: 2_000_000_000,
      usedBytes: 1_000_000_000,
      remainingBytes: 1_000_000_000,
      percentage: 50,
      status: 'active',
      lastSeenTotalBytes: 1_000_000_000,
      accumulatedUsedBytes: 1_000_000_000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    await fs.promises.writeFile(quotaFile, JSON.stringify(goldenQuotas, null, 2), 'utf-8');
    await fs.promises.writeFile(fwFile, JSON.stringify({ manualBlockedMacs: [], quotaBlockedMacs: [] }), 'utf-8');

    const backupRes = execSync(`DATA_DIR="${dataDir}" BACKUP_DIR="${backupDir}" bash deploy/backup.sh`, {
      encoding: 'utf-8',
    });
    const goldenBackupDir = backupRes.trim().split('\n').pop()!;

    // Disaster strikes: active quotaFile truncated to 0 bytes / corrupt
    await fs.promises.writeFile(quotaFile, 'CORRUPT_BYTES', 'utf-8');

    // Execute restore from golden backup
    execSync(`DATA_DIR="${dataDir}" BACKUP_DIR="${backupDir}" bash deploy/restore.sh "${goldenBackupDir}"`, {
      encoding: 'utf-8',
    });

    // Verify restored file loads cleanly in repository
    const recoveredRepo = new FileQuotaRepository(quotaFile);
    const restoredRecords = await recoveredRepo.getAll();
    assert.equal(restoredRecords.length, 1);
    assert.equal(restoredRecords[0].mac, '52:54:00:77:88:99');
    assert.equal(restoredRecords[0].quotaBytes, 2_000_000_000);
    console.log('  ✅ Complete disaster recovery workflow: backup -> corruption -> restore -> verification passed.');
  }

  await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => {});
  console.log('\n✅ Stage 13 Persistence Corruption & Recovery Completed Successfully!\n');
}

void run();
