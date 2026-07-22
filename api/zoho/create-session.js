const ZOHO_ACCOUNTS = 'https://accounts.zoho.in';
const ZOHO_PAYMENTS = 'https://payments.zoho.in/api/v1';
const ZOHO_ACCOUNT_ID = '60078356828';

const OFFERS = {
  'lead-gen': 25000,
  'instant-booking': 25000,
  'followup': 25000,
  'recovery': 25000,
  'test-payment': 1
};

const PROMO_CODES = {
  'PILOT1': 1,
  'PILOT2': 2,
  'PILOT3': 3,
  'FOUNDER4': 4
};

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function calculateAmount(offerIds, splitType, promoCode) {
  const ids = offerIds.split(',').filter(id => OFFERS[id]);
  if (ids.length === 0) return null;

  let subtotal = 0;
  const prices = [];
  ids.forEach(id => {
    subtotal += OFFERS[id];
    prices.push(OFFERS[id]);
  });

  let discount = 0;
  let promoDiscount = 0;

  if (promoCode && PROMO_CODES[promoCode]) {
    const freeCount = PROMO_CODES[promoCode];
    prices.sort((a, b) => b - a);
    for (let i = 0; i < freeCount && i < prices.length; i++) {
      promoDiscount += prices[i];
    }
  } else if (splitType === 'full') {
    discount = Math.round(subtotal * 0.10);
  }

  const taxable = subtotal - discount - promoDiscount;
  const gst = Math.round(taxable * 0.18);
  const total = taxable + gst;

  return splitType === 'full' ? total : Math.round(total / 2);
}

function validateGSTIN(gstin) {
  if (!gstin) return true;
  return GSTIN_REGEX.test(gstin);
}

async function getAccessToken() {
  const refreshToken = process.env.ZOHO_PAYMENTS_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('Missing Zoho env vars');
  }

  const url = `${ZOHO_ACCOUNTS}/oauth/v2/token?refresh_token=${refreshToken}&client_id=${clientId}&client_secret=${clientSecret}&grant_type=refresh_token`;
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json();

  if (data.error) throw new Error('Token refresh failed');
  if (!data.access_token) throw new Error('No access_token in response');

  return data.access_token;
}

module.exports = async function handler(req, res) {
  const allowedOrigin = 'https://services.wtflo.com';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { amount: clientAmount, currency = 'INR', customer_name, customer_email, customer_phone, customer_gstin, customer_company, customer_address, customer_city, customer_state, customer_pincode, description, offer_ids, split_type, promo_code } = req.body;

    if (!customer_name || !customer_email || !customer_phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!offer_ids) {
      return res.status(400).json({ error: 'No offers selected' });
    }

    const offerIdList = offer_ids.split(',').filter(id => OFFERS[id]);
    if (offerIdList.length === 0 || offerIdList.length > 4) {
      return res.status(400).json({ error: 'Invalid offer selection' });
    }

    if (customer_gstin && !validateGSTIN(customer_gstin)) {
      return res.status(400).json({ error: 'Invalid GSTIN format' });
    }

    if (promo_code && !PROMO_CODES[promo_code.toUpperCase()]) {
      return res.status(400).json({ error: 'Invalid promo code' });
    }

    const calculatedAmount = calculateAmount(offer_ids, split_type, promo_code ? promo_code.toUpperCase() : '');
    if (calculatedAmount === null) {
      return res.status(400).json({ error: 'Invalid offer IDs' });
    }

    const amount = calculatedAmount;

    const accessToken = await getAccessToken();

    const metadata = [
      { key: 'n', value: String(customer_name).substring(0, 100) },
      { key: 'e', value: String(customer_email).substring(0, 254) },
      { key: 'p', value: String(customer_phone).substring(0, 15) }
    ];

    if (customer_gstin) {
      metadata.push({ key: 'g', value: String(customer_gstin).substring(0, 15) });
    }
    if (customer_company) {
      metadata.push({ key: 'c', value: String(customer_company).substring(0, 200) });
    }

    const addrParts = [customer_address, customer_city, customer_state, customer_pincode].filter(Boolean);
    if (addrParts.length > 0) {
      metadata.push({ key: 'a', value: addrParts.join('|').substring(0, 250) });
    }

    const sessionBody = {
      amount: String(amount),
      currency,
      description: description || 'Wtflo Services',
      meta_data: metadata,
      configurations: {
        allowed_payment_methods: ['upi', 'card']
      }
    };

    const apiUrl = `${ZOHO_PAYMENTS}/paymentsessions?account_id=${ZOHO_ACCOUNT_ID}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sessionBody)
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      console.error('create-session JSON parse failed:', text.substring(0, 500));
      return res.status(500).json({ error: 'Payment service unavailable' });
    }

    if (data.code !== 0 || !data.payments_session) {
      console.error('create-session API error:', JSON.stringify(data).substring(0, 500));
      return res.status(500).json({ error: 'Payment service unavailable' });
    }

    return res.status(200).json({
      success: true,
      payment_session_id: data.payments_session.payments_session_id
    });
  } catch (err) {
    console.error('create-session error:', err);
    return res.status(500).json({ error: 'Payment service unavailable' });
  }
};
