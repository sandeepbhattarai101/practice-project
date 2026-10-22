import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Grid3x3, MapPin, Pencil, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  ButtonLink,
  DataTable,
  EmptyState,
  ErrorState,
  Img,
  LoadingRegion,
  Skeleton,
  type Column,
} from '@/components/ui';
import { isApiErrorCode } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import type { AdminAuditorium } from '@/types/api';
import { adminApi, adminKeys } from '../api';
import { AdminPageHeader, DetailList, Panel, StatusPill } from '../components/AdminUi';
import { AuditoriumDialog } from './cinemas/AuditoriumDialog';

export default function CinemaDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const cinema = useQuery({ queryKey: adminKeys.cinema(id), queryFn: () => adminApi.cinema(id), enabled: validId });
  const cities = useQuery({ queryKey: adminKeys.cities(), queryFn: adminApi.cities });
  const [dialog, setDialog] = useState<{ auditorium: AdminAuditorium | null } | null>(null);
  useDocumentTitle(cinema.data?.name ?? 'Cinema');

  const back = (
    <Link to="/admin/cinemas" className="inline-flex items-center gap-1 hover:text-fg">
      <ArrowLeft className="size-3" aria-hidden /> Cinemas
    </Link>
  );

  if (!validId) {
    return (
      <div>
        <AdminPageHeader eyebrow={back} title="Cinema not found" />
        <EmptyState title="That is not a valid cinema" action={<ButtonLink to="/admin/cinemas">All cinemas</ButtonLink>} />
      </div>
    );
  }

  if (cinema.isPending) {
    return (
      <div>
        <AdminPageHeader eyebrow={back} title="Cinema" />
        <LoadingRegion label="Loading cinema" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-[300px] rounded-lg" />
          <Skeleton className="h-[300px] rounded-lg" />
        </LoadingRegion>
      </div>
    );
  }

  if (cinema.isError) {
    const missing = isApiErrorCode(cinema.error, 'NOT_FOUND');
    return (
      <div>
        <AdminPageHeader eyebrow={back} title="Cinema" />
        <ErrorState
          error={cinema.error}
          title={missing ? 'This cinema no longer exists' : 'We could not load this cinema'}
          onRetry={missing ? undefined : () => cinema.refetch()}
          retrying={cinema.isFetching}
        />
      </div>
    );
  }

  const c = cinema.data;
  const cityName = cities.data?.find((x) => x.id === c.cityId)?.name ?? '—';
  const hasGrid = c.auditoriums.some((a) => a.gridRows !== undefined && a.gridCols !== undefined);
  const hasSeatCount = c.auditoriums.some((a) => a.seatCount !== undefined);

  const columns: Column<AdminAuditorium>[] = [
    { key: 'name', header: 'Screen', cell: (a) => <span className="font-semibold">{a.name}</span> },
    {
      key: 'formats',
      header: 'Formats',
      cell: (a) =>
        a.formats.length === 0 ? (
          <span className="text-subtle">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {a.formats.map((f) => (
              <Badge key={f} tone="outline">
                {f}
              </Badge>
            ))}
          </span>
        ),
    },
    ...(hasSeatCount
      ? [{ key: 'seats', header: 'Seats', align: 'right' as const, cell: (a: AdminAuditorium) => <span className="tabular-nums">{a.seatCount ?? '—'}</span> }]
      : []),
    ...(hasGrid
      ? [
          {
            key: 'grid',
            header: 'Grid',
            cell: (a: AdminAuditorium) => (
              <span className="tabular-nums text-muted">{a.gridRows !== undefined && a.gridCols !== undefined ? `${a.gridRows} × ${a.gridCols}` : '—'}</span>
            ),
          },
        ]
      : []),
    {
      key: 'active',
      header: 'Status',
      cell: (a) => (a.isActive === undefined ? <span className="text-subtle">—</span> : <StatusPill status={a.isActive ? 'ACTIVE' : 'INACTIVE'} />),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (a) => (
        <div className="flex justify-end gap-1">
          <ButtonLink to={`/admin/auditoriums/${a.id}/layout`} variant="secondary" size="sm" aria-label={`Edit seat layout for ${a.name}`}>
            <Grid3x3 className="size-3.5" aria-hidden /> Seat layout
          </ButtonLink>
          <Button variant="ghost" size="sm" onClick={() => setDialog({ auditorium: a })} leftIcon={<Pencil className="size-3.5" aria-hidden />} aria-label={`Edit ${a.name}`}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        eyebrow={back}
        title={c.name}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusPill status={c.status} /> {cityName}
          </span>
        }
        actions={
          <ButtonLink to={`/admin/cinemas/${c.id}/edit`} variant="secondary">
            <Pencil className="size-4" aria-hidden /> Edit cinema
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={`Screens (${c.auditoriums.length})`}
            actions={
              <Button size="sm" onClick={() => setDialog({ auditorium: null })} leftIcon={<Plus className="size-3.5" aria-hidden />}>
                Add screen
              </Button>
            }
          >
            {c.auditoriums.length === 0 ? (
              <EmptyState
                title="No screens yet"
                description="Add a screen, then lay out its seats before scheduling showtimes."
                icon={<Grid3x3 className="size-5" />}
                className="border-0 py-10"
              />
            ) : (
              <DataTable caption={`Screens at ${c.name}`} columns={columns} rows={c.auditoriums} rowKey={(a) => a.id} className="-m-4 rounded-none border-0" />
            )}
          </Panel>
          <Panel title="Details">
            <DetailList
              items={[
                { label: 'City', value: cityName },
                { label: 'Slug', value: <code className="text-xs">{c.slug}</code> },
                { label: 'Address', value: c.address || '—' },
                { label: 'Phone', value: c.phone || '—' },
                {
                  label: 'Coordinates',
                  value:
                    c.latitude !== null && c.longitude !== null ? (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <MapPin className="size-3.5 text-subtle" aria-hidden /> {c.latitude}, {c.longitude}
                      </span>
                    ) : (
                      '—'
                    ),
                },
                {
                  label: 'Facilities',
                  value:
                    c.facilities.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {c.facilities.map((f) => (
                          <Badge key={f}>{f}</Badge>
                        ))}
                      </span>
                    ) : (
                      '—'
                    ),
                },
              ]}
            />
            {c.description && <p className="mt-4 whitespace-pre-line text-sm text-muted">{c.description}</p>}
          </Panel>
        </div>
        <div>
          <Img src={c.imageUrl} alt={`${c.name}`} ratio="backdrop" className="rounded-lg border border-line" />
        </div>
      </div>
      {dialog && <AuditoriumDialog key={dialog.auditorium?.id ?? 'new'} cinemaId={c.id} auditorium={dialog.auditorium} onClose={() => setDialog(null)} />}
    </div>
  );
}
