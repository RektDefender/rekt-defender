// api/leaderboard.js
// Returns the current week's top scores from Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function getWeekNumber() {
  const now = new Date();
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  const day = monday.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setUTCDate(monday.getUTCDate() + diff);

  const yearStart = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((monday - yearStart) / 86400000 + 1) / 7);
  return { week: weekNum, year: monday.getUTCFullYear() };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=30'); // Cache for 30 seconds

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Support explicit week/year params for commander panel
    const { week, year } = getWeekNumber();
    const queryWeek = req.query.week ? parseInt(req.query.week) : week;
    const queryYear = req.query.year ? parseInt(req.query.year) : year;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/scores?week_number=eq.${queryWeek}&year=eq.${queryYear}&order=score.desc&limit=${limit}&select=wallet_address,score,wave,kill_count,created_at`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        }
      }
    );

    const scores = await response.json();

    return res.status(200).json({
      week: queryWeek,
      year: queryYear,
      weekStarting: queryWeek === week ? getWeekStartDate() : null,
      scores,
      total: scores.length
    });

  } catch (err) {
    console.error('leaderboard error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

function getWeekStartDate() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}
