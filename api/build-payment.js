// api/build-payment.js
// Builds a Solana USDC transfer transaction without @solana/web3.js
// Uses raw HTTP calls to Solana RPC — no problematic dependencies

const https = require('https');

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(result)); }
        catch(e) { reject(new Error('Invalid JSON: ' + result.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Invalid JSON from ' + url)); }
      });
    }).on('error', reject);
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

    // Get fee payer from OpenFacilitator
    const supported = await httpsGet('https://pay.openfacilitator.io/supported');
    console.log('OpenFacilitator supported:', JSON.stringify(supported).slice(0, 300));

    const networkInfo = (supported.kinds || []).find(k => k.network === network);
    const feePayer = networkInfo?.extra?.feePayer;
    console.log('feePayer:', feePayer);

    if (!feePayer) {
      return res.status(500).json({
        error: 'Could not get fee payer from OpenFacilitator',
        supported: JSON.stringify(supported).slice(0, 200)
      });
    }

    // Get latest blockhash from Solana RPC
    const blockhashRes = await httpsPost(RPC_HOST, '/', {
      jsonrpc: '2.0', id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }]
    });

    const blockhash = blockhashRes?.result?.value?.blockhash;
    const lastValidBlockHeight = blockhashRes?.result?.value?.lastValidBlockHeight;
    console.log('blockhash:', blockhash);

    if (!blockhash) {
      return res.status(500).json({ error: 'Could not get blockhash from Solana RPC' });
    }

    // Get associated token accounts
    const fromATARes = await httpsPost(RPC_HOST, '/', {
      jsonrpc: '2.0', id: 2,
      method: 'getTokenAccountsByOwner',
      params: [from, { mint: asset }, { encoding: 'jsonParsed' }]
    });

    const toATARes = await httpsPost(RPC_HOST, '/', {
      jsonrpc: '2.0', id: 3,
      method: 'getTokenAccountsByOwner',
      params: [to, { mint: asset }, { encoding: 'jsonParsed' }]
    });

    const fromATA = fromATARes?.result?.value?.[0]?.pubkey;
    const toATA   = toATARes?.result?.value?.[0]?.pubkey;

    console.log('fromATA:', fromATA, 'toATA:', toATA);

    if (!fromATA) {
      return res.status(400).json({ error: 'Sender has no USDC token account' });
    }
    if (!toATA) {
      return res.status(400).json({ error: 'Recipient has no USDC token account' });
    }

    // Return the transaction details for the client to build and sign via Phantom
    // Phantom's signAndSendTransaction handles the actual transaction construction
    return res.status(200).json({
      blockhash,
      lastValidBlockHeight,
      feePayer,
      fromATA,
      toATA,
      from,
      to,
      amount,
      asset,
      network,
    });

  } catch (err) {
    console.error('build-payment error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to build transaction' });
  }
};
