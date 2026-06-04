// api/build-payment.js
// Gets blockhash and token accounts from Solana RPC.
// No @solana/web3.js dependency — uses raw Node.js https only.

const https = require('https');

function rpcCall(hostname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname, path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(result)); }
        catch(e) { reject(new Error('Invalid JSON from RPC: ' + result.slice(0, 100))); }
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
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
    body = body || {};

    const { from, to, amount, asset, network } = body;
    console.log('build-payment received:', { from, to, amount, asset, network });

    if (!from || !to || !amount || !asset || !network) {
      return res.status(400).json({
        error: 'Missing required fields',
        received: { from: !!from, to: !!to, amount: !!amount, asset: !!asset, network: !!network }
      });
    }

    const RPC_HOST = network === 'solana-devnet'
      ? 'api.devnet.solana.com'
      : 'api.mainnet-beta.solana.com';

    // Get latest blockhash
    const blockhashRes = await rpcCall(RPC_HOST, {
      jsonrpc: '2.0', id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }]
    });
    const blockhash = blockhashRes?.result?.value?.blockhash;
    const lastValidBlockHeight = blockhashRes?.result?.value?.lastValidBlockHeight;
    console.log('blockhash:', blockhash);

    if (!blockhash) return res.status(500).json({ error: 'Could not get blockhash' });

    // Get sender token account
    const fromATARes = await rpcCall(RPC_HOST, {
      jsonrpc: '2.0', id: 2,
      method: 'getTokenAccountsByOwner',
      params: [from, { mint: asset }, { encoding: 'jsonParsed' }]
    });
    const toATARes = await rpcCall(RPC_HOST, {
      jsonrpc: '2.0', id: 3,
      method: 'getTokenAccountsByOwner',
      params: [to, { mint: asset }, { encoding: 'jsonParsed' }]
    });

    const fromATA = fromATARes?.result?.value?.[0]?.pubkey;
    const toATA   = toATARes?.result?.value?.[0]?.pubkey;
    console.log('fromATA:', fromATA, 'toATA:', toATA);

    if (!fromATA) return res.status(400).json({ error: 'Sender has no USDC token account' });
    if (!toATA)   return res.status(400).json({ error: 'Recipient has no USDC token account' });

    return res.status(200).json({
      blockhash, lastValidBlockHeight,
      fromATA, toATA, from, to, amount, asset, network,
    });

  } catch (err) {
    console.error('build-payment error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to build transaction' });
  }
};
