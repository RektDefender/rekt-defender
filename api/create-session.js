// api/create-session.js
// Returns payment requirements for a game session.
// Client uses these to construct the payment in Phantom.

const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT || '4wsT3tYA1YnHjzs6arFYkTEtxk2g8EHer9U9u7SbHPsB';
const PAYMENTS_ENABLED  = process.env.PAYMENTS_ENABLED === 'true';

// Solana USDC mint address (mainnet)
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// 0.10 USDC — Solana USDC has 6 decimals
const GAME_PRICE = '100000';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // If payments disabled, return a free demo session immediately
  if (!PAYMENTS_ENABLED) {
    const demoSession = 'DEMO_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    return res.status(200).json({
      sessionId: demoSession,
      requiresPayment: false,
      message: 'Demo mode — free session granted',
    });
  }

  // Return payment requirements for the client to build the Phantom transaction
  return res.status(200).json({
    requiresPayment: true,
    requirements: {
      scheme: 'exact',
      network: 'solana',
      maxAmountRequired: GAME_PRICE,
      asset: USDC_MINT,
      payTo: PAYMENT_RECIPIENT,
      description: 'Rekt Defender — 1 game (0.10 USDC)',
    },
  });
}
