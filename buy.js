const { privateKeyToAccount } = require('viem/accounts');
const KEY = require('fs').readFileSync('buyer.txt','utf8').match(/KEY=(0x[0-9a-f]+)/)[1];
const URL = 'https://x402-lane-144561044326.us-central1.run.app/sleepfix';
(async () => {
  const { wrapFetchWithPayment, decodeXPaymentResponse } = await import('x402-fetch');
  const pay = wrapFetchWithPayment(fetch, privateKeyToAccount(KEY), BigInt(1000000));
  const r = await pay(URL, { method: 'GET' });
  console.log('status', r.status);
  console.log(await r.text());
  const h = r.headers.get('x-payment-response');
  if (h) console.log('settle', JSON.stringify(decodeXPaymentResponse(h)));
})();
