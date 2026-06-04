// api/verify-payment.js
// Verifies and settles payment via OpenFacilitator.

const https = require('https');

const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT || '4wsT3tYA1YnHjzs6arFYkTEtxk2g8EHer9U9u7SbHPsB';
const PAYMENTS_ENABLED  = process.env.PAYMENTS_ENABLED === 'true';
const SOLANA_NETWORK    = process.env.SOLANA_NETWORK || 'solana';

const USDC_MINTS = {
  'solana':        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

const USDC_MINT  = USDC_MINTS[SOLANA_NETWORK] || USDC_MINTS['solana'];
const GAME_PRICE = '100000';

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(result) }); }
        catch(e) { reject(new Error('Invalid JSON: ' + result.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!PAYMENTS_ENABLED) {
    return res.status(400).json({ error: 'Payments not enabled' });
  }

  try {
    const { payment, walletAddress } = req.body;

    if (!payment || !walletAddress) {
      return res.status(400).json({ error: 'Missing payment payload or wallet address' });
    }

    const requirements = {
      scheme: 'exact',
      network: SOLANA_NETWORK,
      maxAmountRequired: GAME_PRICE,
      asset: USDC_MINT,
      payTo: PAYMENT_RECIPIENT,
    };

    // The payment payload contains the base64 signed transaction
    // OpenFacilitator verify checks it's valid, settle broadcasts it
    const payload = {
      x402Version: 1,
      paymentPayload: payment,
      paymentRequirements: requirements,
    };

    console.log(`[${SOLANA_NETWORK}] Sending to OpenFacilitator verify...`);
    console.log('Payment payload keys:', Object.keys(payment?.payload || {}));

    // ── Step 1: Verify ──
    const verifyResult = await httpsPost('pay.openfacilitator.io', '/verify', payload);
    console.log(`[${SOLANA_NETWORK}] Verify response (${verifyResult.status}):`, JSON.stringify(verifyResult.data));

    if (!verifyResult.data.isValid) {
      return res.status(402).json({
        error: 'Payment verification failed',
        details: verifyResult.data.error || verifyResult.data.invalidReason || 'Unknown reason',
        debug: verifyResult.data,
      });
    }

    // ── Step 2: Settle (OpenFacilitator broadcasts the transaction) ──
    console.log(`[${SOLANA_NETWORK}] Sending to OpenFacilitator settle...`);
    const settleResult = await httpsPost('pay.openfacilitator.io', '/settle', payload);
    console.log(`[${SOLANA_NETWORK}] Settle response (${settleResult.status}):`, JSON.stringify(settleResult.data));

    if (!settleResult.data.success) {
      return res.status(500).json({
        error: 'Payment settlement failed',
        details: settleResult.data.error || 'Unknown error',
        debug: settleResult.data,
      });
    }

    // ── Step 3: Issue session ID ──
    const sessionId = 'SES_' + Date.now().toString(36) + Math.random().toString(36).slice(2);

    return res.status(200).json({
      success: true,
      sessionId,
      transactionHash: settleResult.data.transaction,
      message: 'Payment verified and settled. Game session active.',
    });

  } catch (err) {
    console.error(`[${SOLANA_NETWORK}] verify-payment error:`, err.message);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
