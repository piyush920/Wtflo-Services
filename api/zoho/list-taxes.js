const { booksApiGet } = require('./books-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const taxesData = await booksApiGet('/settings/taxes');
    const taxGroupsData = await booksApiGet('/settings/taxes/groups');

    return res.status(200).json({
      taxes: taxesData.taxes || [],
      tax_groups: taxGroupsData.tax_groups || []
    });
  } catch (err) {
    console.error('list-taxes error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch taxes' });
  }
};
