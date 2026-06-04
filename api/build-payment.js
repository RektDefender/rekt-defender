// api/build-payment.js
// Builds a Solana SPL token transfer transaction for the client to sign.

const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const https = require('https');

// Helper: HTTPS GET that works without fetch
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Invalid JSON from ' + url + ': ' + data.slice(0,100))); }
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
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) { body = {}; }
    }
    body = body || {};

    const { from, to, amount, asset, network } = body;
    console.log('build-payment received:', { from, to, amount, asset, network });

    if (!from || !to || !amount || !asset || !network) {
      return res.status(400).json({
        error: 'Missing required fields',
        received: { from: !!from, to: !!to, amount: !!amount, asset: !!asset, network: !!network }
      });
    }

    const SOLANA_RPC = network === 'solana-devnet'
      ? 'https://api.devnet.solana.com'
      : 'https://api.mainnet-beta.solana.com';

    // Get fee payer from OpenFacilitator server-side
    const supported = await httpsGet('https://pay.openfacilitator.io/supported');
    console.log('supported response:', JSON.stringify(supported).slice(0, 200));
    const solanaKind = supported.kinds?.find(k => k.network === network);
    const feePayer = solanaKind?.extra?.feePayer;
    if (!feePayer) throw new Error('Could not get fee payer from OpenFacilitator');

    console.log('feePayer:', feePayer);

    const connection      = new Connection(SOLANA_RPC, 'confirmed');
    const fromPubkey      = new PublicKey(from);
    const toPubkey        = new PublicKey(to);
    const assetPubkey     = new PublicKey(asset);
    const feePayerPubkey  = new PublicKey(feePayer);

    const fromTokenAccount = await getAssociatedTokenAddress(assetPubkey, fromPubkey);
    const toTokenAccount   = await getAssociatedTokenAddress(assetPubkey, toPubkey);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: feePayerPubkey,
    });

    transaction.add(
      createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        fromPubkey,
        BigInt(amount),
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const serialised = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return res.status(200).json({
      transaction: Buffer.from(serialised).toString('base64'),
      blockhash,
      lastValidBlockHeight,
    });

  } catch (err) {
    console.error('build-payment error:', err);
    return res.status(500).json({ error: err.message || 'Failed to build transaction' });
  }
};
