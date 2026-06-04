// api/build-payment.js
// Builds a Solana SPL token transfer transaction for the client to sign.
// Returns a serialised transaction that Phantom can sign and send.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { from, to, amount, asset, network } = req.body;

    if (!from || !to || !amount || !asset || !network) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const SOLANA_RPC = network === 'solana-devnet'
      ? 'https://api.devnet.solana.com'
      : 'https://api.mainnet-beta.solana.com';

    // Get fee payer from OpenFacilitator server-side (avoids browser CORS)
    const supportedRes = await fetch('https://pay.openfacilitator.io/supported');
    const supported = await supportedRes.json();
    const solanaKind = supported.kinds?.find(k => k.network === network);
    const feePayer = solanaKind?.extra?.feePayer;
    if(!feePayer) throw new Error('Could not get fee payer from OpenFacilitator');

    // Dynamically import Solana web3 and SPL token
    const { Connection, PublicKey, Transaction } = await import('@solana/web3.js');
    const { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');

    const connection   = new Connection(SOLANA_RPC, 'confirmed');
    const fromPubkey   = new PublicKey(from);
    const toPubkey     = new PublicKey(to);
    const assetPubkey  = new PublicKey(asset);
    const feePayerKey  = new PublicKey(feePayer);

    // Get associated token accounts for sender and recipient
    const fromTokenAccount = await getAssociatedTokenAddress(assetPubkey, fromPubkey);
    const toTokenAccount   = await getAssociatedTokenAddress(assetPubkey, toPubkey);

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    // Build the transfer transaction
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: feePayerKey, // OpenFacilitator pays the fee
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

    // Serialise for Phantom to sign
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
}
