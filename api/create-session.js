// api/create-session.js
// Returns payment requirements for a game session.
// Supports mainnet and devnet via SOLANA_NETWORK env var.

const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT || '4wsT3tYA1YnHjzs6arFYkTEtxk2g8EHer9U9u7SbHPsB';
const PAYMENTS_ENABLED  = process.env.PAYMENTS_ENABLED === 'true';
const SOLANA_NETWORK    = process.env.SOLANA_NETWORK || 'solana'; // 'solana' or 'solana-devnet'

// USDC mint addresses
const USDC_MINTS = {
  'solana':        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Mainnet
  'solana-devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Devnet
};

const USDC_MINT  = USDC_MINTS[SOLANA_NETWORK] || USDC_MINTS['solana'];
const GAME_PRICE = '100000'; // 0.10 USDC (6 decimals)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!PAYMENTS_ENABLED) {
    const demoSession = 'DEMO_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    return res.status(200).json({
      sessionId: demoSession,
      requiresPayment: false,
      message: 'Demo mode — free session granted',
    });
  }

  return res.status(200).json({
    requiresPayment: true,
    network: SOLANA_NETWORK,
    requirements: {
      scheme: 'exact',
      network: SOLANA_NETWORK,
      maxAmountRequired: GAME_PRICE,
      asset: USDC_MINT,
      payTo: PAYMENT_RECIPIENT,
      description: 'Rekt Defender — 1 game (0.10 USDC)',
    },
  });
}
