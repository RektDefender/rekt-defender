// api/verify-payment.js
// Verifies a direct Solana USDC transfer.
// Checks signature hasn't been used before, verifies on-chain, records and issues session.

const https = require('https');

const PAYMENT_RECIPIENT    = process.env.PAYMENT_RECIPIENT || '4wsT3tYA1YnHjzs6arFYkTEtxk2g8EHer9U9u7SbHPsB';
const PAYMENTS_ENABLED     = process.env.PAYMENTS_ENABLED === 'true';
const SOLANA_NETWORK       = process.env.SOLANA_NETWORK || 'solana';
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const USDC_MINTS = {
  'solana':        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};
const USDC_MINT  = USDC_MINTS[SOLANA_NETWORK] || USDC_MINTS['solana'];
const GAME_PRICE = 100000;
const RPC_URL    = process.env.SOLANA_RPC_URL || (SOLANA_NETWORK === 'solana-devnet'
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com');

// ── HTTP helpers ──

function rpcCall(body) {
  return new Promise((resolve, reject) => {
    const data    = JSON.stringify(body);
    const url     = new URL(RPC_URL);
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
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

function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
    const data    = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data), 'Prefer': 'return=minimal' } : {})
      }
    };
    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: result ? JSON.parse(result) : null }); }
        catch(e) { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Handler ──

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (!PAYMENTS_ENABLED)       return res.status(400).json({ error: 'Payments not enabled' });

  try {
    const { signature, walletAddress } = req.body;
    if (!signature || !walletAddress) {
      return res.status(400).json({ error: 'Missing signature or wallet address' });
    }

    console.log(`[${SOLANA_NETWORK}] Verifying:`, signature);

    // ── Check signature hasn't been used before ──
    const existingCheck = await supabaseRequest(
      'GET',
      `used_signatures?signature=eq.${encodeURIComponent(signature)}&select=id`
    );
    if (Array.isArray(existingCheck.data) && existingCheck.data.length > 0) {
      console.log('Signature already used:', signature);
      return res.status(402).json({ error: 'Transaction already used for a game session' });
    }

    // ── Fetch transaction from Solana ──
    const txRes = await rpcCall({
      jsonrpc: '2.0', id: 1,
      method:  'getTransaction',
      params:  [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'finalized' }]
    });

    const tx = txRes?.result;
    console.log('tx found:', !!tx, 'error:', txRes?.error?.message);

    if (!tx) return res.status(402).json({ error: 'Transaction not found on chain' });
    if (tx.meta?.err) return res.status(402).json({ error: 'Transaction failed on chain' });

    // Check age (max 10 minutes)
    const txAge = Math.floor(Date.now() / 1000) - tx.blockTime;
    console.log('tx age (seconds):', txAge);
    if (txAge > 600) return res.status(402).json({ error: 'Transaction too old' });

    // ── Find USDC transfer ──
    const instructions      = tx.transaction?.message?.instructions || [];
    const innerInstructions = (tx.meta?.innerInstructions || []).flatMap(i => i.instructions);
    const allInstructions   = [...instructions, ...innerInstructions];

    console.log('instruction count:', allInstructions.length);
    console.log('instruction programs:', allInstructions.map(i => i.program + ':' + i.parsed?.type).join(', '));

    let validPayment = false;

    for (const ix of allInstructions) {
      if (ix.program !== 'spl-token') continue;
      const type   = ix.parsed?.type;
      const info   = ix.parsed?.info || {};
      const amount = parseInt(
        type === 'transferChecked' ? info.tokenAmount?.amount : info.amount
      ) || 0;

      console.log(`Found ${type}: amount=${amount}, destination=${info.destination}`);
      if (amount < GAME_PRICE) continue;

      const accountRes = await rpcCall({
        jsonrpc: '2.0', id: 2,
        method:  'getAccountInfo',
        params:  [info.destination, { encoding: 'jsonParsed' }]
      });
      const owner = accountRes?.result?.value?.data?.parsed?.info?.owner;
      console.log('destination owner:', owner, 'expected:', PAYMENT_RECIPIENT);

      if (owner === PAYMENT_RECIPIENT) {
        validPayment = true;
        break;
      }
    }

    if (!validPayment) {
      return res.status(402).json({ error: 'Could not verify 0.10 USDC transfer to game wallet' });
    }

    // ── Record signature as used ──
    await supabaseRequest('POST', 'used_signatures', {
      signature,
      wallet_address: walletAddress,
    });

    // ── Issue session ID ──
    const sessionId = 'SES_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    console.log(`[${SOLANA_NETWORK}] Payment verified! Session:`, sessionId);

    return res.status(200).json({
      success: true,
      sessionId,
      transactionHash: signature,
      message: 'Payment verified. Game session active.',
    });

  } catch (err) {
    console.error(`[${SOLANA_NETWORK}] verify-payment error:`, err.message);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
