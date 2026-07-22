const crypto = require('crypto');
const { getBooksAccessToken } = require('./books-auth');

const ZOHO_BOOKS = 'https://www.zohoapis.in/books/v3';
const SUPPLIER_STATE_CODE = '06';
const SAC_CODE = '998365';

function getBankDetails() {
  return process.env.BANK_DETAILS || 'Payment received via Zoho Payments';
}

function computeValidAmounts() {
  const amounts = new Set();
  const offerPrice = 25000;
  const maxOffers = 4;

  for (let i = 1; i <= maxOffers; i++) {
    const subtotal = offerPrice * i;

    // Full payment without promo: 10% discount + GST
    const fullDiscount = Math.round(subtotal * 0.10);
    const fullTaxable = subtotal - fullDiscount;
    const fullGst = Math.round(fullTaxable * 0.18);
    amounts.add(fullTaxable + fullGst);

    // Split payment without promo: no discount, GST on full, pay 50%
    const splitGst = Math.round(subtotal * 0.18);
    amounts.add(Math.round((subtotal + splitGst) / 2));

    // Promo amounts (no 10% discount, but some systems free)
    for (let free = 1; free <= 4; free++) {
      if (free >= i) {
        amounts.add(0);
        continue;
      }
      const promoSubtotal = subtotal - (offerPrice * free);
      const promoGst = Math.round(promoSubtotal * 0.18);
      amounts.add(promoSubtotal + promoGst);
      amounts.add(Math.round((promoSubtotal + promoGst) / 2));
    }
  }
  amounts.add(30000);
  amounts.add(Math.round(30000 * 1.18));
  amounts.add(Math.round(Math.round(30000 * 1.18) / 2));

  return amounts;
}

const VALID_AMOUNTS = computeValidAmounts();
for (let i = 1; i <= 12; i++) VALID_AMOUNTS.add(i);

let cachedTaxIds = null;
let taxCacheTime = 0;
const TAX_CACHE_TTL = 3600000;

function verifyWebhookSignature(timestamp, signature, payload) {
  const signingKey = process.env.ZOHO_SIGNING_KEY;
  if (!signingKey) throw new Error('Missing ZOHO_SIGNING_KEY');

  const data = `${timestamp}.${payload}`;
  const expectedSig = crypto.createHmac('sha256', signingKey).update(data).digest('hex');

  try {
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSig, 'hex');
    if (sigBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch (e) {
    return false;
  }
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
      console.error(`Zoho API error ${res.status}: ${errText}`);
      throw new Error(`Zoho API error ${res.status}: ${errText}`);
    }
    return res.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function getTaxIds() {
  const now = Date.now();
  if (cachedTaxIds && (now - taxCacheTime) < TAX_CACHE_TTL) return cachedTaxIds;

  const data = await booksApiCall('GET', '/settings/taxes');
  const taxes = data.taxes || [];

  const intra = taxes.find(t => t.tax_name === 'GST @18%' && t.tax_type === 'tax_group');
  const inter = taxes.find(t => t.tax_name === 'IGST18' && t.tax_type === 'tax');

  cachedTaxIds = {
    intra: intra?.tax_id || null,
    inter: inter?.tax_id || null
  };
  taxCacheTime = now;

  return cachedTaxIds;
}

async function checkExistingInvoice(paymentId) {
  try {
    const data = await booksApiCall('GET', `/invoices?reference_number=ZohoPay-${paymentId}`);
    return data.invoices && data.invoices.length > 0;
  } catch (e) {
    console.error('Dedup check failed:', e.message);
    return false;
  }
}

function extractMetadata(payment) {
  const meta = {};
  const metaData = payment.meta_data || [];
  metaData.forEach(item => {
    meta[item.key] = item.value;
  });
  return meta;
}

async function lookupGSTIN(gstin) {
  if (!gstin || gstin.length !== 15) return null;
  const keySecret = process.env.APPYFLOW_API_KEY;
  if (!keySecret) { console.error('APPYFLOW_API_KEY not set'); return null; }
  try {
    const res = await fetch(`https://appyflow.in/api/verifyGST?gstNo=${gstin}&key_secret=${keySecret}`);
    if (!res.ok) return null;
    const data = await res.json();
    const tp = data.taxpayerInfo;
    if (!tp) return null;
    const addr = tp.pradr?.addr || {};
    const parts = [addr.bno, addr.st, addr.loc, addr.city, addr.dst].filter(Boolean);
    const address = parts.join(', ');
    const result = {
      trade_name: tp.tradeNam || '',
      legal_name: tp.lgnm || '',
      address: address,
      state: addr.stcd || '',
      pincode: addr.pncd || '',
      state_code: gstin.substring(0, 2)
    };
    return result;
  } catch (e) {
    console.error('GSTIN lookup failed:', e.message);
    return null;
  }
}

async function findOrCreateContact(email, name, phone, gstin, company, customerAddress) {
  const gstData = gstin ? await lookupGSTIN(gstin) : null;

  let searchData = await booksApiCall('GET', `/contacts?email=${encodeURIComponent(email)}`);

  if (!searchData.contacts || searchData.contacts.length === 0) {
    searchData = await booksApiCall('GET', `/contacts?contact_name=${encodeURIComponent(name)}`);
  }

  if (searchData.contacts && searchData.contacts.length > 0) {
    const contact = searchData.contacts[0];
    const contactId = contact.contact_id;
    return { contactId, customerStateCode: gstin ? gstin.substring(0, 2) : null, gstData };
  }

  const contactBody = {
    contact_name: (gstData && gstData.trade_name) || name || email.split('@')[0],
    email: email,
    phone: phone || '',
    contact_type: 'customer'
  };

  if (gstin) {
    contactBody.gst_treatment = 'business_gst';
    contactBody.gst_no = gstin;
  }
  if (gstData) {
    if (gstData.trade_name) contactBody.company_name = company || gstData.trade_name;
  }
  if (company) {
    contactBody.company_name = company;
  }
  if (customerAddress && customerAddress.street) {
    contactBody.billing_address = {
      street: customerAddress.street.substring(0, 99),
      city: (customerAddress.city || '').substring(0, 99),
      state: (customerAddress.state || '').substring(0, 99),
      zip: (customerAddress.pincode || ''),
      country: 'India'
    };
  }

  try {
    const createData = await booksApiCall('POST', '/contacts', contactBody);
    if (createData.contact && createData.contact.contact_id) {
      return { contactId: createData.contact.contact_id, customerStateCode: gstin ? gstin.substring(0, 2) : null, gstData };
    }
  } catch (e) {
    if (e.message && e.message.includes('already exists')) {
      const retry = await booksApiCall('GET', `/contacts?contact_name=${encodeURIComponent(contactBody.contact_name)}`);
      if (retry.contacts && retry.contacts.length > 0) {
        return { contactId: retry.contacts[0].contact_id, customerStateCode: gstin ? gstin.substring(0, 2) : null, gstData };
      }
    }
    throw e;
  }
  throw new Error('Failed to create contact');
}

async function getTaxId(gstin) {
  const taxIds = await getTaxIds();

  if (gstin && taxIds.inter) {
    const customerStateCode = gstin.substring(0, 2);
    if (customerStateCode !== SUPPLIER_STATE_CODE) {
      return taxIds.inter;
    }
  }

  return taxIds.intra;
}

async function getLineItems(amount, gstin) {
  const amt = Number(amount);
  const taxId = await getTaxId(gstin);

  if (amt <= 12) {
    return [{
      name: 'Test Payment',
      description: 'Test payment for system verification',
      rate: amt,
      quantity: 1,
      hsn_or_sac: SAC_CODE,
      tax_id: taxId
    }];
  }

  const subtotal1 = Math.round(amt / 1.18);

  if (subtotal1 <= 27500) {
    return [{
      name: 'WhatsApp Marketing System - Setup Fee',
      description: 'One-time setup fee for WhatsApp marketing system configuration',
      rate: 25000,
      quantity: 1,
      hsn_or_sac: SAC_CODE,
      tax_id: taxId
    }];
  }

  if (subtotal1 <= 35400) {
    return [{
      name: 'WhatsApp Marketing System - Monthly Retainer',
      description: 'Monthly retainer for WhatsApp marketing management services',
      rate: 30000,
      quantity: 1,
      hsn_or_sac: SAC_CODE,
      tax_id: taxId
    }];
  }

  return [
    {
      name: 'WhatsApp Marketing System - All 4 Systems Setup',
      description: 'Setup fee for all 4 WhatsApp marketing systems (Lead Gen, Booking, Follow-Up, Recovery)',
      rate: 90000,
      quantity: 1,
      hsn_or_sac: SAC_CODE,
      tax_id: taxId
    },
    {
      name: 'Bundle Discount',
      description: 'Discount for choosing all 4 systems together',
      rate: -10000,
      quantity: 1,
      hsn_or_sac: SAC_CODE,
      tax_id: taxId
    }
  ];
}

async function createInvoiceAndSend(contactId, amount, paymentId, gstin, customerStateCode, gstData, customerEmail, customerAddress) {
  const today = new Date().toISOString().split('T')[0];
  const lineItems = await getLineItems(amount, gstin);
  const placeOfSupply = customerStateCode || SUPPLIER_STATE_CODE;

  const invoiceBody = {
    customer_id: contactId,
    date: today,
    due_date: today,
    reference_number: `ZohoPay-${paymentId}`,
    place_of_supply: placeOfSupply,
    gst_treatment: gstin ? 'business_gst' : 'consumer',
    notes: `Thank you for your business!\n\n${getBankDetails()}`,
    terms: 'Payment received via Zoho Payments',
    line_items: lineItems
  };

  const createData = await booksApiCall('POST', '/invoices', invoiceBody);

  if (!createData.invoice) {
    throw new Error('Failed to create invoice');
  }

  const invoiceId = createData.invoice.invoice_id;

  if (customerAddress && customerAddress.street) {
    try {
      await booksApiCall('PUT', `/invoices/${invoiceId}/address/billing`, {
        address: String(customerAddress.street).substring(0, 99),
        city: String(customerAddress.city || '').substring(0, 99),
        state: String(customerAddress.state || '').substring(0, 99),
        zip: String(customerAddress.pincode || '').substring(0, 99),
        country: 'India'
      });
    } catch (e) {
      console.error('Billing address update failed (non-fatal):', e.message);
    }
  }

  booksApiCall('POST', `/invoices/${invoiceId}/email`, {
    to_mail_ids: [customerEmail],
    send_from_org_email_id: true
  }).catch(e => console.error('Invoice email send failed (non-fatal):', e.message));

  try {
    await booksApiCall('POST', '/customerpayments', {
      customer_id: contactId,
      payment_mode: 'online',
      amount: Number(amount),
      date: today,
      reference_number: paymentId,
      invoice_payments: [{
        invoice_id: invoiceId,
        amount_applied: Number(amount)
      }]
    });
  } catch (e) {
    console.error('Failed to record payment:', e.message);
  }

  return {
    invoiceId,
    invoiceNumber: createData.invoice.invoice_number
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', 'https://services.wtflo.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Zoho-Webhook-Signature');
    return res.status(200).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const event = req.body;
    const eventType = event.event_type;

    if (eventType !== 'payment.succeeded') {
      return res.status(200).json({ success: true });
    }

    const payment = event.event_object?.payment;
    if (!payment) {
      return res.status(400).json({ error: 'No payment in event' });
    }

    const paymentId = payment.payment_id;
    const amount = Number(payment.amount);

    if (!VALID_AMOUNTS.has(amount)) {
      console.error(`Unexpected amount: ${amount}. Valid amounts:`, [...VALID_AMOUNTS]);
      return res.status(400).json({ error: 'Unexpected amount' });
    }

    const exists = await checkExistingInvoice(paymentId);
    if (exists) {
      return res.status(200).json({ success: true, message: 'Invoice already exists' });
    }

    const meta = extractMetadata(payment);
    const email = meta.e || payment.receipt_email || '';
    const name = meta.n || payment.payment_method?.billing_address?.name || email.split('@')[0];
    const phone = meta.p || payment.phone || '';
    const gstin = meta.g || '';
    const company = meta.c || '';
    const addrParts = (meta.a || '').split('|');
    const address = addrParts[0] || '';
    const city = addrParts[1] || '';
    const state = addrParts[2] || '';
    const pincode = addrParts[3] || '';

    if (!email) {
      return res.status(400).json({ error: 'No customer email' });
    }

    const cleanName = String(name).replace(/[<>"'&]/g, '').substring(0, 100);
    const cleanCompany = String(company).replace(/[<>"'&]/g, '').substring(0, 200);
    const customerAddress = { street: address, city, state, pincode };

    const { contactId, customerStateCode, gstData } = await findOrCreateContact(email, cleanName, phone, gstin, cleanCompany, customerAddress);
    const result = await createInvoiceAndSend(contactId, amount, paymentId, gstin, customerStateCode, gstData, email, customerAddress);

    return res.status(200).json({
      success: true,
      message: 'Invoice created and sent',
      invoice_id: result.invoiceId,
      invoice_number: result.invoiceNumber
    });
  } catch (err) {
    console.error('Webhook processing failed:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
