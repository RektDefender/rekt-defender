// api/verify-payment.js
// Receives signed payment payload from client,
// verifies + settles via OpenFacilitator, returns session ID on success.

const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT || '4wsT3tYA1YnHjzs6arFYkTEtxk2g8EHer9U9u7SbHPsB';
const PAYMENTS_ENABLED  = process.env.PAYMENTS_ENABLED === 'true';

const USDC_MINT  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const GAME_PRICE = '100000'; // 0.10 USDC (6 decimals)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // If payments are off, shouldn't be calling this endpoint
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
      network: 'solana',
      maxAmountRequired: GAME_PRICE,
      asset: USDC_MINT,
      payTo: PAYMENT_RECIPIENT,
    };

    // ── Step 1: Verify payment with OpenFacilitator ──
    const verifyRes = await fetch('https://pay.openfacilitator.io/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload: payment,
        paymentRequirements: requirements,
      }),
    });

    const verifyData = await verifyRes.json();

    if (!verifyData.isValid) {
      return res.status(402).json({
        error: 'Payment verification failed',
        details: verifyData.error || 'Unknown reason',
      });
    }

    // ── Step 2: Settle payment (broadcast to Solana) ──
    const settleRes = await fetch('https://pay.openfacilitator.io/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload: payment,
        paymentRequirements: requirements,
      }),
    });

    const settleData = await settleRes.json();

    if (!settleData.success) {
      return res.status(500).json({
        error: 'Payment settlement failed',
        details: settleData.error || 'Unknown error',
      });
    }

    // ── Step 3: Generate verified session ID ──
    const sessionId = 'SES_' + Date.now().toString(36) + Math.random().toString(36).slice(2);

    return res.status(200).json({
      success: true,
      sessionId,
      transactionHash: settleData.transaction,
      message: 'Payment verified and settled. Game session active.',
    });

  } catch (err) {
    console.error('verify-payment error:', err);
    return res.status(500).json({ error: 'Server error during payment verification' });
  }
}
