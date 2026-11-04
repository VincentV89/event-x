import { useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { api, ApiError, type EventSummary } from '../lib/api';

type Fields = { name: string; email: string; organization: string };
const EMPTY: Fields = { name: '', email: '', organization: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(f: Fields): Partial<Fields> {
  const e: Partial<Fields> = {};
  if (f.name.trim().length < 2) e.name = 'Please enter your full name.';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Please enter a valid email address.';
  if (f.organization.trim().length < 2) e.organization = 'Please enter your organization.';
  return e;
}

export default function RegistrationForm({ event, onRegistered }: { event: EventSummary; onRegistered: () => void }) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Fields>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<{ title: string; message: string }>();
  const [success, setSuccess] = useState<{ confirmationId: string; name: string }>();
  const full = event.availableSeats <= 0;

  const set = (k: keyof Fields) => ({ detail }: { detail: { value: string } }) => {
    setFields((f) => ({ ...f, [k]: detail.value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function submit() {
    setServerError(undefined);
    const v = validate(fields);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSubmitting(true);
    try {
      const res = await api.register(event.eventId, fields);
      setSuccess({ confirmationId: res.confirmationId, name: fields.name.trim() });
      setFields(EMPTY);
      onRegistered();
    } catch (e) {
      const err = e as ApiError;
      if (err.details) setErrors(err.details as Partial<Fields>);
      const titles: Record<string, string> = {
        ALREADY_REGISTERED: 'Already registered',
        EVENT_FULL: 'Event is full',
        VALIDATION_FAILED: 'Check your details',
      };
      setServerError({ title: titles[err.code] ?? 'Registration failed', message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <SpaceBetween size="l">
        <Alert type="success" header={`You're in, ${success.name}! 🎉`}>
          Your seat at <strong>{event.name}</strong> is confirmed. Keep your confirmation ID for check-in.
        </Alert>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <Box variant="small" color="text-body-secondary">CONFIRMATION ID</Box>
          <div className="my-2 font-mono text-3xl font-bold tracking-widest text-emerald-800" data-testid="confirmation-id">
            {success.confirmationId}
          </div>
          <CopyToClipboard
            copyButtonText="Copy ID"
            copySuccessText="Confirmation ID copied"
            copyErrorText="Copy failed"
            textToCopy={success.confirmationId}
          />
        </div>
        <Button onClick={() => setSuccess(undefined)}>Register another attendee</Button>
      </SpaceBetween>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <Form
        actions={
          <Button variant="primary" formAction="submit" loading={submitting} disabled={full} fullWidth>
            {full ? 'Registration full' : 'Reserve my seat'}
          </Button>
        }
      >
        <SpaceBetween size="m">
          {serverError && (
            <Alert type="error" header={serverError.title} dismissible onDismiss={() => setServerError(undefined)}>
              {serverError.message}
            </Alert>
          )}
          {full && <Alert type="warning" header="Sold out">All seats have been taken. Please check back - seats are released when registrations are cancelled.</Alert>}
          <FormField label="Full name" errorText={errors.name}>
            <Input value={fields.name} onChange={set('name')} placeholder="Jane Tan" autoComplete="name" disabled={full} ariaRequired />
          </FormField>
          <FormField label="Work email" errorText={errors.email} constraintText="One registration per email address.">
            <Input value={fields.email} onChange={set('email')} type="email" inputMode="email" placeholder="jane.tan@agency.gov.sg" autoComplete="email" disabled={full} ariaRequired />
          </FormField>
          <FormField label="Organization" errorText={errors.organization}>
            <Input value={fields.organization} onChange={set('organization')} placeholder="GovTech Singapore" autoComplete="organization" disabled={full} ariaRequired />
          </FormField>
        </SpaceBetween>
      </Form>
    </form>
  );
}
