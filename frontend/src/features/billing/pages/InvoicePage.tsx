import { Link, useParams } from 'react-router';
import { ArrowLeft, FileX, Printer } from 'lucide-react';
import { useBookingInvoices } from '@/features/booking/api';
import { LookupForm } from '@/features/booking/components/LookupForm';
import { ApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, ButtonLink, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { InvoiceDocument, invoiceTitle } from '../InvoiceDocument';

export default function InvoicePage() {
  const { reference = '', number = '' } = useParams();
  const invoices = useBookingInvoices(reference);
  const invoice = invoices.data?.find((i) => i.number === number);
  useDocumentTitle(invoice ? `${invoiceTitle(invoice.kind)} ${invoice.number}` : 'Invoice');

  let body: React.ReactNode;
  if (invoices.isPending) {
    body = <Skeleton className="h-[640px] rounded-md" />;
  } else if (invoices.error) {
    const e = invoices.error;
    body =
      e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404) ? (
        <div className="mx-auto max-w-md">
          <h1 className="font-display text-3xl text-fg">Find your booking</h1>
          <p className="mt-2 text-muted">Confirm the email address you booked with to view this document.</p>
          <div className="mt-6 rounded-lg border border-line bg-surface p-6"><LookupForm defaultReference={reference} /></div>
        </div>
      ) : (
        <ErrorState error={e} onRetry={() => invoices.refetch()} />
      );
  } else if (!invoice) {
    body = (
      <EmptyState
        icon={<FileX className="size-5" />}
        title="Document not found"
        description={`There is no invoice or credit note ${number} on booking ${reference}.`}
        action={<ButtonLink to={`/bookings/${reference}`} variant="secondary" size="sm">Back to booking</ButtonLink>}
      />
    );
  } else {
    body = <InvoiceDocument invoice={invoice} />;
  }

  return (
    <main id="main" className="container-page max-w-4xl py-10">
      <div className="print-hide mb-6 flex items-center justify-between gap-3">
        <Link to={`/bookings/${reference}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> Booking {reference}
        </Link>
        {invoice && (
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Print / Save as PDF
          </Button>
        )}
      </div>
      {body}
    </main>
  );
}
