// api/hall-of-fame.js
// Returns all previous weekly winners from Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300'); // Cache 5 minutes

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/hall_of_fame?order=year.desc,week_number.desc,prize_rank.asc&select=wallet_address,score,wave,prize_amount,prize_rank,week_number,year,tx_signature,created_at`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        }
      }
    );

    const winners = await response.json();

    // Group by week for display
    const grouped = {};
    winners.forEach(w => {
      const key = `${w.year}-${w.week_number}`;
      if (!grouped[key]) {
        grouped[key] = {
          week: w.week_number,
          year: w.year,
          winners: []
        };
      }
      grouped[key].winners.push(w);
    });

    return res.status(200).json({
      weeks: Object.values(grouped),
      total_winners: winners.length
    });

  } catch (err) {
    console.error('hall-of-fame error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
