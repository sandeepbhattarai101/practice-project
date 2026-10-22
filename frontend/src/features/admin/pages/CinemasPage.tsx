import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { ChevronRight, Plus } from 'lucide-react';
import { ButtonLink, DataTable, Field, Img, Input, Select, type Column } from '@/components/ui';
import { useDocumentTitle } from '@/lib/hooks';
import type { AdminCinema } from '@/types/api';
import { adminApi, adminKeys } from '../api';
import { AdminPageHeader, FilterBar, StatusPill } from '../components/AdminUi';

export default function CinemasPage() {
  useDocumentTitle('Cinemas');
  const navigate = useNavigate();
  const cinemas = useQuery({ queryKey: adminKeys.cinemas(), queryFn: adminApi.cinemas });
  const cities = useQuery({ queryKey: adminKeys.cities(), queryFn: adminApi.cities });
  const [q, setQ] = useState('');
  const [cityId, setCityId] = useState('');

  const cityName = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of cities.data ?? []) map.set(c.id, c.name);
    return (id: number) => map.get(id) ?? (cities.isPending ? '…' : '—');
  }, [cities.data, cities.isPending]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (cinemas.data ?? []).filter((c) => {
      if (cityId !== '' && String(c.cityId) !== cityId) return false;
      if (!needle) return true;
      return [c.name, c.slug, c.address, cityName(c.cityId)].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [cinemas.data, q, cityId, cityName]);

  const columns: Column<AdminCinema>[] = [
    {
      key: 'image',
      header: <span className="sr-only">Photo</span>,
      className: 'w-20',
      cell: (c) => <Img src={c.imageUrl} alt="" ratio="backdrop" className="w-16 rounded-xs" />,
    },
    {
      key: 'name',
      header: 'Cinema',
      cell: (c) => (
        <div className="min-w-0">
          <Link to={`/admin/cinemas/${c.id}`} className="font-semibold text-fg hover:text-accent" onClick={(e) => e.stopPropagation()}>
            {c.name}
          </Link>
          <p className="truncate text-xs text-subtle">{c.address}</p>
        </div>
      ),
    },
    { key: 'city', header: 'City', cell: (c) => <span className="text-muted">{cityName(c.cityId)}</span> },
    { key: 'status', header: 'Status', cell: (c) => <StatusPill status={c.status} /> },
    { key: 'auditoriums', header: 'Screens', align: 'right', cell: (c) => <span className="tabular-nums">{c.auditoriumCount}</span> },
    {
      key: 'go',
      header: <span className="sr-only">Open</span>,
      align: 'right',
      className: 'w-8',
      cell: () => <ChevronRight className="ml-auto size-4 text-subtle" aria-hidden />,
    },
  ];

  const filtered = q.trim() !== '' || cityId !== '';

  return (
    <div>
      <AdminPageHeader
        eyebrow="Catalogue"
        title="Cinemas"
        description="Venues, their screens and seat layouts."
        actions={
          <ButtonLink to="/admin/cinemas/new">
            <Plus className="size-4" aria-hidden /> New cinema
          </ButtonLink>
        }
      />
      <FilterBar>
        <Field label="Search">
          {({ id }) => <Input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, address or city" />}
        </Field>
        <Field label="City">
          {({ id }) => (
            <Select id={id} value={cityId} onChange={(e) => setCityId(e.target.value)} disabled={!cities.data}>
              <option value="">All cities</option>
              {cities.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FilterBar>
      <DataTable
        caption="Cinemas"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        isLoading={cinemas.isPending}
        error={cinemas.isError ? cinemas.error : undefined}
        onRetry={() => cinemas.refetch()}
        onRowClick={(c) => navigate(`/admin/cinemas/${c.id}`)}
        emptyTitle={filtered ? 'No cinemas match' : 'No cinemas yet'}
        emptyDescription={filtered ? 'Try a different search or city.' : 'Add your first cinema, then its screens and seat layouts.'}
      />
      {cinemas.data && (
        <p className="mt-3 text-xs text-subtle" aria-live="polite">
          Showing {rows.length} of {cinemas.data.length} {cinemas.data.length === 1 ? 'cinema' : 'cinemas'}
        </p>
      )}
    </div>
  );
}
