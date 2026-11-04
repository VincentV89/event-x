import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Spinner from '@cloudscape-design/components/spinner';
import { completeSignIn } from '../lib/auth';

export default function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    completeSignIn(window.location.search)
      .then(() => navigate('/organizer', { replace: true }))
      .catch((e: Error) => setError(e.message));
  }, [navigate]);

  return (
    <div className="mx-auto mt-24 max-w-lg px-4">
      {error ? (
        <Alert type="error" header="Sign-in failed" action={<Button onClick={() => navigate('/organizer')}>Try again</Button>}>
          {error}
        </Alert>
      ) : (
        <Box textAlign="center"><Spinner size="large" /> <Box variant="p">Signing you in…</Box></Box>
      )}
    </div>
  );
}
