// api/build-payment.js
const https = require('https');

const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT || '4wsT3tYA1YnHjzs6arFYkTEtxk2g8EHer9U9u7SbHPsB';
const SOLANA_NETWORK    = process.env.SOLANA_NETWORK || 'solana';
const USDC_MINTS = {
  'solana':        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};
const USDC_MINT = USDC_MINTS[SOLANA_NETWORK] || USDC_MINTS['solana'];
const RPC_URL   = process.env.SOLANA_RPC_URL || (SOLANA_NETWORK === 'solana-devnet'
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com');

function rpcCall(body) {
  return new Promise((resolve, reject) => {
    const data    = JSON.stringify(body);
    const url     = new URL(RPC_URL);
    const options = {
      hostname: url.hostname,
      path:     '/',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(result)); }
        catch(e) { reject(new Error('Invalid JSON from RPC: ' + result.slice(0, 200))); }
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
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

    const { from } = body;
    if (!from) return res.status(400).json({ error: 'Missing wallet address' });

    console.log('build-payment for:', from, 'network:', SOLANA_NETWORK);

    // Get latest blockhash
    const blockhashRes = await rpcCall({
      jsonrpc: '2.0', id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }]
    });
    const blockhash = blockhashRes?.result?.value?.blockhash;
    console.log('blockhash:', blockhash);
    console.log('full blockhash response:', JSON.stringify(blockhashRes).slice(0, 300));
    if (!blockhash) return res.status(500).json({ error: 'Could not get blockhash', rpc: JSON.stringify(blockhashRes).slice(0,200) });

    // Get sender USDC token account
    const fromATARes = await rpcCall({
      jsonrpc: '2.0', id: 2,
      method: 'getTokenAccountsByOwner',
      params: [from, { mint: USDC_MINT }, { encoding: 'jsonParsed' }]
    });
    const fromATA = fromATARes?.result?.value?.[0]?.pubkey;
    console.log('fromATA:', fromATA);
    if (!fromATA) return res.status(400).json({ error: 'No USDC token account found for your wallet' });

    // Get recipient USDC token account
    const toATARes = await rpcCall({
      jsonrpc: '2.0', id: 3,
      method: 'getTokenAccountsByOwner',
      params: [PAYMENT_RECIPIENT, { mint: USDC_MINT }, { encoding: 'jsonParsed' }]
    });
    const toATA = toATARes?.result?.value?.[0]?.pubkey;
    console.log('toATA:', toATA);
    if (!toATA) return res.status(500).json({ error: 'Game wallet has no USDC account' });

    return res.status(200).json({
      blockhash,
      fromATA, toATA,
      from, to: PAYMENT_RECIPIENT,
      amount: '100000',
      asset: USDC_MINT,
      network: SOLANA_NETWORK,
      feePayer: from,
    });

  } catch (err) {
    console.error('build-payment error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to build payment' });
  }
};
