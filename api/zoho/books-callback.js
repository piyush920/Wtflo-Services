const ZOHO_ACCOUNTS = 'https://accounts.zoho.in';

module.exports = async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  try {
    const clientId = process.env.ZOHO_BOOKS_CLIENT_ID;
    const clientSecret = process.env.ZOHO_BOOKS_CLIENT_SECRET;

    const url = `${ZOHO_ACCOUNTS}/oauth/v2/token?code=${encodeURIComponent(code)}&client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=https://services.wtflo.com/api/zoho/books-callback&grant_type=authorization_code`;
    
    const response = await fetch(url, { method: 'POST' });
    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: 'OAuth exchange failed' });
    }

    return res.status(200).json({
      success: true,
      data: data,
      message: 'Copy the refresh_token from the data field.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'OAuth exchange failed' });
  }
};
