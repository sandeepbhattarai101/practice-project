import type { Invoice, ProviderCode } from '@/types/api';
import { formatDate } from '@/lib/dates';
import { formatBasisPoints, formatMoney } from '@/lib/money';
import { cn } from '@/lib/cn';

const providerNames: Record<ProviderCode, string> = { ESEWA: 'eSewa', KHALTI: 'Khalti', DEV_SANDBOX: 'Development sandbox' };

export function invoiceTitle(kind: Invoice['kind']): string {
  return kind === 'CREDIT_NOTE' ? 'Credit note' : 'Tax invoice';
}

/**
 * A printable tax invoice or credit note. Rendered as a light "paper" sheet on screen;
 * `.print-area` makes it the only thing printed.
 */
export function InvoiceDocument({ invoice, className }: { invoice: Invoice; className?: string }) {
  const credit = invoice.kind === 'CREDIT_NOTE';
  const money = (minor: number) => formatMoney(minor);
  return (
    <article
      className={cn('print-area rounded-md bg-[#fbf9f5] p-6 text-[#1b1a17] shadow-pop sm:p-10', className)}
      aria-labelledby={`invoice-${invoice.number}`}
    >
      <header className="flex flex-col gap-6 border-b border-[#d9d4ca] pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-display text-2xl font-semibold">{invoice.seller.name}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-[#55524b]">{invoice.seller.address}</p>
          {invoice.seller.taxId && <p className="mt-1 text-sm text-[#55524b]">PAN / VAT no. {invoice.seller.taxId}</p>}
        </div>
        <div className="sm:text-right">
          <h1 id={`invoice-${invoice.number}`} className="font-display text-3xl font-semibold uppercase tracking-wide">
            {invoiceTitle(invoice.kind)}
          </h1>
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-0.5 text-sm sm:justify-end">
            <dt className="text-[#55524b]">Number</dt>
            <dd className="font-mono font-semibold">{invoice.number}</dd>
            <dt className="text-[#55524b]">Issue date</dt>
            <dd>{formatDate(invoice.issuedAt, invoice.timezone)}</dd>
            <dt className="text-[#55524b]">Fiscal year</dt>
            <dd>{invoice.fiscalYear}</dd>
            <dt className="text-[#55524b]">Booking</dt>
            <dd className="font-mono">{invoice.bookingReference}</dd>
          </dl>
        </div>
      </header>

      {credit && invoice.originalInvoiceNumber && (
        <p className="mt-5 rounded-sm border border-[#d9d4ca] bg-[#f1ede4] px-3 py-2 text-sm">
          Credit note for invoice <span className="font-mono font-semibold">{invoice.originalInvoiceNumber}</span>
        </p>
      )}

      <section className="mt-6" aria-label="Customer">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#77736a]">{credit ? 'Credited to' : 'Billed to'}</p>
        <p className="mt-1 font-semibold">{invoice.customer.name}</p>
        {invoice.customer.email && <p className="text-sm text-[#55524b]">{invoice.customer.email}</p>}
        {invoice.customer.phone && <p className="text-sm text-[#55524b]">{invoice.customer.phone}</p>}
      </section>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <caption className="sr-only">Line items</caption>
          <thead>
            <tr className="border-b-2 border-[#1b1a17] text-left">
              <th scope="col" className="py-2 pr-3 font-semibold">Description</th>
              <th scope="col" className="w-16 px-3 py-2 text-right font-semibold">Qty</th>
              <th scope="col" className="w-28 px-3 py-2 text-right font-semibold">Unit price</th>
              <th scope="col" className="w-28 py-2 pl-3 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-b border-[#e4dfd5]">
                <td className="py-2 pr-3">{l.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.unitPriceMinor)}</td>
                <td className="py-2 pl-3 text-right tabular-nums">{money(l.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto mt-4 w-full max-w-xs space-y-1.5 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-[#55524b]">Subtotal</dt><dd className="tabular-nums">{money(invoice.subtotalMinor)}</dd></div>
        {invoice.discountMinor !== 0 && (
          <div className="flex justify-between gap-4"><dt className="text-[#55524b]">Discount</dt><dd className="tabular-nums">−{money(invoice.discountMinor)}</dd></div>
        )}
        <div className="flex justify-between gap-4"><dt className="text-[#55524b]">Service fee</dt><dd className="tabular-nums">{money(invoice.feeMinor)}</dd></div>
        <div className="flex justify-between gap-4">
          <dt className="text-[#55524b]">{invoice.taxLabel} @ {formatBasisPoints(invoice.taxRateBasisPoints)}</dt>
          <dd className="tabular-nums">{money(invoice.taxMinor)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t-2 border-[#1b1a17] pt-2 text-base font-semibold">
          <dt>{credit ? 'Total credited' : 'Total'} ({invoice.currency})</dt>
          <dd className="tabular-nums">{money(invoice.totalMinor)}</dd>
        </div>
      </dl>

      {invoice.payment && (
        <p className="mt-6 text-sm text-[#55524b]">
          {credit ? 'Refunded via' : 'Paid via'} {providerNames[invoice.payment.provider] ?? invoice.payment.provider}
          {invoice.payment.providerTxnId && (
            <>
              {' '}· reference <span className="font-mono">{invoice.payment.providerTxnId}</span>
            </>
          )}
        </p>
      )}

      <footer className="mt-10 border-t border-[#d9d4ca] pt-4 text-center text-[11px] text-[#77736a]">
        Generated by a practice project, not a legal tax document.
      </footer>
    </article>
  );
}
