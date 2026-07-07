import { useState, type FormEvent } from 'react';
import { requestCapture } from '../api';

type Status = 'idle' | 'sending' | 'queued' | 'pending' | 'badpin' | 'error';
type CameraChoice = {
  id: string;
  label: string;
};

// One button per camera — ids must match each camera's `device_name` in
// camera/config.toml and CAMERA_TARGETS in api/capture.ts.
const CAMERAS: CameraChoice[] = [
  { id: 'feeder-pi', label: 'Pi camera' },
  { id: 'yard-reolink', label: 'Reolink camera' },
];

const MESSAGE: Record<Status, string> = {
  idle: '',
  sending: 'Asking the camera…',
  queued: '📸 On its way! Your photo will appear above within a minute.',
  pending: "A photo's already on the way — hang tight!",
  badpin: "That code didn't work — give it another try.",
  error: 'Something went wrong. Try again in a moment.',
};

// A friendly "take a photo now" control, pinned to the corner of the gallery.
// Anyone at the page can ask the feeder camera to grab a live shot (gated by a
// shared PIN). The photo shows up in the gallery within a minute; if it isn't a
// bird it auto-removes after a little while.
export function CaptureButton({ onRequested }: { onRequested?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [camera, setCamera] = useState<CameraChoice | null>(null);

  function close() {
    setOpen(false);
    setStatus('idle');
    setPin('');
    setCamera(null);
  }

  function openFor(choice: CameraChoice) {
    setCamera(choice);
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!camera || pin.length < 3 || status === 'sending') return;
    setStatus('sending');
    const res = await requestCapture(pin, camera.id);
    if (res.badPin) {
      setStatus('badpin');
    } else if (!res.ok) {
      setStatus('error');
    } else {
      setStatus(res.alreadyPending ? 'pending' : 'queued');
      onRequested?.();
    }
  }

  const done = status === 'queued' || status === 'pending';

  if (!open) {
    return (
      <div className="capture-fab-stack" aria-label="Take a photo now">
        {CAMERAS.map((choice) => (
          <button key={choice.id} className="capture-fab" onClick={() => openFor(choice)}>
            📸 {choice.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="capture-panel" role="dialog" aria-label="Take a photo now">
      <button className="capture-close" onClick={close} aria-label="Close">
        ×
      </button>
      {done ? (
        <p className="capture-msg">{MESSAGE[status]}</p>
      ) : (
        <form onSubmit={submit}>
          <p className="capture-lead">Snap a live photo from {camera?.label}</p>
          <input
            className="capture-pin"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Enter code"
            aria-label="Access code"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus
          />
          <button className="capture-send" type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Take photo'}
          </button>
          {(status === 'badpin' || status === 'error') && (
            <p className="capture-msg capture-msg-err">{MESSAGE[status]}</p>
          )}
        </form>
      )}
    </div>
  );
}
