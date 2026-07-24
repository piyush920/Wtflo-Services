const BREVO_API = 'https://api.brevo.com/v3';

function getApiKey() {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    console.error('Missing BREVO_API_KEY environment variable');
    return null;
  }
  return key;
}

async function syncContact({ email, name, phone, offers, amount }) {
  const apiKey = getApiKey();
  if (!apiKey) return;

  try {
    const body = {
      email,
      attributes: {
        NOME: name,
        SMS: phone,
        OFFERS: offers || '',
        AMOUNT: amount ? String(amount) : '',
        SOURCE: 'Wtflo Services'
      },
      listIds: [parseInt(process.env.BREVO_LIST_ID || '2', 10)],
      updateEnabled: true
    };

    const res = await fetch(`${BREVO_API}/contacts`, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Brevo API error (${res.status}):`, text.substring(0, 300));
    } else {
      console.log('Brevo contact synced:', email);
    }
  } catch (err) {
    console.error('Brevo API call failed:', err.message);
  }
}

async function sendInternalNotification({ subject, text }) {
  const apiKey = getApiKey();
  if (!apiKey) return;

  const to = process.env.TEAM_EMAIL || 'piyush@wtflo.com';
  if (!to) return;

  try {
    const body = {
      sender: { email: 'hello@wtflo.com', name: 'Wtflo' },
      to: [{ email: to }],
      subject,
      htmlContent: `<p>${text.replace(/\n/g, '<br>')}</p>`
    };

    const res = await fetch(`${BREVO_API}/smtp/email`, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Brevo send email error (${res.status}):`, text.substring(0, 300));
    } else {
      console.log('Internal notification sent to', to);
    }
  } catch (err) {
    console.error('Brevo sendInternalNotification failed:', err.message);
  }
}

module.exports = { syncContact, sendInternalNotification };
