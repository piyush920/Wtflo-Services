const ZOHO_ACCOUNTS = 'https://accounts.zoho.in';
const ZOHO_BOOKS = 'https://www.zohoapis.in/books/v3';

let cachedToken = null;
let tokenExpiry = 0;

async function getBooksAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;

  const refreshToken = process.env.ZOHO_BOOKS_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_BOOKS_CLIENT_ID;
  const clientSecret = process.env.ZOHO_BOOKS_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('Missing Zoho Books env vars');
  }

  const url = `${ZOHO_ACCOUNTS}/oauth/v2/token?refresh_token=${refreshToken}&client_id=${clientId}&client_secret=${clientSecret}&grant_type=refresh_token`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`Books token refresh HTTP ${res.status}: ${errText}`);
    throw new Error(`Books token refresh failed: HTTP ${res.status}`);
  }
  const data = await res.json();

  if (data.error) throw new Error(`Books token refresh failed: ${data.error}`);
  if (!data.access_token) throw new Error('No access_token in Books response');

  cachedToken = data.access_token;
  tokenExpiry = now + ((data.expires_in || 3600) - 300) * 1000;
  return cachedToken;
}

async function booksApiGet(path) {
  const token = await getBooksAccessToken();
  const orgId = process.env.ZOHO_BOOKS_ORG_ID;
  const url = `${ZOHO_BOOKS}${path}${path.includes('?') ? '&' : '?'}organization_id=${orgId}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
  });
  return res.json();
}

async function booksApiPost(path, body) {
  const token = await getBooksAccessToken();
  const orgId = process.env.ZOHO_BOOKS_ORG_ID;
  const url = `${ZOHO_BOOKS}${path}${path.includes('?') ? '&' : '?'}organization_id=${orgId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

module.exports = { getBooksAccessToken, booksApiGet, booksApiPost, ZOHO_BOOKS };
