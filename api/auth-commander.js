// api/auth-commander.js
// Verifies commander password server-side and returns a session token
// Password never exposed in browser code

const CMD_PASSWORD = process.env.CMD_PASSWORD;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.rektdefender.lol');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body;

  if(!password) return res.status(400).json({ error: 'No password provided' });
  if(!CMD_PASSWORD) return res.status(500).json({ error: 'Server not configured' });

  if(password !== CMD_PASSWORD){
    // Small delay to slow brute force attempts
    await new Promise(r => setTimeout(r, 1000));
    return res.status(401).json({ error: 'Incorrect password' });
  }

  // Generate a simple session token — timestamp + random string
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2);

  return res.status(200).json({ token });
}
