const { getBooksAccessToken, ZOHO_BOOKS } = require('./books-auth');

const { SUPPLIER_STATE_CODE, SAC_CODE, getPlaceOfSupply } = require('./pricing');

function getBankDetails() {
  return process.env.BANK_DETAILS || 'Payment received via Zoho Payments';
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

let cachedTaxIds = null;
let taxCacheTime = 0;
const TAX_CACHE_TTL = 3600000;

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
    return {
      trade_name: tp.tradeNam || '',
      legal_name: tp.lgnm || '',
      address: address,
      state: addr.stcd || '',
      pincode: addr.pncd || '',
      state_code: gstin.substring(0, 2)
    };
  } catch (e) {
    console.error('GSTIN lookup failed:', e.message);
    return null;
  }
}

async function findOrCreateContact(email, name, phone, gstin, company, customerAddress, doGstLookup) {
  const gstData = gstin && doGstLookup !== false ? await lookupGSTIN(gstin) : null;
  const businessName = (gstData && gstData.trade_name) || company || '';

  const searchData = await booksApiCall('GET', `/contacts?email=${encodeURIComponent(email)}`);
  if (searchData.contacts && searchData.contacts.length > 0) {
    const existing = searchData.contacts[0];
    if (businessName && existing.contact_name !== businessName) {
      try {
        await booksApiCall('PUT', `/contacts/${existing.contact_id}`, {
          contact_name: businessName,
          company_name: businessName,
          gst_no: gstin,
          gst_treatment: 'business_gst'
        });
      } catch (e) {
        console.error('Contact name update failed (non-fatal):', e.message);
      }
    }
    return { contactId: existing.contact_id, gstData };
  }

  const nameSearch = await booksApiCall('GET', `/contacts?contact_name=${encodeURIComponent(name)}`);
  if (nameSearch.contacts && nameSearch.contacts.length > 0) {
    const existing = nameSearch.contacts[0];
    if (businessName && existing.contact_name !== businessName) {
      try {
        await booksApiCall('PUT', `/contacts/${existing.contact_id}`, {
          contact_name: businessName,
          company_name: businessName,
          gst_no: gstin,
          gst_treatment: 'business_gst'
        });
      } catch (e) {
        console.error('Contact name update failed (non-fatal):', e.message);
      }
    }
    return { contactId: existing.contact_id, gstData };
  }

  const contactBody = {
    contact_name: businessName || name,
    email: email,
    phone: phone || '',
    contact_type: 'customer'
  };

  if (gstin) {
    contactBody.gst_treatment = 'business_gst';
    contactBody.gst_no = gstin;
  }
  if (businessName) {
    contactBody.company_name = businessName;
  } else if (company) {
    contactBody.company_name = company;
  }
  if (customerAddress && customerAddress.street) {
    contactBody.billing_address = {
      street: (customerAddress.street || '').substring(0, 99),
      city: (customerAddress.city || '').substring(0, 99),
      state: (customerAddress.state || '').substring(0, 99),
      zip: (customerAddress.pincode || ''),
      country: 'India'
    };
  }

  try {
    const createContact = await booksApiCall('POST', '/contacts', contactBody);
    if (createContact.contact && createContact.contact.contact_id) {
      return { contactId: createContact.contact.contact_id, gstData };
    }
  } catch (e) {
    if (e.message && e.message.includes('already exists')) {
      const retry = await booksApiCall('GET', `/contacts?contact_name=${encodeURIComponent(contactBody.contact_name)}`);
      if (retry.contacts && retry.contacts.length > 0) {
        return { contactId: retry.contacts[0].contact_id, gstData };
      }
    }
    throw e;
  }
  throw new Error('Failed to create contact');
}

async function createInvoice(contactId, lineItems, placeOfSupply, gstin, referenceNumber, notes, terms, date, customerAddress) {
  const invoiceBody = {
    customer_id: contactId,
    date: date,
    due_date: date,
    reference_number: referenceNumber,
    place_of_supply: placeOfSupply,
    gst_treatment: gstin ? 'business_gst' : 'consumer',
    notes: notes,
    terms: terms,
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

  return createData.invoice;
}

async function sendInvoiceEmail(invoiceId, email) {
  booksApiCall('POST', `/invoices/${invoiceId}/email`, {
    to_mail_ids: [email],
    send_from_org_email_id: true
  }).catch(e => console.error('Invoice email failed (non-fatal):', e.message));
}

async function recordPayment(contactId, invoiceId, amount, paymentId, date) {
  try {
    await booksApiCall('POST', '/customerpayments', {
      customer_id: contactId,
      payment_mode: 'online',
      amount: Number(amount),
      date: date,
      reference_number: paymentId,
      invoice_payments: [{
        invoice_id: invoiceId,
        amount_applied: Number(amount)
      }]
    });
  } catch (e) {
    console.error('Failed to record payment (non-fatal):', e.message);
  }
}

module.exports = {
  booksApiCall,
  getBankDetails,
  getTaxIds,
  getTaxId,
  findOrCreateContact,
  createInvoice,
  sendInvoiceEmail,
  recordPayment
};
