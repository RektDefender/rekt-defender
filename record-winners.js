// api/record-winners.js
// Records weekly prize winners into the hall_of_fame table
// Uses service key so only callable server-side

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CMD_PASSWORD = process.env.CMD_PASSWORD;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { week, year, winners } = req.body;

    if(!week || !year || !winners || winners.length === 0){
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check for duplicate week entry
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hall_of_fame?week_number=eq.${week}&year=eq.${year}&select=id&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        }
      }
    );
    const existing = await checkRes.json();
    if(existing.length > 0){
      return res.status(409).json({ error: `Week ${week}, ${year} already recorded in Hall of Fame` });
    }

    // Insert all winners
    const rows = winners.map(w => ({
      wallet_address: w.addr,
      score: w.score,
      wave: w.wave,
      prize_amount: w.prize,
      prize_rank: w.rank,
      week_number: week,
      year,
      tx_signature: w.tx || null,
    }));

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/hall_of_fame`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(rows),
    });

    if(!insertRes.ok){
      const err = await insertRes.text();
      throw new Error(err);
    }

    return res.status(200).json({
      success: true,
      message: `${winners.length} winners recorded for week ${week}, ${year}`
    });

  } catch(err){
    console.error('record-winners error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
