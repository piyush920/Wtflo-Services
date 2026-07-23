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

const GST_RATE = 0.18;
const BUNDLE_DISCOUNT_RATE = 0.10;
const SUPPLIER_STATE_CODE = '06';
const SAC_CODE = '998365';
const OFFER_PRICE = 25000;
const MAX_OFFERS = 4;

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

  const normalizedPromo = promoCode ? promoCode.toUpperCase() : '';
  if (normalizedPromo && PROMO_CODES[normalizedPromo]) {
    const freeCount = PROMO_CODES[normalizedPromo];
    prices.sort((a, b) => b - a);
    for (let i = 0; i < freeCount && i < prices.length; i++) {
      promoDiscount += prices[i];
    }
  } else if (splitType === 'full') {
    discount = Math.round(subtotal * BUNDLE_DISCOUNT_RATE);
  }

  const taxable = subtotal - discount - promoDiscount;
  const gst = Math.round(taxable * GST_RATE);
  const total = taxable + gst;

  return splitType === 'full' ? total : Math.round(total / 2);
}

function calculateSubtotal(offerIds) {
  return offerIds.split(',').reduce((sum, id) => sum + (OFFERS[id] || 0), 0);
}

function computeAllValidAmounts() {
  const amounts = new Set();
  const maxOffers = MAX_OFFERS;

  for (let i = 1; i <= maxOffers; i++) {
    const subtotal = OFFER_PRICE * i;

    for (let free = 0; free <= maxOffers; free++) {
      if (free >= i) {
        amounts.add(0);
        continue;
      }

      const promoDiscount = free * OFFER_PRICE;
      const discount = (free === 0) ? Math.round(subtotal * BUNDLE_DISCOUNT_RATE) : 0;
      const taxable = subtotal - discount - promoDiscount;
      const gst = Math.round(taxable * GST_RATE);
      amounts.add(taxable + gst);
      amounts.add(Math.round((taxable + gst) / 2));
    }
  }

  amounts.add(30000);
  amounts.add(Math.round(30000 * (1 + GST_RATE)));
  amounts.add(Math.round(Math.round(30000 * (1 + GST_RATE)) / 2));

  for (let i = 1; i <= 12; i++) amounts.add(i);

  return amounts;
}

function validateGSTIN(gstin) {
  if (!gstin) return true;
  const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return GSTIN_REGEX.test(gstin);
}

function getStateCode(gstin) {
  return gstin ? gstin.substring(0, 2) : null;
}

function isInterState(gstin) {
  return gstin ? getStateCode(gstin) !== SUPPLIER_STATE_CODE : false;
}

function getPlaceOfSupply(gstin) {
  return getStateCode(gstin) || SUPPLIER_STATE_CODE;
}

module.exports = {
  OFFERS,
  PROMO_CODES,
  GST_RATE,
  BUNDLE_DISCOUNT_RATE,
  SUPPLIER_STATE_CODE,
  SAC_CODE,
  OFFER_PRICE,
  MAX_OFFERS,
  calculateAmount,
  calculateSubtotal,
  computeAllValidAmounts,
  validateGSTIN,
  getStateCode,
  isInterState,
  getPlaceOfSupply
};
