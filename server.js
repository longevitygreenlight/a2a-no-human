const express = require('express');
const { privateKeyToAccount } = require('viem/accounts');
const app = express();
const SELLER = 'https://x402-lane-144561044326.us-central1.run.app/sleepfix';
const PROJECT = 'project-3f842cb3-b2cc-4606-980';
const MODEL = 'gemini-2.5-flash';
const MAX_SPEND = parseFloat(process.env.MAX_SPEND_USD || '1');
app.use(express.json());
app.use(express.static('public'));
app.get('/health', (q, r) => r.json({ ok: true, agent: 'agentbuyer' }));

async function token() {
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  return (await r.json()).access_token;
}

async function judge(want, offer) {
  const prompt = 'A shopper asked for: "' + want + '". A seller offers: "' + offer + '". Does the offer answer what the shopper asked for? Reply with one word: YES or NO.';
  const url = 'https://us-central1-aiplatform.googleapis.com/v1/projects/' + PROJECT + '/locations/us-central1/publishers/google/models/' + MODEL + ':generateContent';
  const res = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 20, thinkingConfig: { thinkingBudget: 0 } } }) });
  const j = await res.json();
  const out = (j.candidates && j.candidates[0] && j.candidates[0].content.parts[0].text || '').trim().toUpperCase();
  return out.startsWith('YES');
}

app.post('/buy', async (q, r) => {
  try {
    if (process.env.BUY_PASS && (q.body.pass || '') !== process.env.BUY_PASS) return r.status(401).json({ error: 'password incorrect - your agent was not sent' });
    const want = (q.body.want || '').toString().slice(0, 200);
    if (!want) return r.json({ error: 'tell me what to buy' });
    const capUsd = Math.min(parseFloat(q.body.cap || '1') || 0, MAX_SPEND);
    if (!(capUsd > 0)) return r.json({ error: 'set a spend cap' });

    // Optional - the buyer can ask for the licence by email.
    const email = (q.body.email || '').toString().trim().slice(0, 254);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return r.json({ error: 'that email address does not look right' });
    }

    const probe = await fetch(SELLER, { method: 'GET' });
    if (probe.status !== 402) return r.json({ error: 'seller did not quote a price' });
    const quote = (await probe.json()).accepts[0];
    const priceUsd = Number(quote.maxAmountRequired) / 1e6;

    if (!(await judge(want, quote.description))) return r.json({ refused: true, want: want, offer: quote.description, reason: 'no seller matched your request - nothing was paid' });
    if (priceUsd > capUsd) return r.json({ refused: true, reason: 'price ' + priceUsd + ' is over your cap ' + capUsd + ' - nothing was paid' });

    const { wrapFetchWithPayment } = await import('x402-fetch');
    const acct = privateKeyToAccount(process.env.BUYER_KEY);
    // Belt and braces: the header can be dropped on the 402 retry, the query
    // string cannot.
    const target = email ? SELLER + '?email=' + encodeURIComponent(email) : SELLER;
    const headers = email ? { 'X-Buyer-Email': email } : {};
    const res = await wrapFetchWithPayment(fetch, acct, BigInt(Math.round(capUsd * 1e6)))(target, { method: 'GET', headers: headers });
    const body = await res.json();
    if (email) body.emailed_to = email;
    r.json(body);
  } catch (e) {
    console.error('buy failed', e.message);
    r.status(200).json({ error: e.message });
  }
});
app.listen(process.env.PORT || 8080);
