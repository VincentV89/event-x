import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCollection } from '@cloudscape-design/collection-hooks';
import Alert from '@cloudscape-design/components/alert';
import BarChart from '@cloudscape-design/components/bar-chart';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Flashbar, { type FlashbarProps } from '@cloudscape-design/components/flashbar';
import Header from '@cloudscape-design/components/header';
import LineChart from '@cloudscape-design/components/line-chart';
import Modal from '@cloudscape-design/components/modal';
import Pagination from '@cloudscape-design/components/pagination';
import PieChart from '@cloudscape-design/components/pie-chart';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import { api, ApiError, formatDateRange, type EventSummary, type Registration } from '../lib/api';
import { currentUser, signIn, signOut } from '../lib/auth';

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200`}>
      <div className={`absolute inset-x-0 top-0 h-1 ${accent}`} />
      <Box variant="awsui-key-label">{label}</Box>
      <div className="mt-1 text-4xl font-extrabold tracking-tight text-slate-900">{value}</div>
      <Box variant="small" color="text-body-secondary">{sub}</Box>
    </div>
  );
}

function SignInGate({ message }: { message?: string }) {
  return (
    <div className="hero-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-10 w-10" />
          <div>
            <div className="text-xl font-bold">EventX Organizer Portal</div>
            <div className="text-sm text-slate-500">Restricted to authorized organizers</div>
          </div>
        </div>
        <SpaceBetween size="m">
          {message && <Alert type="warning">{message}</Alert>}
          <Button variant="primary" fullWidth onClick={() => signIn()}>Sign in with Amazon Cognito</Button>
          <Box textAlign="center" variant="small"><Link to="/">← Back to event page</Link></Box>
        </SpaceBetween>
      </div>
    </div>
  );
}

export default function OrganizerPage() {
  const user = currentUser();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState<string>();
  const [event, setEvent] = useState<EventSummary>();
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError>();
  const [status, setStatus] = useState<'ALL' | 'CONFIRMED' | 'CANCELLED'>('CONFIRMED');
  const [toCancel, setToCancel] = useState<Registration>();
  const [cancelling, setCancelling] = useState(false);
  const [flash, setFlash] = useState<FlashbarProps.MessageDefinition[]>([]);

  const load = useCallback(async (id?: string) => {
    setLoading(true);
    try {
      const evs = await api.adminEvents();
      setEvents(evs);
      const target = id ?? evs[0]?.eventId;
      if (target) {
        const res = await api.adminRegistrations(target);
        setEventId(target);
        setEvent(res.event);
        setRegistrations(res.registrations);
      }
      setError(undefined);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.isOrganizer) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (status === 'ALL' ? registrations : registrations.filter((r) => r.status === status)),
    [registrations, status],
  );

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(filtered, {
    filtering: {
      filteringFunction: (item, text) => {
        const q = text.trim().toLowerCase();
        return !q || [item.name, item.email, item.organization, item.confirmationId].some((v) => v.toLowerCase().includes(q));
      },
      empty: <Box textAlign="center" color="inherit">No registrations yet</Box>,
      noMatch: <Box textAlign="center" color="inherit">No attendees match the search</Box>,
    },
    sorting: { defaultState: { sortingColumn: { sortingField: 'createdAt' }, isDescending: true } },
    pagination: { pageSize: 15 },
  });

  const charts = useMemo(() => {
    const confirmed = registrations.filter((r) => r.status === 'CONFIRMED');
    // Cumulative confirmed registrations per day
    const perDay = new Map<string, number>();
    for (const r of confirmed) perDay.set(r.createdAt.slice(0, 10), (perDay.get(r.createdAt.slice(0, 10)) ?? 0) + 1);
    let running = 0;
    const cumulative = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => {
      running += n;
      return { x: new Date(`${d}T00:00:00Z`), y: running };
    });
    const byOrg = new Map<string, number>();
    for (const r of confirmed) byOrg.set(r.organization, (byOrg.get(r.organization) ?? 0) + 1);
    const topOrgs = [...byOrg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([x, y]) => ({ x, y }));
    return { cumulative, topOrgs };
  }, [registrations]);

  if (!user) return <SignInGate />;
  if (!user.isOrganizer) return <SignInGate message="Your account is not in the organizers group. Ask an administrator for access." />;
  if (error?.status === 401) return <SignInGate message={error.message} />;

  async function confirmCancel() {
    if (!toCancel || !eventId) return;
    setCancelling(true);
    try {
      const res = await api.cancel(eventId, toCancel.confirmationId);
      setEvent(res.event);
      setRegistrations((rs) => rs.map((r) => (r.confirmationId === toCancel.confirmationId ? { ...r, status: 'CANCELLED', cancelledAt: new Date().toISOString() } : r)));
      setFlash([{ type: 'success', id: 'c', dismissible: true, onDismiss: () => setFlash([]), content: `Registration ${toCancel.confirmationId} for ${toCancel.name} was cancelled and the seat released.` }]);
    } catch (e) {
      setFlash([{ type: 'error', id: 'c', dismissible: true, onDismiss: () => setFlash([]), content: (e as Error).message }]);
    } finally {
      setCancelling(false);
      setToCancel(undefined);
    }
  }

  const cancelledCount = registrations.filter((r) => r.status === 'CANCELLED').length;

  return (
    <>
      <div id="top-nav" style={{ position: 'sticky', top: 0, zIndex: 1002 }}>
        <TopNavigation
          identity={{ href: '/', title: 'EventX Organizer', logo: { src: '/favicon.svg', alt: 'EventX' } }}
          utilities={[
            { type: 'button', text: 'Public site', href: '/', external: false },
            {
              type: 'menu-dropdown', text: user.email, iconName: 'user-profile',
              items: [{ id: 'signout', text: 'Sign out' }],
              onItemClick: ({ detail }) => detail.id === 'signout' && signOut(),
            },
          ]}
        />
      </div>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <ContentLayout
          header={
            <Header
              variant="h1"
              description={event ? `${formatDateRange(event.startDate, event.endDate)} · ${event.venue}` : 'Loading event…'}
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  {events.length > 1 && (
                    <Select
                      selectedOption={{ value: eventId, label: event?.name }}
                      options={events.map((e) => ({ value: e.eventId, label: e.name }))}
                      onChange={({ detail }) => load(detail.selectedOption.value)}
                    />
                  )}
                  <Button iconName="refresh" loading={loading} onClick={() => load(eventId)}>Refresh</Button>
                </SpaceBetween>
              }
            >
              {event?.name ?? 'Organizer dashboard'}
            </Header>
          }
        >
          <SpaceBetween size="l">
            <Flashbar items={flash} />
            {error && <Alert type="error" header="Could not load dashboard">{error.message}</Alert>}
            {!event && loading ? (
              <Box textAlign="center" padding="xxl"><Spinner size="large" /></Box>
            ) : event ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi label="Total registrations" value={String(event.registeredCount)} sub="Confirmed attendees" accent="bg-sky-500" />
                  <Kpi label="Available seats" value={String(event.availableSeats)} sub={`of ${event.capacity} capacity`} accent="bg-emerald-500" />
                  <Kpi label="Capacity booked" value={`${event.capacityPercent}%`} sub={event.capacityPercent >= 90 ? 'Nearly sold out' : 'Registration open'} accent="bg-violet-500" />
                  <Kpi label="Cancellations" value={String(cancelledCount)} sub="Seats released back" accent="bg-amber-500" />
                </div>

                <ColumnLayout columns={3}>
                  <Container header={<Header variant="h2" description="Booked vs available seats">Seat utilization</Header>}>
                    <PieChart
                      variant="donut"
                      size="medium"
                      data={[
                        { title: 'Booked', value: event.registeredCount },
                        { title: 'Available', value: event.availableSeats },
                      ]}
                      innerMetricValue={`${event.capacityPercent}%`}
                      innerMetricDescription="booked"
                      hideFilter
                      ariaLabel="Seat utilization donut chart"
                      empty={<Box textAlign="center">No data</Box>}
                    />
                  </Container>
                  <Container header={<Header variant="h2" description="Cumulative confirmed registrations">Registration trend</Header>}>
                    <LineChart
                      series={[{ title: 'Confirmed registrations', type: 'line', data: charts.cumulative }]}
                      xScaleType="time"
                      height={220}
                      hideFilter
                      hideLegend
                      xTickFormatter={(d) => d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })}
                      yDomain={[0, event.capacity]}
                      ariaLabel="Cumulative registrations line chart"
                      empty={<Box textAlign="center">No registrations yet</Box>}
                    />
                  </Container>
                  <Container header={<Header variant="h2" description="Confirmed attendees by organization">Top organizations</Header>}>
                    <BarChart
                      series={[{ title: 'Attendees', type: 'bar', data: charts.topOrgs }]}
                      xScaleType="categorical"
                      horizontalBars
                      height={220}
                      hideFilter
                      hideLegend
                      ariaLabel="Top organizations bar chart"
                      empty={<Box textAlign="center">No registrations yet</Box>}
                    />
                  </Container>
                </ColumnLayout>

                <Table
                  {...collectionProps}
                  items={items}
                  loading={loading}
                  loadingText="Loading attendees"
                  variant="container"
                  stickyHeader
                  wrapLines={false}
                  trackBy="confirmationId"
                  header={
                    <Header
                      variant="h2"
                      counter={`(${filteredItemsCount ?? filtered.length})`}
                      description="Attendee personal data is visible to authenticated organizers only."
                      actions={
                        <SegmentedControl
                          selectedId={status}
                          onChange={({ detail }) => setStatus(detail.selectedId as typeof status)}
                          label="Status filter"
                          options={[
                            { id: 'CONFIRMED', text: 'Confirmed' },
                            { id: 'CANCELLED', text: 'Cancelled' },
                            { id: 'ALL', text: 'All' },
                          ]}
                        />
                      }
                    >
                      Attendees
                    </Header>
                  }
                  filter={
                    <TextFilter
                      {...filterProps}
                      filteringPlaceholder="Search by name, email, organization or confirmation ID"
                      filteringAriaLabel="Search attendees"
                      countText={`${filteredItemsCount ?? 0} matches`}
                    />
                  }
                  pagination={<Pagination {...paginationProps} />}
                  columnDefinitions={[
                    { id: 'confirmationId', header: 'Confirmation ID', cell: (r) => <span className="font-mono">{r.confirmationId}</span>, sortingField: 'confirmationId' },
                    { id: 'name', header: 'Name', cell: (r) => r.name, sortingField: 'name' },
                    { id: 'email', header: 'Email', cell: (r) => r.email, sortingField: 'email' },
                    { id: 'organization', header: 'Organization', cell: (r) => r.organization, sortingField: 'organization' },
                    { id: 'createdAt', header: 'Registered', cell: (r) => new Date(r.createdAt).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' }), sortingField: 'createdAt' },
                    {
                      id: 'status', header: 'Status',
                      cell: (r) => r.status === 'CONFIRMED'
                        ? <StatusIndicator type="success">Confirmed</StatusIndicator>
                        : <StatusIndicator type="stopped">Cancelled</StatusIndicator>,
                    },
                    {
                      id: 'actions', header: 'Actions',
                      cell: (r) => (
                        <Button variant="inline-link" disabled={r.status !== 'CONFIRMED'} onClick={() => setToCancel(r)} ariaLabel={`Cancel registration ${r.confirmationId}`}>
                          Cancel
                        </Button>
                      ),
                    },
                  ]}
                />
              </>
            ) : (
              <Alert type="info">No events found. Run the seed script to load the demo event.</Alert>
            )}
          </SpaceBetween>
        </ContentLayout>
      </div>

      <Modal
        visible={!!toCancel}
        onDismiss={() => setToCancel(undefined)}
        header="Cancel registration?"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setToCancel(undefined)}>Keep registration</Button>
              <Button variant="primary" loading={cancelling} onClick={confirmCancel}>Cancel registration</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {toCancel && (
          <SpaceBetween size="s">
            <Box>This releases the seat held by <strong>{toCancel.name}</strong> ({toCancel.organization}).</Box>
            <Box variant="code">{toCancel.confirmationId}</Box>
          </SpaceBetween>
        )}
      </Modal>
    </>
  );
}
