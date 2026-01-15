/**
 * One-time script to add +300 coins to ALL users
 * Collection: users/{uid}
 */

const admin = require("firebase-admin");

// 🔑 Uses your local service account / firebase login
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

async function run() {
  const usersSnap = await db.collection("users").get();

  console.log(`Found ${usersSnap.size} users`);

  const batch = db.batch();
  let count = 0;

  usersSnap.forEach((doc) => {
    const ref = doc.ref;

    batch.update(ref, {
      coins: admin.firestore.FieldValue.increment(300),
      makeGoodJan2026: true, // 👈 prevents double-paying
    });

    count++;
  });

  await batch.commit();
  console.log(`✅ Added +300 coins to ${count} users`);
}

run()
  .then(() => {
    console.log("🎉 DONE");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ ERROR:", err);
    process.exit(1);
  });
