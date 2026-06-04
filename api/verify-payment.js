// api/verify-payment.js
// Verifies a direct Solana USDC transfer to the game wallet.
// No third party facilitator needed — checks the transaction on-chain directly.

const https = require('https');

const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT || '4wsT3tYA1YnHjzs6arFYkTEtxk2g8EHer9U9u7SbHPsB';
const PAYMENTS_ENABLED  = process.env.PAYMENTS_ENABLED === 'true';
const SOLANA_NETWORK    = process.env.SOLANA_NETWORK || 'solana';

const USDC_MINTS = {
  'solana':        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};
const USDC_MINT   = USDC_MINTS[SOLANA_NETWORK] || USDC_MINTS['solana'];
const GAME_PRICE  = 100000; // 0.10 USDC (6 decimals)
const RPC_HOST    = SOLANA_NETWORK === 'solana-devnet'
  ? 'api.devnet.solana.com'
  : 'api.mainnet-beta.solana.com';

function rpcCall(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: RPC_HOST, path: '/', method: 'POST',
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
    const { signature, walletAddress } = req.body;

    if (!signature || !walletAddress) {
      return res.status(400).json({ error: 'Missing signature or wallet address' });
    }

    console.log(`[${SOLANA_NETWORK}] Verifying transaction:`, signature);

    // Get transaction details from Solana RPC
    const txRes = await rpcCall({
      jsonrpc: '2.0', id: 1,
      method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
    });

    const tx = txRes?.result;
    if (!tx) {
      return res.status(402).json({ error: 'Transaction not found on chain' });
    }

    // Check transaction succeeded
    if (tx.meta?.err) {
      return res.status(402).json({ error: 'Transaction failed on chain' });
    }

    // Check transaction is recent (within last 10 minutes)
    const txAge = Date.now() / 1000 - tx.blockTime;
    if (txAge > 600) {
      return res.status(402).json({ error: 'Transaction too old — must be within 10 minutes' });
    }

    // Find the USDC transfer instruction
    const instructions = tx.transaction?.message?.instructions || [];
    const innerInstructions = tx.meta?.innerInstructions?.flatMap(i => i.instructions) || [];
    const allInstructions = [...instructions, ...innerInstructions];

    let validPayment = false;
    let transferAmount = 0;

    for (const ix of allInstructions) {
      if (ix.program === 'spl-token' && ix.parsed?.type === 'transfer') {
        const info = ix.parsed.info;
        const amount = parseInt(info.amount);
        console.log('Transfer found:', { amount, destination: info.destination, authority: info.authority });

        // Verify amount and recipient
        // Check if destination token account belongs to PAYMENT_RECIPIENT
        if (amount >= GAME_PRICE) {
          // Get owner of destination token account
          const accountRes = await rpcCall({
            jsonrpc: '2.0', id: 2,
            method: 'getAccountInfo',
            params: [info.destination, { encoding: 'jsonParsed' }]
          });
          const owner = accountRes?.result?.value?.data?.parsed?.info?.owner;
          console.log('Destination account owner:', owner);

          if (owner === PAYMENT_RECIPIENT) {
            validPayment = true;
            transferAmount = amount;
            break;
          }
        }
      }

      // Also check transferChecked instruction type
      if (ix.program === 'spl-token' && ix.parsed?.type === 'transferChecked') {
        const info = ix.parsed.info;
        const amount = parseInt(info.tokenAmount?.amount || 0);
        console.log('TransferChecked found:', { amount, destination: info.destination });

        if (amount >= GAME_PRICE) {
          const accountRes = await rpcCall({
            jsonrpc: '2.0', id: 3,
            method: 'getAccountInfo',
            params: [info.destination, { encoding: 'jsonParsed' }]
          });
          const owner = accountRes?.result?.value?.data?.parsed?.info?.owner;
          console.log('Destination account owner:', owner);

          if (owner === PAYMENT_RECIPIENT) {
            validPayment = true;
            transferAmount = amount;
            break;
          }
        }
      }
    }

    if (!validPayment) {
      return res.status(402).json({
        error: 'Payment not verified — could not confirm 0.10 USDC transfer to game wallet',
      });
    }

    console.log(`[${SOLANA_NETWORK}] Payment verified! Amount: ${transferAmount}, Signature: ${signature}`);

    // Issue session ID
    const sessionId = 'SES_' + Date.now().toString(36) + Math.random().toString(36).slice(2);

    return res.status(200).json({
      success: true,
      sessionId,
      transactionHash: signature,
      amount: transferAmount,
      message: 'Payment verified. Game session active.',
    });

  } catch (err) {
    console.error(`[${SOLANA_NETWORK}] verify-payment error:`, err.message);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
