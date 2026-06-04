// api/submit-score.js
// Vercel serverless function — receives a score submission,
// verifies the session ID, and writes to Supabase if valid.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED === 'true';

// Helper: get current week number and year (Monday reset)
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

// Helper: Supabase REST API call
async function supabaseQuery(path, method, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { sessionId, walletAddress, score, wave, killCount } = req.body;

    // Basic validation
    if (!sessionId || !walletAddress || score === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (typeof score !== 'number' || score < 0 || score > 10000000) {
      return res.status(400).json({ error: 'Invalid score' });
    }

    // If payments are enabled, session ID must start with SES_ (paid session)
    // If payments are disabled (demo mode), allow DEMO_ sessions but don't save to leaderboard
    if (sessionId.startsWith('DEMO_')) {
      return res.status(200).json({
        saved: false,
        message: 'Demo session — score not saved to leaderboard',
        rank: null,
        leaderboard: []
      });
    }

    if (PAYMENTS_ENABLED && !sessionId.startsWith('SES_')) {
      return res.status(403).json({ error: 'Invalid session ID' });
    }

    const { week, year } = getWeekNumber();

    // Check if session ID already used (prevent duplicate submissions)
    const existingCheck = await supabaseQuery(
      `scores?session_id=eq.${encodeURIComponent(sessionId)}&select=id`,
      'GET'
    );
    const existing = await existingCheck.json();
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Session already used' });
    }

    // Check if this wallet already has a score this week
    const existingScoreCheck = await supabaseQuery(
      `scores?wallet_address=eq.${encodeURIComponent(walletAddress)}&week_number=eq.${week}&year=eq.${year}&select=id,score`,
      'GET'
    );
    const existingScore = await existingScoreCheck.json();

    if (existingScore.length > 0) {
      // Only update if new score is higher
      if (score <= existingScore[0].score) {
        // Still return current leaderboard
        const lb = await getLeaderboard(week, year);
        return res.status(200).json({
          saved: false,
          message: 'Previous best score still stands',
          rank: null,
          leaderboard: lb
        });
      }
      // Update existing score
      await supabaseQuery(
        `scores?id=eq.${existingScore[0].id}`,
        'PATCH',
        { score, wave, kill_count: killCount, session_id: sessionId }
      );
    } else {
      // Insert new score
      await supabaseQuery('scores', 'POST', {
        wallet_address: walletAddress,
        score,
        wave,
        kill_count: killCount || 0,
        session_id: sessionId,
        week_number: week,
        year
      });
    }

    // Get updated leaderboard and rank
    const leaderboard = await getLeaderboard(week, year);
    const rank = leaderboard.findIndex(r => r.wallet_address === walletAddress) + 1;

    return res.status(200).json({
      saved: true,
      message: rank > 0 && rank <= 3
        ? `You're #${rank} on the leaderboard!`
        : 'Score saved to leaderboard',
      rank: rank > 0 ? rank : null,
      leaderboard
    });

  } catch (err) {
    console.error('submit-score error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function getLeaderboard(week, year) {
  try {
    const res = await supabaseQuery(
      `scores?week_number=eq.${week}&year=eq.${year}&order=score.desc&limit=10&select=wallet_address,score,wave,kill_count`,
      'GET'
    );
    return await res.json();
  } catch {
    return [];
  }
}
