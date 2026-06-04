// api/verify-payment.js
// Verifies and settles payment via OpenFacilitator.
// Supports mainnet and devnet via SOLANA_NETWORK env var.

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

// Helper: HTTPS POST
function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    };
    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(result)); }
        catch(e) { reject(new Error('Invalid JSON: ' + result.slice(0,100))); }
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

    const RPC_HOST = SOLANA_NETWORK === 'solana-devnet'
      ? 'api.devnet.solana.com'
      : 'api.mainnet-beta.solana.com';

    // ── Step 0: Send the signed transaction to Solana ──
    // Browser can't send directly (rate limited), so server does it
    if (payment?.payload?.transaction) {
      console.log(`[${SOLANA_NETWORK}] Sending transaction to Solana RPC...`);
      const sendRes = await httpsPost(RPC_HOST, {
        jsonrpc: '2.0', id: 1,
        method: 'sendRawTransaction',
        params: [payment.payload.transaction, { encoding: 'base64', skipPreflight: false }]
      });
      console.log(`[${SOLANA_NETWORK}] sendRawTransaction response:`, JSON.stringify(sendRes));
      if (sendRes?.result) {
        payment.payload.signature = sendRes.result;
      } else if (sendRes?.error) {
        return res.status(402).json({ error: 'Transaction rejected by Solana: ' + sendRes.error.message });
      }
    }

    const requirements = {
      scheme: 'exact',
      network: SOLANA_NETWORK,
      maxAmountRequired: GAME_PRICE,
      asset: USDC_MINT,
      payTo: PAYMENT_RECIPIENT,
    };

    // ── Step 1: Verify ──
    const verifyData = await httpsPost('https://pay.openfacilitator.io/verify', {
      x402Version: 1,
      paymentPayload: payment,
      paymentRequirements: requirements,
    });
    console.log(`[${SOLANA_NETWORK}] Verify response:`, JSON.stringify(verifyData));

    if (!verifyData.isValid) {
      return res.status(402).json({
        error: 'Payment verification failed',
        details: verifyData.error || 'Unknown reason',
      });
    }

    // ── Step 2: Settle ──
    const settleData = await httpsPost('https://pay.openfacilitator.io/settle', {
      x402Version: 1,
      paymentPayload: payment,
      paymentRequirements: requirements,
    });
    console.log(`[${SOLANA_NETWORK}] Settle response:`, JSON.stringify(settleData));

    if (!settleData.success) {
      return res.status(500).json({
        error: 'Payment settlement failed',
        details: settleData.error || 'Unknown error',
      });
    }

    // ── Step 3: Issue session ID ──
    const sessionId = 'SES_' + Date.now().toString(36) + Math.random().toString(36).slice(2);

    return res.status(200).json({
      success: true,
      sessionId,
      transactionHash: settleData.transaction,
      message: 'Payment verified and settled. Game session active.',
    });

  } catch (err) {
    console.error(`[${SOLANA_NETWORK}] verify-payment error:`, err);
    return res.status(500).json({ error: 'Server error during payment verification' });
  }
}
