import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Search } from 'lucide-react';
import { Badge, Button, Checkbox, DataTable, Dialog, Field, FormError, Input, Pagination, Select, toast, useConfirm, type Column } from '@/components/ui';
import { adminApi, adminKeys, useAdminLookups } from '@/features/admin/api';
import { AdminPageHeader, FilterBar, StatusPill } from '@/features/admin/components/AdminUi';
import { useDebouncedFilter, useUrlFilters } from '@/features/admin/ops/useUrlFilters';
import { useCurrentUser } from '@/features/auth/api';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { DEFAULT_TIMEZONE, formatDate } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import type { AdminLookups, AdminUser, Role } from '@/types/api';

const PAGE_SIZE = 25;
const DEFAULTS = { q: '', role: '' };
const ROLES: { value: Role; label: string }[] = [
  { value: 'CUSTOMER', label: 'Customer' },
  { value: 'CINEMA_MANAGER', label: 'Cinema manager' },
  { value: 'ADMIN', label: 'Administrator' },
];
/** The contract does not enumerate account statuses; these are offered, and any other current value is kept. */
const STATUSES = ['ACTIVE', 'DISABLED'];

const roleLabel = (role: string) => ROLES.find((r) => r.value === role)?.label ?? role;

export default function UsersPage() {
  useDocumentTitle('Customers');
  const { values, setFilters, page, setPage } = useUrlFilters(DEFAULTS);
  const [q, setQ] = useDebouncedFilter(values.q, (v) => setFilters({ q: v }));
  const lookups = useAdminLookups();
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const params = { q: values.q.trim(), role: values.role, page, size: PAGE_SIZE };
  const query = useQuery({ queryKey: adminKeys.users(params), queryFn: () => adminApi.users(params), placeholderData: keepPreviousData });

  const cinemaNames = (ids: number[]) =>
    ids.map((id) => lookups.data?.cinemas.find((c) => c.id === id)?.name ?? `Cinema #${id}`).join(', ');

  const columns: Column<AdminUser>[] = [
    {
      key: 'user',
      header: 'Name',
      cell: (u) => (
        <div className="min-w-0">
          <div className="font-medium text-fg">{u.fullName}</div>
          <div className="flex items-center gap-1 text-xs text-subtle">
            {u.email}
            {u.emailVerified && <CheckCircle2 className="size-3 text-success" aria-label="Email verified" />}
          </div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', cell: (u) => <span className="text-muted">{u.phone ?? '—'}</span> },
    {
      key: 'role',
      header: 'Role',
      cell: (u) => (
        <div>
          <Badge tone={u.role === 'ADMIN' ? 'accent' : u.role === 'CINEMA_MANAGER' ? 'info' : 'neutral'}>{roleLabel(u.role)}</Badge>
          {u.role === 'CINEMA_MANAGER' && (
            <div className="mt-1 max-w-[220px] truncate text-xs text-subtle" title={cinemaNames(u.managedCinemaIds)}>
              {u.managedCinemaIds.length ? cinemaNames(u.managedCinemaIds) : 'No cinemas assigned'}
            </div>
          )}
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (u) => <StatusPill status={u.status} /> },
    { key: 'bookings', header: 'Bookings', align: 'right', cell: (u) => <span className="tabular-nums">{u.bookingCount}</span> },
    { key: 'joined', header: 'Joined', cell: (u) => <span className="whitespace-nowrap text-xs tabular-nums text-muted">{formatDate(u.createdAt, DEFAULT_TIMEZONE)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (u) => (
        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(u)} aria-label={`Edit ${u.fullName}`}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ),
    },
  ];

  const data = query.data;

  return (
    <>
      <AdminPageHeader title="Customers and staff" description="Search accounts, change roles and assign cinemas to managers." />
      <FilterBar>
        <Field label="Search">
          {({ id }) => (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <Input id={id} type="search" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or phone" />
            </div>
          )}
        </Field>
        <Field label="Role">
          {({ id }) => (
            <Select id={id} value={values.role} onChange={(e) => setFilters({ role: e.target.value })}>
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FilterBar>
      <DataTable
        caption="User accounts"
        columns={columns}
        rows={data?.items}
        rowKey={(u) => u.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        emptyTitle="No accounts found"
        emptyDescription="Try a different search or role."
        className={cn(query.isPlaceholderData && 'opacity-70 transition-opacity duration-200')}
      />
      {data && <Pagination className="mt-4" page={data.page} totalPages={data.totalPages} totalItems={data.totalItems} onChange={setPage} />}
      {editing && <EditUserDialog key={editing.id} user={editing} lookups={lookups.data} onClose={() => setEditing(null)} />}
    </>
  );
}

function EditUserDialog({ user, lookups, onClose }: { user: AdminUser; lookups: AdminLookups | undefined; onClose: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const me = useCurrentUser();
  const [role, setRole] = useState<Role>(user.role);
  const [status, setStatus] = useState(user.status);
  const [cinemaIds, setCinemaIds] = useState<number[]>(user.managedCinemaIds);

  const statusOptions = STATUSES.includes(user.status) || !user.status ? STATUSES : [user.status, ...STATUSES];
  const isSelf = me?.id === user.id;

  const save = useMutation({
    mutationFn: () => adminApi.updateUser(user.id, { role, status, managedCinemaIds: role === 'CINEMA_MANAGER' ? cinemaIds : [] }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'users'] });
      toast.success(`${user.fullName} updated`);
      onClose();
    },
  });

  const fieldError = (name: string) => (save.error instanceof ApiError ? save.error.fieldError(name) : undefined);

  const toggleCinema = (id: number, checked: boolean) =>
    setCinemaIds((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  const submit = async () => {
    if (role !== user.role) {
      const ok = await confirm({
        title: `Change ${user.fullName}’s role?`,
        description: (
          <>
            From <strong className="text-fg">{roleLabel(user.role)}</strong> to <strong className="text-fg">{roleLabel(role)}</strong>.{' '}
            {role === 'ADMIN'
              ? 'Administrators have full access to every cinema, payment and setting.'
              : role === 'CINEMA_MANAGER'
                ? 'Managers can schedule shows, see bookings and check guests in at their assigned cinemas.'
                : 'They will lose access to the admin area.'}
            {isSelf && ' You are changing your own account.'}
          </>
        ),
        confirmLabel: 'Change role',
        tone: role === 'ADMIN' || isSelf ? 'danger' : 'default',
      });
      if (!ok) return;
    }
    save.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title={`Edit ${user.fullName}`}
      description={user.email}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Role" required error={fieldError('role')}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-describedby={describedBy} aria-invalid={invalid}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status" required error={fieldError('status')}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid}>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {role === 'CINEMA_MANAGER' && (
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-muted">Managed cinemas</legend>
            {lookups && lookups.cinemas.length > 0 ? (
              <div className="grid max-h-60 grid-cols-1 gap-2 overflow-y-auto rounded-md border border-line p-3 sm:grid-cols-2">
                {lookups.cinemas.map((c) => (
                  <Checkbox key={c.id} label={c.name} checked={cinemaIds.includes(c.id)} onChange={(e) => toggleCinema(c.id, e.target.checked)} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-subtle">{lookups ? 'There are no cinemas yet.' : 'Loading cinemas…'}</p>
            )}
            {(fieldError('managedCinemaIds') || cinemaIds.length === 0) && (
              <p className={cn('mt-1.5 text-xs', fieldError('managedCinemaIds') ? 'font-medium text-danger' : 'text-warning')}>
                {fieldError('managedCinemaIds') ?? 'A manager with no cinemas cannot see any shows or bookings.'}
              </p>
            )}
          </fieldset>
        )}
      </form>
    </Dialog>
  );
}
