import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { adminApi, adminKeys } from '../api';
import { InvoiceDocument, invoiceTitle } from '@/features/billing/InvoiceDocument';
import { Button, ErrorState, Skeleton } from '@/components/ui';
import { useDocumentTitle } from '@/lib/hooks';

export default function BillingInvoicePage() {
  const { number = '' } = useParams();
  const invoice = useQuery({ queryKey: adminKeys.invoice(number), queryFn: () => adminApi.invoice(number) });
  useDocumentTitle(invoice.data ? `${invoiceTitle(invoice.data.kind)} ${invoice.data.number}` : 'Invoice');

  return (
    <div className="mx-auto max-w-4xl">
      <div className="print-hide mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/admin/billing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> Billing
        </Link>
        {invoice.data && (
          <div className="flex gap-2">
            <Link to={`/admin/bookings/${encodeURIComponent(invoice.data.bookingReference)}`} className="inline-flex h-10 items-center px-3 text-sm font-semibold text-muted hover:text-fg">
              View booking
            </Link>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden /> Print
            </Button>
          </div>
        )}
      </div>
      {invoice.isPending ? (
        <Skeleton className="h-[640px]" />
      ) : invoice.error ? (
        <ErrorState error={invoice.error} onRetry={() => invoice.refetch()} />
      ) : (
        <InvoiceDocument invoice={invoice.data} />
      )}
    </div>
  );
}
