import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { InMemoryQuotaRepository } from '../src/modules/quota/storage/InMemoryQuotaRepository.js';
import { QuotaStorageError, type DeviceQuotaRecord } from '../src/modules/quota/types.js';

const testDir = path.resolve(process.cwd(), 'data/test-repo');

function cleanup() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

async function runRepositoryTests() {
  console.log('🧪 Starting QuotaRepository Comprehensive Unit Tests...');
  cleanup();
  fs.mkdirSync(testDir, { recursive: true });

  const testFile = path.join(testDir, 'test-quotas.json');

  const sampleRecordA: DeviceQuotaRecord = {
    mac: 'AA:BB:CC:DD:EE:01',
    quotaBytes: 1000000,
    lastSeenTotalBytes: 50000,
    accumulatedUsedBytes: 0,
    usedBytes: 0,
    remainingBytes: 1000000,
    percentage: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleRecordB: DeviceQuotaRecord = {
    mac: 'AA:BB:CC:DD:EE:02',
    quotaBytes: 5000000,
    lastSeenTotalBytes: 100000,
    accumulatedUsedBytes: 0,
    usedBytes: 0,
    remainingBytes: 5000000,
    percentage: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 1. InMemoryQuotaRepository CRUD
  {
    console.log('Running Test 1: InMemoryQuotaRepository CRUD operations...');
    const inMem = new InMemoryQuotaRepository();

    assert.equal(await inMem.exists(sampleRecordA.mac), false);
    assert.equal(await inMem.getByMac(sampleRecordA.mac), null);

    await inMem.create(sampleRecordA);
    assert.equal(await inMem.exists(sampleRecordA.mac), true);

    const fetched = await inMem.getByMac(sampleRecordA.mac);
    assert.ok(fetched);
    assert.equal(fetched.mac, sampleRecordA.mac);
    assert.equal(fetched.quotaBytes, sampleRecordA.quotaBytes);

    const updated = { ...sampleRecordA, quotaBytes: 2000000 };
    await inMem.update(updated);
    const fetchedUpdated = await inMem.getByMac(sampleRecordA.mac);
    assert.equal(fetchedUpdated?.quotaBytes, 2000000);

    const all = await inMem.getAll();
    assert.equal(all.length, 1);

    const deleted = await inMem.delete(sampleRecordA.mac);
    assert.equal(deleted, true);
    assert.equal(await inMem.exists(sampleRecordA.mac), false);
    assert.equal((await inMem.getAll()).length, 0);

    console.log('✅ Test 1 Passed: InMemoryQuotaRepository CRUD verified');
  }

  // 2. FileQuotaRepository CRUD and disk persistence
  {
    console.log('Running Test 2: FileQuotaRepository CRUD and persistence...');
    const repo = new FileQuotaRepository(testFile);

    assert.equal(await repo.exists(sampleRecordA.mac), false);
    assert.equal(await repo.getByMac(sampleRecordA.mac), null);
    assert.deepEqual(await repo.getAll(), []);

    await repo.create(sampleRecordA);
    assert.equal(await repo.exists(sampleRecordA.mac), true);

    const fetched = await repo.getByMac(sampleRecordA.mac);
    assert.ok(fetched);
    assert.equal(fetched.mac, sampleRecordA.mac);
    assert.equal(fetched.quotaBytes, 1000000);

    // Verify written to disk file
    assert.ok(fs.existsSync(testFile));
    const content = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
    assert.equal(Array.isArray(content), true);
    assert.equal(content.length, 1);
    assert.equal(content[0].mac, sampleRecordA.mac);

    // Add second record
    await repo.create(sampleRecordB);
    const all = await repo.getAll();
    assert.equal(all.length, 2);

    // Update record B
    const updatedB = { ...sampleRecordB, quotaBytes: 9000000 };
    await repo.update(updatedB);
    const fetchedB = await repo.getByMac(sampleRecordB.mac);
    assert.equal(fetchedB?.quotaBytes, 9000000);

    // Delete record A
    const deleted = await repo.delete(sampleRecordA.mac);
    assert.equal(deleted, true);
    assert.equal(await repo.exists(sampleRecordA.mac), false);

    const remaining = await repo.getAll();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].mac, sampleRecordB.mac);

    console.log('✅ Test 2 Passed: FileQuotaRepository CRUD and persistence verified');
  }

  // 3. Persistence reload across separate repository instances
  {
    console.log('Running Test 3: Data reload across separate repository instances...');
    const newRepoInstance = new FileQuotaRepository(testFile);
    const records = await newRepoInstance.getAll();
    assert.equal(records.length, 1);
    assert.equal(records[0].mac, sampleRecordB.mac);
    assert.equal(records[0].quotaBytes, 9000000);

    console.log('✅ Test 3 Passed: Persistent reload across separate instances verified');
  }

  // 4. Concurrent write safety (write queue serialization)
  {
    console.log('Running Test 4: Concurrent writes serialization...');
    const concurrentFile = path.join(testDir, 'concurrent-quotas.json');
    const repo = new FileQuotaRepository(concurrentFile);

    const promises = [];
    for (let i = 1; i <= 20; i++) {
      const mac = `AA:BB:CC:DD:EE:${i.toString().padStart(2, '0')}`;
      const rec: DeviceQuotaRecord = {
        mac,
        quotaBytes: i * 1000,
        lastSeenTotalBytes: 0,
        accumulatedUsedBytes: 0,
        usedBytes: 0,
        remainingBytes: i * 1000,
        percentage: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      promises.push(repo.create(rec));
    }

    await Promise.all(promises);

    const finalRecords = await repo.getAll();
    assert.equal(finalRecords.length, 20);

    // Verify on disk with fresh instance
    const freshRepo = new FileQuotaRepository(concurrentFile);
    const diskRecords = await freshRepo.getAll();
    assert.equal(diskRecords.length, 20);

    console.log('✅ Test 4 Passed: 20 concurrent writes serialized cleanly without loss');
  }

  // 5. Malformed JSON handling
  {
    console.log('Running Test 5: Malformed JSON file handling...');
    const malformedFile = path.join(testDir, 'malformed-quotas.json');
    fs.writeFileSync(malformedFile, '{ this is not valid json !!!');

    const repo = new FileQuotaRepository(malformedFile);
    await assert.rejects(
      async () => {
        await repo.getAll();
      },
      (err: unknown) => {
        assert.ok(err instanceof QuotaStorageError);
        assert.ok(err.message.includes('Failed to initialize quota storage'));
        return true;
      }
    );

    console.log('✅ Test 5 Passed: Malformed storage threw QuotaStorageError gracefully');
  }

  // 6. Atomic write temporary file cleanup
  {
    console.log('Running Test 6: Atomic persistence does not leave stale temp files...');
    const files = fs.readdirSync(testDir);
    const tempFiles = files.filter((f) => f.includes('.tmp.'));
    assert.equal(tempFiles.length, 0, 'No temporary files should be left orphaned after atomic rename');

    console.log('✅ Test 6 Passed: Atomic temporary files cleaned up after rename');
  }

  cleanup();
  console.log('\n🎉 ALL QuotaRepository TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runRepositoryTests().catch((err) => {
  console.error('❌ QuotaRepository tests failed:', err);
  cleanup();
  process.exit(1);
});
