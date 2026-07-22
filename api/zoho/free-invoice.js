const { getBooksAccessToken, ZOHO_BOOKS } = require('./books-auth');

const SUPPLIER_STATE_CODE = '06';
const SAC_CODE = '998365';
const OFFER_PRICE = 25000;

function getBankDetails() {
  return process.env.BANK_DETAILS || 'Payment received via Zoho Payments';
}

function extractGSTINStateCode(gstin) {
  return gstin ? gstin.substring(0, 2) : null;
}

async function booksApiCall(method, path, body) {
  const token = await getBooksAccessToken();
  const orgId = process.env.ZOHO_BOOKS_ORG_ID;
  const url = `${ZOHO_BOOKS}${path}${path.includes('?') ? '&' : '?'}organization_id=${orgId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const options = {
    method,
    signal: controller.signal,
    headers: {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);
  try {
    const res = await fetch(url, options);
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Zoho API error ${res.status}: ${errText}`);
    }
    return res.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function getTaxIds() {
  const data = await booksApiCall('GET', '/settings/taxes');
  const taxes = data.taxes || [];

  const intra = taxes.find(t => t.tax_name === 'GST @18%' && t.tax_type === 'tax_group');
  const inter = taxes.find(t => t.tax_name === 'IGST18' && t.tax_type === 'tax');

  return {
    intra: intra?.tax_id || null,
    inter: inter?.tax_id || null
  };
}

function getBankDetailsText() {
  return process.env.BANK_DETAILS || 'Payment received via Zoho Payments';
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

    let contactId;
    const searchData = await booksApiCall('GET', `/contacts?email=${encodeURIComponent(customer_email)}`);
    if (searchData.contacts && searchData.contacts.length > 0) {
      contactId = searchData.contacts[0].contact_id;
    } else {
      const nameSearch = await booksApiCall('GET', `/contacts?contact_name=${encodeURIComponent(cleanName)}`);
      if (nameSearch.contacts && nameSearch.contacts.length > 0) {
        contactId = nameSearch.contacts[0].contact_id;
      } else {
        const contactBody = {
          contact_name: cleanName,
          email: customer_email,
          phone: customer_phone || '',
          contact_type: 'customer'
        };
        if (customer_gstin) {
          contactBody.gst_treatment = 'business_gst';
          contactBody.gst_no = customer_gstin;
        }
        if (customer_company) contactBody.company_name = customer_company;
        if (customer_address) {
          contactBody.billing_address = {
            street: customer_address.substring(0, 99),
            city: (customer_city || '').substring(0, 99),
            state: (customer_state || '').substring(0, 99),
            zip: (customer_pincode || ''),
            country: 'India'
          };
        }
        try {
          const createContact = await booksApiCall('POST', '/contacts', contactBody);
          contactId = createContact.contact.contact_id;
        } catch (e) {
          if (e.message && e.message.includes('already exists')) {
            const retry = await booksApiCall('GET', `/contacts?contact_name=${encodeURIComponent(cleanName)}`);
            if (retry.contacts && retry.contacts.length > 0) {
              contactId = retry.contacts[0].contact_id;
            }
          }
          if (!contactId) throw e;
        }
      }
    }

    const today = new Date().toISOString().split('T')[0];
    const taxIds = await getTaxIds();
    const isInterState = customer_gstin ? extractGSTINStateCode(customer_gstin) !== SUPPLIER_STATE_CODE : false;
    const taxId = isInterState ? (taxIds.inter || taxIds.intra) : (taxIds.intra || taxIds.inter);

    if (!taxId) {
      console.error('No tax ID found:', taxIds);
      throw new Error('Tax configuration missing');
    }

    const lineItems = [];
    if (offerCount === 4 && promo_code === 'FOUNDER4') {
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
        const isFree = (promo_code === 'PILOT1' && i === 0) ||
                       (promo_code === 'PILOT2' && i < 2) ||
                       (promo_code === 'PILOT3' && i < 3);
        lineItems.push({
          name: isFree ? `WhatsApp Marketing System - Complimentary` : `WhatsApp Marketing System`,
          description: isFree ? `System ${i + 1} — Complimentary (${promo_code})` : `System ${i + 1} setup`,
          rate: isFree ? 0 : OFFER_PRICE,
          quantity: 1,
          hsn_or_sac: SAC_CODE,
          tax_id: taxId
        });
      }
    }

    const placeOfSupply = customer_gstin ? extractGSTINStateCode(customer_gstin) : SUPPLIER_STATE_CODE;
    const invoiceBody = {
      customer_id: contactId,
      date: today,
      due_date: today,
      reference_number: `FreePromo-${promo_code}-${Date.now()}`,
      place_of_supply: placeOfSupply,
      gst_treatment: customer_gstin ? 'business_gst' : 'consumer',
      notes: `Thank you for your business!\n\nPromo Code: ${promo_code}\n${getBankDetailsText()}`,
      terms: `Complimentary setup via ${promo_code}`,
      line_items: lineItems
    };

    const invoiceData = await booksApiCall('POST', '/invoices', invoiceBody);
    if (!invoiceData.invoice) {
      throw new Error('Failed to create invoice');
    }

    const invoiceId = invoiceData.invoice.invoice_id;

    if (customer_address) {
      try {
        await booksApiCall('PUT', `/invoices/${invoiceId}/address/billing`, {
          address: String(customer_address).substring(0, 99),
          city: String(customer_city || '').substring(0, 99),
          state: String(customer_state || '').substring(0, 99),
          zip: String(customer_pincode || '').substring(0, 99),
          country: 'India'
        });
      } catch (e) {
        console.error('Billing address update failed (non-fatal):', e.message);
      }
    }
    booksApiCall('POST', `/invoices/${invoiceId}/email`, {
      to_mail_ids: [customer_email],
      send_from_org_email_id: true
    }).catch(e => console.error('Invoice email failed (non-fatal):', e.message));

    return res.status(200).json({
      success: true,
      invoice_id: invoiceId,
      invoice_number: invoiceData.invoice.invoice_number
    });
  } catch (err) {
    console.error('Free invoice error:', err);
    return res.status(500).json({ error: 'Failed to create invoice' });
  }
};
