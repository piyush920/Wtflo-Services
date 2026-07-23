const assert = require('assert');
const {
  calculateAmount,
  computeAllValidAmounts,
  validateGSTIN,
  getStateCode,
  isInterState,
  getPlaceOfSupply,
  OFFERS,
  PROMO_CODES,
  OFFER_PRICE,
  BUNDLE_DISCOUNT_RATE,
  GST_RATE
} = require('../api/zoho/pricing');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
  }
}

function suite(name, fn) {
  console.log(`\n${name}`);
  fn();
}

function assertAmount(result, expected, label) {
  assert.strictEqual(
    result,
    expected,
    `${label}: expected ${expected}, got ${result}`
  );
}

function assertValidAmounts(amounts, expected) {
  expected.forEach(a => {
    assert(
      amounts.has(a),
      `Valid amounts should include ${a}`
    );
  });
}

function getExpected(subtotal, free, splitType) {
  const promoDiscount = free * OFFER_PRICE;
  const discount = (free === 0) ? Math.round(subtotal * BUNDLE_DISCOUNT_RATE) : 0;
  const taxable = subtotal - discount - promoDiscount;
  const gst = Math.round(taxable * GST_RATE);
  const total = taxable + gst;
  return splitType === 'full' ? total : Math.round(total / 2);
}

suite('calculateAmount - offer IDs', () => {
  test('single offer full payment', () => {
    assertAmount(calculateAmount('lead-gen', 'full', ''), 26550, '1 offer full');
  });

  test('single offer split payment', () => {
    assertAmount(calculateAmount('lead-gen', 'split', ''), 14750, '1 offer split');
  });

  test('two offers full payment', () => {
    assertAmount(calculateAmount('lead-gen,instant-booking', 'full', ''), 53100, '2 offers full');
  });

  test('two offers split payment', () => {
    assertAmount(calculateAmount('lead-gen,instant-booking', 'split', ''), 29500, '2 offers split');
  });

  test('three offers full payment', () => {
    assertAmount(calculateAmount('lead-gen,instant-booking,followup', 'full', ''), 79650, '3 offers full');
  });

  test('three offers split payment', () => {
    assertAmount(calculateAmount('lead-gen,instant-booking,followup', 'split', ''), 44250, '3 offers split');
  });

  test('four offers full payment', () => {
    assertAmount(calculateAmount('lead-gen,instant-booking,followup,recovery', 'full', ''), 106200, '4 offers full');
  });

  test('four offers split payment', () => {
    assertAmount(calculateAmount('lead-gen,instant-booking,followup,recovery', 'split', ''), 59000, '4 offers split');
  });

  test('test payment full', () => {
    assertAmount(calculateAmount('test-payment', 'full', ''), 1, 'test payment full');
  });

  test('test payment split', () => {
    assertAmount(calculateAmount('test-payment', 'split', ''), 1, 'test payment split');
  });

  test('invalid offer returns null', () => {
    assert.strictEqual(calculateAmount('nonexistent', 'full', ''), null);
  });

  test('empty string returns null', () => {
    assert.strictEqual(calculateAmount('', 'full', ''), null);
  });
});

suite('calculateAmount - promo codes (PILOT1 = 1 free)', () => {
  test('PILOT1 on 1 offer = total 0', () => {
    assertAmount(calculateAmount('lead-gen', 'full', 'PILOT1'), 0, 'PILOT1 1 offer full');
    assertAmount(calculateAmount('lead-gen', 'split', 'PILOT1'), 0, 'PILOT1 1 offer split');
  });

  test('PILOT1 on 2 offers = 1 paid', () => {
    const subtotal = OFFER_PRICE * 2;
    const expected = getExpected(subtotal, 1, 'full');
    assertAmount(calculateAmount('lead-gen,instant-booking', 'full', 'PILOT1'), expected, 'PILOT1 2 offers full');
  });

  test('PILOT1 on 2 offers split', () => {
    const subtotal = OFFER_PRICE * 2;
    const expected = getExpected(subtotal, 1, 'split');
    assertAmount(calculateAmount('lead-gen,instant-booking', 'split', 'PILOT1'), expected, 'PILOT1 2 offers split');
  });

  test('PILOT1 on 3 offers', () => {
    const subtotal = OFFER_PRICE * 3;
    assertAmount(calculateAmount('lead-gen,instant-booking,followup', 'full', 'PILOT1'), getExpected(subtotal, 1, 'full'), 'PILOT1 3 offers full');
    assertAmount(calculateAmount('lead-gen,instant-booking,followup', 'split', 'PILOT1'), getExpected(subtotal, 1, 'split'), 'PILOT1 3 offers split');
  });

  test('PILOT1 on 4 offers', () => {
    const subtotal = OFFER_PRICE * 4;
    assertAmount(calculateAmount('lead-gen,instant-booking,followup,recovery', 'full', 'PILOT1'), getExpected(subtotal, 1, 'full'), 'PILOT1 4 offers full');
    assertAmount(calculateAmount('lead-gen,instant-booking,followup,recovery', 'split', 'PILOT1'), getExpected(subtotal, 1, 'split'), 'PILOT1 4 offers split');
  });
});

suite('calculateAmount - promo codes (PILOT2 = 2 free)', () => {
  test('PILOT2 on 1 offer = total 0 (free > selected)', () => {
    assertAmount(calculateAmount('lead-gen', 'full', 'PILOT2'), 0, 'PILOT2 1 offer full');
    assertAmount(calculateAmount('lead-gen', 'split', 'PILOT2'), 0, 'PILOT2 1 offer split');
  });

  test('PILOT2 on 2 offers = total 0', () => {
    assertAmount(calculateAmount('lead-gen,instant-booking', 'full', 'PILOT2'), 0, 'PILOT2 2 offers full');
    assertAmount(calculateAmount('lead-gen,instant-booking', 'split', 'PILOT2'), 0, 'PILOT2 2 offers split');
  });

  test('PILOT2 on 3 offers = 1 paid', () => {
    const subtotal = OFFER_PRICE * 3;
    assertAmount(calculateAmount('lead-gen,instant-booking,followup', 'full', 'PILOT2'), getExpected(subtotal, 2, 'full'), 'PILOT2 3 offers full');
    assertAmount(calculateAmount('lead-gen,instant-booking,followup', 'split', 'PILOT2'), getExpected(subtotal, 2, 'split'), 'PILOT2 3 offers split');
  });

  test('PILOT2 on 4 offers = 2 paid', () => {
    const subtotal = OFFER_PRICE * 4;
    assertAmount(calculateAmount('lead-gen,instant-booking,followup,recovery', 'full', 'PILOT2'), getExpected(subtotal, 2, 'full'), 'PILOT2 4 offers full');
    assertAmount(calculateAmount('lead-gen,instant-booking,followup,recovery', 'split', 'PILOT2'), getExpected(subtotal, 2, 'split'), 'PILOT2 4 offers split');
  });
});

suite('calculateAmount - promo codes (PILOT3 = 3 free)', () => {
  test('PILOT3 on 3 offers = total 0', () => {
    assertAmount(calculateAmount('lead-gen,instant-booking,followup', 'full', 'PILOT3'), 0, 'PILOT3 3 offers full');
    assertAmount(calculateAmount('lead-gen,instant-booking,followup', 'split', 'PILOT3'), 0, 'PILOT3 3 offers split');
  });

  test('PILOT3 on 4 offers = 1 paid', () => {
    const subtotal = OFFER_PRICE * 4;
    assertAmount(calculateAmount('lead-gen,instant-booking,followup,recovery', 'full', 'PILOT3'), getExpected(subtotal, 3, 'full'), 'PILOT3 4 offers full');
    assertAmount(calculateAmount('lead-gen,instant-booking,followup,recovery', 'split', 'PILOT3'), getExpected(subtotal, 3, 'split'), 'PILOT3 4 offers split');
  });
});

suite('calculateAmount - promo codes (FOUNDER4 = 4 free)', () => {
  test('FOUNDER4 on 1-4 offers = total 0', () => {
    for (let i = 1; i <= 4; i++) {
      const ids = Object.keys(OFFERS).filter(k => k !== 'test-payment').slice(0, i).join(',');
      assertAmount(calculateAmount(ids, 'full', 'FOUNDER4'), 0, `FOUNDER4 ${i} offers full`);
      assertAmount(calculateAmount(ids, 'split', 'FOUNDER4'), 0, `FOUNDER4 ${i} offers split`);
    }
  });
});

suite('calculateAmount - promo code disables bundle discount', () => {
  test('PILOT1 2 offers should NOT have 10% bundle discount on remaining item', () => {
    const withPromo = calculateAmount('lead-gen,instant-booking', 'full', 'PILOT1');
    const expectedNoDiscount = (OFFER_PRICE + Math.round(OFFER_PRICE * GST_RATE));
    assert.strictEqual(withPromo, expectedNoDiscount, 'Promo should disable bundle discount');
  });
});

suite('calculateAmount - promo code case insensitivity', () => {
  test('lowercase promo codes work', () => {
    assertAmount(calculateAmount('lead-gen,instant-booking,followup', 'full', 'pilot1'), getExpected(OFFER_PRICE * 3, 1, 'full'), 'lowercase PILOT1');
    assertAmount(calculateAmount('lead-gen,instant-booking,followup,recovery', 'full', 'pilot2'), getExpected(OFFER_PRICE * 4, 2, 'full'), 'lowercase PILOT2');
    assertAmount(calculateAmount('lead-gen,instant-booking,followup,recovery', 'full', 'pilot3'), getExpected(OFFER_PRICE * 4, 3, 'full'), 'lowercase PILOT3');
    assertAmount(calculateAmount('lead-gen,instant-booking', 'full', 'founder4'), 0, 'lowercase FOUNDER4');
  });

  test('mixed case promo codes work', () => {
    assertAmount(calculateAmount('lead-gen,instant-booking,followup', 'full', 'Pilot1'), getExpected(OFFER_PRICE * 3, 1, 'full'), 'mixed case PILOT1');
  });
});

suite('computeAllValidAmounts', () => {
  const amounts = computeAllValidAmounts();

  test('includes all full/no-promo amounts', () => {
    for (let i = 1; i <= 4; i++) {
      const subtotal = OFFER_PRICE * i;
      const expected = getExpected(subtotal, 0, 'full');
      assert(amounts.has(expected), `Should contain ${expected} (${i} offers full, no promo)`);
    }
  });

  test('includes all split/no-promo amounts', () => {
    for (let i = 1; i <= 4; i++) {
      const subtotal = OFFER_PRICE * i;
      const expected = getExpected(subtotal, 0, 'split');
      assert(amounts.has(expected), `Should contain ${expected} (${i} offers split, no promo)`);
    }
  });

  test('includes zero amount', () => {
    assert(amounts.has(0), 'Should contain 0 (free invoice)');
  });

  test('includes retainer amounts', () => {
    assert(amounts.has(30000), 'Should contain 30000');
    assert(amounts.has(Math.round(30000 * 1.18)), `Should contain ${Math.round(30000 * 1.18)}`);
  });

  test('includes test amounts 1-12', () => {
    for (let i = 1; i <= 12; i++) {
      assert(amounts.has(i), `Should contain ${i}`);
    }
  });

  test('includes all promo full amounts', () => {
    for (let i = 1; i <= 4; i++) {
      for (let free = 0; free <= 4; free++) {
        if (free >= i) {
          assert(amounts.has(0), `Should contain 0 (${i} offers, ${free} free)`);
          continue;
        }
        const subtotal = OFFER_PRICE * i;
        const expected = getExpected(subtotal, free, 'full');
        assert(amounts.has(expected), `Should contain ${expected} (${i} offers, ${free} free, full)`);
      }
    }
  });

  test('includes all promo split amounts', () => {
    for (let i = 1; i <= 4; i++) {
      for (let free = 0; free <= 4; free++) {
        if (free >= i) {
          assert(amounts.has(0), `Should contain 0 (${i} offers, ${free} free)`);
          continue;
        }
        const subtotal = OFFER_PRICE * i;
        const expected = getExpected(subtotal, free, 'split');
        assert(amounts.has(expected), `Should contain ${expected} (${i} offers, ${free} free, split)`);
      }
    }
  });
});

suite('validateGSTIN', () => {
  test('valid GSTIN', () => {
    assert.strictEqual(validateGSTIN('06ABCDE1234F1Z5'), true);
  });

  test('empty GSTIN is valid (optional field)', () => {
    assert.strictEqual(validateGSTIN(''), true);
    assert.strictEqual(validateGSTIN(null), true);
    assert.strictEqual(validateGSTIN(undefined), true);
  });

  test('invalid GSTIN format', () => {
    assert.strictEqual(validateGSTIN('invalid'), false);
    assert.strictEqual(validateGSTIN('06ABCDE1234F1Z'), false);
    assert.strictEqual(validateGSTIN('123456789012345'), false);
    assert.strictEqual(validateGSTIN('ABCDE1234F1Z5'), false);
    assert.strictEqual(validateGSTIN('0600CDE1234F1Z5'), false);
  });
});

suite('getStateCode', () => {
  test('extracts state code from GSTIN', () => {
    assert.strictEqual(getStateCode('06ABCDE1234F1Z5'), '06');
    assert.strictEqual(getStateCode('27ABCDE1234F1Z5'), '27');
  });

  test('returns null for no GSTIN', () => {
    assert.strictEqual(getStateCode(null), null);
    assert.strictEqual(getStateCode(''), null);
  });
});

suite('isInterState', () => {
  test('Haryana (06) is intra-state', () => {
    assert.strictEqual(isInterState('06ABCDE1234F1Z5'), false);
  });

  test('Maharashtra (27) is inter-state', () => {
    assert.strictEqual(isInterState('27ABCDE1234F1Z5'), true);
  });
});

suite('getPlaceOfSupply', () => {
  test('returns customer state code when GSTIN provided', () => {
    assert.strictEqual(getPlaceOfSupply('06ABCDE1234F1Z5'), '06');
    assert.strictEqual(getPlaceOfSupply('27ABCDE1234F1Z5'), '27');
  });

  test('returns supplier state code when no GSTIN', () => {
    assert.strictEqual(getPlaceOfSupply(null), '06');
    assert.strictEqual(getPlaceOfSupply(''), '06');
  });
});

suite('OFFERS data integrity', () => {
  test('all offers have valid prices', () => {
    Object.values(OFFERS).forEach(price => {
      assert.strictEqual(typeof price, 'number', `Price ${price} should be a number`);
      assert(price > 0 || price === 1, `Price ${price} should be positive`);
    });
  });

  test('test-payment is exactly 1', () => {
    assert.strictEqual(OFFERS['test-payment'], 1);
  });
});

suite('PROMO_CODES integrity', () => {
  test('all promo codes have valid free counts', () => {
    Object.values(PROMO_CODES).forEach(count => {
      assert.strictEqual(typeof count, 'number');
      assert(count >= 1 && count <= 4);
    });
  });
});

suite('Edge cases', () => {
  test('test-payment with promo code', () => {
    assertAmount(calculateAmount('test-payment', 'full', 'PILOT1'), 0, 'test-payment PILOT1');
    assertAmount(calculateAmount('test-payment', 'full', 'FOUNDER4'), 0, 'test-payment FOUNDER4');
  });

  test('unknown promo code treated as no promo', () => {
    const without = calculateAmount('lead-gen', 'full', '');
    const withUnknown = calculateAmount('lead-gen', 'full', 'FAKE123');
    assert.strictEqual(withUnknown, without, 'Unknown promo should return same as no promo');
  });

  test('split type edge: 50/50 of odd total rounds correctly', () => {
    const result = calculateAmount('lead-gen', 'split', '');
    assert.strictEqual(result, 14750, 'split 1 offer should be 14750');
  });
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  process.exit(1);
}
