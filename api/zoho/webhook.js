const crypto = require('crypto');
const { calculateAmount, computeAllValidAmounts, SUPPLIER_STATE_CODE, SAC_CODE } = require('./pricing');
const { booksApiCall, getBankDetails, getTaxId, getTaxIds, findOrCreateContact, createInvoice, sendInvoiceEmail, recordPayment } = require('./books-api');

const ZOHO_BOOKS = 'https://www.zohoapis.in/books/v3';

const VALID_AMOUNTS = computeAllValidAmounts();

const processedPayments = new Set();

function isPaymentProcessed(paymentId) {
  if (processedPayments.has(paymentId)) return true;
  processedPayments.add(paymentId);
  if (processedPayments.size > 1000) {
    const first = processedPayments.values().next().value;
    if (first) processedPayments.delete(first);
  }
  return false;
}

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

    if (isPaymentProcessed(paymentId)) {
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    const meta = extractMetadata(payment);
    const orderParts = (meta.o || '').split('|');
    const metaOfferIds = orderParts[0] || '';
    const metaSplitType = orderParts[1] || '';
    const metaPromoCode = orderParts[2] || '';

    let amountValid = false;
    if (metaOfferIds && metaSplitType) {
      const expectedAmount = calculateAmount(metaOfferIds, metaSplitType, metaPromoCode);
      amountValid = expectedAmount !== null && expectedAmount === amount;
      if (!amountValid) {
        console.error(`Amount mismatch: expected ${expectedAmount}, got ${amount} for o=${meta.o}`);
      }
    } else {
      amountValid = VALID_AMOUNTS.has(amount);
      if (!amountValid) {
        console.error(`Unexpected amount (no metadata): ${amount}`);
      }
    }

    if (!amountValid) {
      return res.status(400).json({ error: 'Unexpected amount' });
    }

    const exists = await checkExistingInvoice(paymentId);
    if (exists) {
      return res.status(200).json({ success: true, message: 'Invoice already exists' });
    }

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

    const { contactId } = await findOrCreateContact(email, cleanName, phone, gstin, cleanCompany, address ? customerAddress : null);

    const today = new Date().toISOString().split('T')[0];
    const lineItems = await getLineItems(amount, gstin);
    const placeOfSupply = gstin ? gstin.substring(0, 2) : SUPPLIER_STATE_CODE;
    const referenceNumber = `ZohoPay-${paymentId}`;
    const notes = `Thank you for your business!\n\n${getBankDetails()}`;
    const terms = 'Payment received via Zoho Payments';

    const invoice = await createInvoice(
      contactId, lineItems, placeOfSupply, gstin,
      referenceNumber, notes, terms, today,
      address ? customerAddress : null
    );

    sendInvoiceEmail(invoice.invoice_id, email);
    recordPayment(contactId, invoice.invoice_id, amount, paymentId, today);

    return res.status(200).json({
      success: true,
      message: 'Invoice created and sent',
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number
    });
  } catch (err) {
    console.error('Webhook processing failed:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
