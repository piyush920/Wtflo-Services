const { OFFER_PRICE, SAC_CODE, SUPPLIER_STATE_CODE } = require('./pricing');
const { booksApiCall, getBankDetails, getTaxId, findOrCreateContact, createInvoice, sendInvoiceEmail } = require('./books-api');
const { syncContact, sendInternalNotification } = require('./brevo');

function extractGSTINStateCode(gstin) {
  return gstin ? gstin.substring(0, 2) : null;
}

function getPromoLineItems(offerCount, promoCode, taxId) {
  const lineItems = [];
  if (offerCount === 4 && promoCode === 'FOUNDER4') {
    lineItems.push({
      name: 'WhatsApp Marketing System - All 4 Systems Setup',
      description: 'Complimentary setup (FOUNDER4 promo)',
      rate: 0,
      quantity: 1,
      hsn_or_sac: SAC_CODE,
      tax_id: taxId
    });
  } else {
    for (let i = 0; i < offerCount; i++) {
      const isFree = (promoCode === 'PILOT1' && i === 0) ||
                     (promoCode === 'PILOT2' && i < 2) ||
                     (promoCode === 'PILOT3' && i < 3);
      lineItems.push({
        name: isFree ? 'WhatsApp Marketing System - Complimentary' : 'WhatsApp Marketing System',
        description: isFree ? `System ${i + 1} — Complimentary (${promoCode})` : `System ${i + 1} setup`,
        rate: isFree ? 0 : OFFER_PRICE,
        quantity: 1,
        hsn_or_sac: SAC_CODE,
        tax_id: taxId
      });
    }
  }
  return lineItems;
}

module.exports = async function handler(req, res) {
  const allowedOrigin = 'https://services.wtflo.com';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { customer_name, customer_email, customer_phone, customer_gstin, customer_company, customer_address, customer_city, customer_state, customer_pincode, description, offer_ids, promo_code } = req.body;

    if (!customer_name || !customer_email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const offerCount = offer_ids ? offer_ids.split(',').length : 0;
    if (offerCount === 0) {
      return res.status(400).json({ error: 'No offers selected' });
    }

    const cleanName = String(customer_name).replace(/[<>"'&]/g, '').substring(0, 100);
    const customerAddress = {
      street: customer_address || '',
      city: customer_city || '',
      state: customer_state || '',
      pincode: customer_pincode || ''
    };

    const { contactId } = await findOrCreateContact(
      customer_email, cleanName, customer_phone || '',
      customer_gstin, customer_company, customer_address ? customerAddress : null
    );

    const today = new Date().toISOString().split('T')[0];
    const taxId = await getTaxId(customer_gstin);

    if (!taxId) {
      console.error('No tax ID found');
      throw new Error('Tax configuration missing');
    }

    const lineItems = getPromoLineItems(offerCount, promo_code, taxId);

    const placeOfSupply = customer_gstin ? extractGSTINStateCode(customer_gstin) : SUPPLIER_STATE_CODE;
    const referenceNumber = `FreePromo-${promo_code}-${Date.now()}`;
    const notes = `Thank you for your business!\n\nPromo Code: ${promo_code}\n${getBankDetails()}`;
    const terms = `Complimentary setup via ${promo_code}`;

    const invoice = await createInvoice(
      contactId, lineItems, placeOfSupply, customer_gstin,
      referenceNumber, notes, terms, today,
      customer_address ? customerAddress : null
    );

    sendInvoiceEmail(invoice.invoice_id, customer_email);

    await syncContact({ email: customer_email, name: cleanName, phone: customer_phone || '', offers: offer_ids });
    await sendInternalNotification({
      subject: `💰 New Sale (Promo: ${promo_code}) — ₹0`,
      text: `Customer: ${cleanName}\nEmail: ${customer_email}\nPhone: ${customer_phone || 'N/A'}\nOffers: ${offer_ids}\nPromo: ${promo_code}`
    });

    return res.status(200).json({
      success: true,
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number
    });
  } catch (err) {
    console.error('Free invoice error:', err);
    return res.status(500).json({ error: 'Failed to create invoice' });
  }
};
