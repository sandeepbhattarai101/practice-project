import type { PaymentRedirect } from '@/types/api';

/** Sends the browser to the payment gateway as instructed by POST /payments. */
export function followPaymentRedirect(redirect: PaymentRedirect['redirect'], doc: Document = document): void {
  if (redirect.method === 'GET') {
    doc.defaultView?.location.assign(redirect.url);
    return;
  }
  const form = doc.createElement('form');
  form.method = 'POST';
  form.action = redirect.url;
  form.style.display = 'none';
  for (const [name, value] of Object.entries(redirect.fields ?? {})) {
    const input = doc.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  doc.body.appendChild(form);
  form.submit();
}
