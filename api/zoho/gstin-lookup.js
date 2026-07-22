module.exports = async function handler(req, res) {
  const allowedOrigin = 'https://services.wtflo.com';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { gstin } = req.query;
  if (!gstin || gstin.length !== 15) {
    return res.status(400).json({ error: 'Invalid GSTIN' });
  }

  const keySecret = process.env.APPYFLOW_API_KEY;
  if (!keySecret) {
    return res.status(500).json({ error: 'GSTIN lookup not configured' });
  }

  try {
    const response = await fetch(`https://appyflow.in/api/verifyGST?gstNo=${gstin}&key_secret=${keySecret}`);
    if (!response.ok) {
      return res.status(502).json({ error: 'GSTIN lookup failed' });
    }
    const data = await response.json();
    const tp = data.taxpayerInfo;
    if (!tp) {
      return res.status(404).json({ error: 'GSTIN not found' });
    }
    const addr = tp.pradr?.addr || {};
    const streetParts = [addr.bno, addr.st, addr.loc].filter(Boolean);

    return res.status(200).json({
      success: true,
      address: {
        street: streetParts.join(', '),
        city: addr.dst || '',
        state: addr.stcd || '',
        pincode: addr.pncd || '',
        company: tp.tradeNam || ''
      }
    });
  } catch (e) {
    console.error('GSTIN lookup error:', e.message);
    return res.status(500).json({ error: 'GSTIN lookup failed' });
  }
};
