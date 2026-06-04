// api/build-payment.js
// Returns payment details for a direct USDC transfer.
// Client builds and signs the transaction directly — no fee payer tricks.

const https = require('https');

const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT || '4wsT3tYA1YnHjzs6arFYkTEtxk2g8EHer9U9u7SbHPsB';
const SOLANA_NETWORK    = process.env.SOLANA_NETWORK || 'solana';

const USDC_MINTS = {
  'solana':        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};
const USDC_MINT = USDC_MINTS[SOLANA_NETWORK] || USDC_MINTS['solana'];
const RPC_HOST  = SOLANA_NETWORK === 'solana-devnet'
  ? 'api.devnet.solana.com'
  : 'solana-mainnet.g.alchemy.com';
const RPC_PATH  = SOLANA_NETWORK === 'solana-devnet' ? '/' : '/v2/demo';

function rpcCall(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: RPC_HOST, path: RPC_PATH, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(result)); }
        catch(e) { reject(new Error('Invalid JSON: ' + result.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(result)); }
        catch(e) { reject(new Error('Invalid JSON: ' + result.slice(0, 100))); }
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

  try {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

    const { from } = body;
    if (!from) return res.status(400).json({ error: 'Missing wallet address' });

    // Get latest blockhash
    const blockhashRes = await rpcCall({
      jsonrpc: '2.0', id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }]
    });
    const blockhash = blockhashRes?.result?.value?.blockhash;
    if (!blockhash) return res.status(500).json({ error: 'Could not get blockhash' });

    // Get sender USDC token account
    const fromATARes = await rpcCall({
      jsonrpc: '2.0', id: 2,
      method: 'getTokenAccountsByOwner',
      params: [from, { mint: USDC_MINT }, { encoding: 'jsonParsed' }]
    });
    const fromATA = fromATARes?.result?.value?.[0]?.pubkey;
    if (!fromATA) return res.status(400).json({ error: 'No USDC token account found for your wallet' });

    // Get recipient USDC token account
    const toATARes = await rpcCall({
      jsonrpc: '2.0', id: 3,
      method: 'getTokenAccountsByOwner',
      params: [PAYMENT_RECIPIENT, { mint: USDC_MINT }, { encoding: 'jsonParsed' }]
    });
    const toATA = toATARes?.result?.value?.[0]?.pubkey;
    if (!toATA) return res.status(500).json({ error: 'Game wallet has no USDC account' });

    console.log('Payment details:', { from, fromATA, toATA, network: SOLANA_NETWORK });

    return res.status(200).json({
      blockhash,
      fromATA,
      toATA,
      from,
      to: PAYMENT_RECIPIENT,
      amount: '100000', // 0.10 USDC
      asset: USDC_MINT,
      network: SOLANA_NETWORK,
      feePayer: from, // Player pays their own fees — works with any wallet
    });

  } catch (err) {
    console.error('build-payment error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to build payment' });
  }
};
