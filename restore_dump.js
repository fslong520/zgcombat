const fs = require('fs');
const { MongoClient, BSON } = require('mongodb');

const DUMP_DIR = '/tmp/dump_coco/coco';
const MONGO_URL = 'mongodb://127.0.0.1:27017';
const DB_NAME = 'coco';

// Collections to restore (in order, campaigns before others that reference it)
const COLLECTIONS = [
  'level.systems',
  'thang.types',
  'level.components',
  'achievements',
  'campaigns',
  'levels',
];

async function restore() {
  const client = await MongoClient.connect(MONGO_URL, {});
  const db = client.db(DB_NAME);

  for (const collName of COLLECTIONS) {
    const bsonFile = `${DUMP_DIR}/${collName}.bson`;
    const metaFile = `${DUMP_DIR}/${collName}.metadata.json`;

    if (!fs.existsSync(bsonFile)) {
      console.log(`[SKIP] ${collName}: no BSON file`);
      continue;
    }

    const buf = fs.readFileSync(bsonFile);
    const totalBytes = buf.length;
    let offset = 0;
    const docs = [];
    let errCount = 0;

    while (offset < totalBytes) {
      // Last 4 bytes: BSON files sometimes have trailing null bytes
      if (totalBytes - offset < 5) break;

      const docLen = buf.readInt32LE(offset);
      if (docLen <= 0 || docLen > totalBytes - offset) {
        // Invalid length — likely trailing data, stop
        break;
      }
      const docBuf = buf.subarray(offset, offset + docLen);
      try {
        const doc = BSON.deserialize(docBuf, { 
          promoteBuffers: false,
          promoteLongs: false,
          promoteValues: false
        });
        docs.push(doc);
      } catch (e) {
        errCount++;
        if (errCount <= 3) console.error(`  doc parse error at offset ${offset}: ${e.message}`);
      }
      offset += docLen;
    }

    console.log(`[RESTORE] ${collName}: parsed ${docs.length} docs from ${(totalBytes/1024/1024).toFixed(1)}MB (errors: ${errCount})`);

    // Drop and insert
    const coll = db.collection(collName);
    try {
      await coll.drop();
    } catch(e) {
      // Collection may not exist
    }
    if (docs.length > 0) {
      // Insert in batches of 500
      const BATCH_SIZE = 500;
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = docs.slice(i, i + BATCH_SIZE);
        await coll.insertMany(batch, { ordered: false });
      }
    }
    console.log(`  -> inserted ${docs.length} docs`);
  }

  await client.close();
  console.log('Done.');
}

restore().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
