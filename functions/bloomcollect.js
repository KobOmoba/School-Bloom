/**
 * BloomCollect Cloud Function — Firebase Functions (Node.js 18)
 * Repo: KobOmoba/School-Bloom — deploy to: functions/bloomcollect.js
 *
 * DEPLOY STEPS:
 *   1. firebase init functions (in the project root)
 *   2. cd functions && npm install axios
 *   3. firebase functions:secrets:set PAYSTACK_SECRET_KEY
 *   4. firebase deploy --only functions:createPaymentLink,createSubaccount,paystackWebhook
 *
 * FEE MODEL (Option B — Bayo's decision 2026-08-12):
 *   - Parent pays: school_fee + 2.5% (1.5% gateway + 1% AariNAT)
 *   - School receives: exact school_fee (via flat transaction_charge, bearer: account)
 *   - AariNAT nets: ~1% of school_fee after gateway fees
 *
 * EXAMPLE:
 *   School fee: ₦35,000
 *   Parent pays: ₦35,875  (₦35,000 × 1.025)
 *   Paystack takes: ₦538 + ₦100 = ₦638 from AariNAT's portion
 *   School gets: ₦35,000  (guaranteed flat split)
 *   AariNAT gets: ₦875 - ₦638 = ₦237  (~0.68%, net of gateway)
 *
 *   NOTE: To improve AariNAT's net to exactly 1%, negotiate a bulk rate with Paystack
 *   (achievable at ~500 schools using BloomCollect). At 0.8% bulk rate + ₦50 flat:
 *   AariNAT nets: ₦875 - (₦35,875×0.008 + ₦50) = ₦875 - ₦337 = ₦538 ≈ 1.5%
 */

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const axios      = require('axios');
const crypto     = require('crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ── Gateway helpers ──────────────────────────────────────────────────────────

function paystackHeaders(secretKey) {
  return { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
}

function calcParentCharge(schoolFee, gatewayRate = 0.015, aarinatRate = 0.01) {
  const surcharge = Math.ceil(schoolFee * (gatewayRate + aarinatRate));
  return schoolFee + surcharge;
}

// ── 1. createSubaccount ───────────────────────────────────────────────────────
// Called once when school saves bank details in Settings.
// Creates a Paystack subaccount, stores the code in Firestore.
exports.createSubaccount = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://school.edubloom.com.ng');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { schoolId, schoolName, bankCode, accountNumber, accountName } = req.body;
  if (!schoolId || !bankCode || !accountNumber || !accountName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!SECRET_KEY) return res.status(500).json({ error: 'Gateway not configured' });

  try {
    // Verify the account first (NIP name enquiry)
    const verify = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      { headers: paystackHeaders(SECRET_KEY) }
    );
    if (!verify.data.status) throw new Error('Account verification failed');

    // Create the subaccount
    const sub = await axios.post('https://api.paystack.co/subaccount', {
      business_name:   accountName,
      settlement_bank: bankCode,
      account_number:  accountNumber,
      percentage_charge: 99, // 99% goes to school — but we use transaction_charge (flat) not this
      description: `BloomCollect — ${schoolName}`,
      primary_contact_name:  accountName,
      metadata: { schoolId, schoolName, platform: 'EduBloom' }
    }, { headers: paystackHeaders(SECRET_KEY) });

    if (!sub.data.status) throw new Error(sub.data.message || 'Subaccount creation failed');

    const subaccountCode = sub.data.data.subaccount_code;
    const verifiedName   = verify.data.data.account_name;

    // Store in Firestore
    await db.collection('schools').doc(schoolId).set({
      'config.bloomcollect.subaccountCode': subaccountCode,
      'config.bloomcollect.verifiedAccountName': verifiedName,
      'config.bloomcollect.gateway': 'paystack',
      'config.bloomcollect.activatedAt': admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Log in admin_bloomcollect collection
    await db.collection('admin_bloomcollect').doc(schoolId).set({
      schoolId, schoolName, bankCode, accountNumber,
      accountName: verifiedName, subaccountCode,
      gateway: 'paystack',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      totalVolume: 0, totalAarinatEarnings: 0, transactionCount: 0,
    }, { merge: true });

    return res.status(200).json({ success: true, subaccountCode, verifiedName });

  } catch (e) {
    console.error('createSubaccount error:', e.response?.data || e.message);
    return res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── 2. createPaymentLink ──────────────────────────────────────────────────────
// Called when principal taps "💳 Send Payment Link" on a student row.
// Returns a Paystack hosted payment URL to send to the parent via WhatsApp.
exports.createPaymentLink = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://school.edubloom.com.ng');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    schoolId, schoolName, studentName, studentClass,
    parentPhone, parentEmail, schoolFee, term,
    subaccount, gateway = 'paystack', ref,
  } = req.body;

  if (!schoolId || !schoolFee || !subaccount || !parentEmail) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!SECRET_KEY) return res.status(500).json({ error: 'Gateway not configured' });

  // Fee calculation — Option B: parent pays school_fee + 2.5%
  const gatewayRate = 0.015; // Paystack default — update per gateway
  const parentCharge = calcParentCharge(schoolFee, gatewayRate, 0.01);
  const amountKobo   = parentCharge * 100; // Paystack uses kobo

  try {
    // Initialize a Paystack transaction
    const init = await axios.post('https://api.paystack.co/transaction/initialize', {
      email:    parentEmail,
      amount:   amountKobo,
      currency: 'NGN',
      reference: ref || `BLOOM-${schoolId}-${Date.now()}`,
      subaccount,
      // Flat split: school gets exactly schoolFee (in kobo), rest goes to AariNAT
      transaction_charge: schoolFee * 100,
      bearer: 'account', // AariNAT's account bears Paystack's fee from its portion
      callback_url: `https://school.edubloom.com.ng/?bc_ref=${ref}`,
      metadata: {
        custom_fields: [
          { display_name: 'School',  variable_name: 'school',  value: schoolName  },
          { display_name: 'Student', variable_name: 'student', value: studentName },
          { display_name: 'Class',   variable_name: 'class',   value: studentClass },
          { display_name: 'Term',    variable_name: 'term',    value: term },
        ],
        schoolId, studentName, schoolFee, parentCharge, platform: 'EduBloom',
      },
    }, { headers: paystackHeaders(SECRET_KEY) });

    if (!init.data.status) throw new Error(init.data.message || 'Transaction init failed');

    const paymentUrl = init.data.data.authorization_url;
    const txRef      = init.data.data.reference;

    // Store pending transaction in Firestore for webhook reconciliation
    await db.collection('admin_bloomcollect_txns').doc(txRef).set({
      txRef, schoolId, schoolName, studentName, studentClass,
      parentPhone, parentEmail, schoolFee, parentCharge,
      aarinatFee: parentCharge - schoolFee,
      gatewayFee:  Math.round(parentCharge * gatewayRate + 100),
      aarinatNet:  Math.round(parentCharge - schoolFee - (parentCharge * gatewayRate + 100)),
      status: 'pending', term, subaccount, gateway,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true, paymentUrl, txRef, parentCharge });

  } catch (e) {
    console.error('createPaymentLink error:', e.response?.data || e.message);
    return res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── 3. paystackWebhook ────────────────────────────────────────────────────────
// Paystack calls this URL when a payment is confirmed.
// Marks the student as paid in Firestore — no CSV needed.
exports.paystackWebhook = functions.https.onRequest(async (req, res) => {
  // Verify the webhook is genuinely from Paystack
  const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body)).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  if (event.event !== 'charge.success') return res.status(200).json({ received: true });

  const data  = event.data;
  const txRef = data.reference;

  try {
    // Get the pending transaction
    const txDoc = await db.collection('admin_bloomcollect_txns').doc(txRef).get();
    if (!txDoc.exists) return res.status(200).json({ ok: true, note: 'Unknown txRef' });

    const tx = txDoc.data();
    if (tx.status === 'success') return res.status(200).json({ ok: true, note: 'Already processed' });

    const { schoolId, studentName, schoolFee, parentCharge, aarinatNet, term } = tx;

    // Mark transaction as successful
    await db.collection('admin_bloomcollect_txns').doc(txRef).update({
      status: 'success',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paystackRef: data.id,
    });

    // Update the student's paid amount in Firestore
    const schoolDoc = await db.collection('schools').doc(schoolId).get();
    if (schoolDoc.exists) {
      const students = schoolDoc.data().students || [];
      const idx = students.findIndex(s => s.name === studentName);
      if (idx !== -1) {
        students[idx].paid = (students[idx].paid || 0) + schoolFee;
        if (!students[idx].paymentHistory) students[idx].paymentHistory = [];
        students[idx].paymentHistory.push({
          amount: schoolFee, date: new Date().toISOString().split('T')[0],
          method: 'BloomCollect', ref: txRef,
        });
        await db.collection('schools').doc(schoolId).update({ students });
      }
    }

    // Update school's BloomCollect stats
    await db.collection('admin_bloomcollect').doc(schoolId).update({
      totalVolume:          admin.firestore.FieldValue.increment(schoolFee),
      totalAarinatEarnings: admin.firestore.FieldValue.increment(aarinatNet),
      transactionCount:     admin.firestore.FieldValue.increment(1),
      lastPaymentAt:        admin.firestore.FieldValue.serverTimestamp(),
    });

    // Add to AariNAT ledger
    await db.collection('admin_bloomcollect_ledger').add({
      schoolId, studentName, schoolFee, parentCharge, aarinatNet, term, txRef,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ BloomCollect: ${studentName} @ ${schoolId} — ₦${schoolFee.toLocaleString()} (AariNAT: ₦${aarinatNet})`);
    return res.status(200).json({ success: true });

  } catch (e) {
    console.error('paystackWebhook error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});
