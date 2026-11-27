import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportDialog } from './ReportDialog';

const reply = (body: object, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const failure = (statusCode: number, message: string, details?: object[]) => reply({ statusCode, message, details }, statusCode);
const saved = () => reply({ id: 'r1', reporterId: 'u1', targetType: 'POST', targetId: 'p1', reason: 'x', status: 'OPEN' }, 201);

const fetchMock = vi.fn();

function setup(props: Partial<React.ComponentProps<typeof ReportDialog>> = {}) {
  const onClose = vi.fn();
  const onReported = vi.fn();
  const view = render(<ReportDialog targetType="POST" targetId="p1" onClose={onClose} onReported={onReported} {...props} />);
  return { onClose, onReported, user: userEvent.setup(), ...view };
}

const reasonBox = () => screen.getByLabelText(/Why are you reporting this/);
const send = () => screen.getByRole('button', { name: /Send report|Sending report/ });

describe('ReportDialog (GEN-09)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens as a modal dialog with the cursor in the reason box and names what is reported', () => {
    setup({ targetType: 'ITINERARY' });
    expect(screen.getByRole('dialog', { name: 'Report this itinerary' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Why are you reporting this itinerary?*')).toHaveFocus();
  });

  it('needs a reason: shows the message under the box, focuses it and sends nothing', async () => {
    const { user } = setup();
    await user.type(reasonBox(), '    ');
    await user.click(send());
    expect(screen.getByText('Tell us why you are reporting this.')).toBeInTheDocument();
    expect(reasonBox()).toHaveAttribute('aria-invalid', 'true');
    expect(reasonBox()).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks a reason that is too long before sending', async () => {
    const { user } = setup();
    await user.click(reasonBox());
    await user.paste('a'.repeat(501));
    await user.click(send());
    expect(screen.getByText('Use 500 characters or fewer. You used 501.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the type, the id and the trimmed reason, then thanks the person', async () => {
    fetchMock.mockImplementation(() => saved());
    const { user, onReported } = setup({ targetType: 'POST', targetId: 'p1' });
    await user.type(reasonBox(), '  Spam links  ');
    await user.click(send());
    expect(await screen.findByText('Thank you')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/reports');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ targetType: 'POST', targetId: 'p1', reason: 'Spam links' });
    expect(onReported).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('cannot be sent twice while the request runs', async () => {
    let finish: () => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (finish = () => resolve(new Response('{}', { status: 201 })))));
    const { user } = setup();
    await user.type(reasonBox(), 'Spam');
    await user.click(send());
    expect(send()).toBeDisabled();
    expect(reasonBox()).toBeDisabled();
    await user.click(send());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish();
    await screen.findByText('Thank you');
  });

  it('shows a second report of the same item as "already reported" and still tells the caller', async () => {
    fetchMock.mockImplementation(() => failure(409, 'You have already reported this item', [{ field: 'targetId', message: 'you have already reported this item' }]));
    const { user, onReported } = setup({ targetType: 'REVIEW' });
    await user.type(reasonBox(), 'Rude');
    await user.click(send());
    expect(await screen.findByText('Already reported')).toBeInTheDocument();
    expect(screen.getByText('You have already reported this review. Our team will look at it.')).toBeInTheDocument();
    expect(onReported).toHaveBeenCalledTimes(1);
  });

  it('says so when the item is gone (404)', async () => {
    fetchMock.mockImplementation(() => failure(404, 'POST not found'));
    const { user, onReported } = setup();
    await user.type(reasonBox(), 'Spam');
    await user.click(send());
    expect(await screen.findByText('This post is no longer available, so it cannot be reported.')).toBeInTheDocument();
    expect(onReported).not.toHaveBeenCalled();
  });

  it('puts a server message about the reason next to the box and keeps what was typed', async () => {
    fetchMock.mockImplementation(() => failure(400, 'Validation failed', [{ field: 'reason', message: 'reason is required' }]));
    const { user } = setup();
    await user.type(reasonBox(), 'Spam');
    await user.click(send());
    expect(await screen.findByText('reason is required')).toBeInTheDocument();
    expect(reasonBox()).toHaveValue('Spam');
    expect(reasonBox()).toHaveFocus();
  });

  it('shows a server failure as an alert with a retry that sends again', async () => {
    fetchMock.mockImplementationOnce(() => failure(503, 'Service unavailable')).mockImplementation(() => saved());
    const { user } = setup();
    await user.type(reasonBox(), 'Spam');
    await user.click(send());
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Thank you')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps focus inside the dialog after a failed send, so Escape still closes it', async () => {
    fetchMock.mockImplementation(() => {
      // A real browser drops focus to the page when the focused control becomes disabled; jsdom does not, so do it here.
      (document.activeElement as HTMLElement | null)?.blur();
      return failure(503, 'Service unavailable');
    });
    const { user, onClose } = setup();
    await user.type(reasonBox(), 'Spam');
    await user.click(send());
    await screen.findByRole('alert');
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('removes the message under the box as soon as the reason is edited', async () => {
    const { user } = setup();
    await user.click(send());
    expect(screen.getByText('Tell us why you are reporting this.')).toBeInTheDocument();
    await user.type(reasonBox(), 'S');
    expect(screen.queryByText('Tell us why you are reporting this.')).not.toBeInTheDocument();
    expect(reasonBox()).not.toHaveAttribute('aria-invalid');
  });

  it('lets a screen reader hear the result when focus moves to Close', async () => {
    fetchMock.mockImplementation(() => saved());
    const { user } = setup();
    await user.type(reasonBox(), 'Spam');
    await user.click(send());
    await screen.findByText('Thank you');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAccessibleDescription(/Thank you\s*We received your report/);
  });

  it('does not call back into a page that went away while the report was being sent', async () => {
    let finish: () => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (finish = () => resolve(new Response('{}', { status: 201 })))));
    const { user, onReported, unmount } = setup();
    await user.type(reasonBox(), 'Spam');
    await user.click(send());
    unmount();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onReported).not.toHaveBeenCalled();
  });

  it('closes with Cancel, Escape and a click outside', async () => {
    const first = setup();
    await first.user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = setup();
    await second.user.keyboard('{Escape}');
    expect(second.onClose).toHaveBeenCalledTimes(1);
    second.unmount();

    const third = setup();
    await third.user.pointer({ keys: '[MouseLeft]', target: screen.getByTestId('report-backdrop') });
    expect(third.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape or a click outside while the report is being sent', async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    const { user, onClose } = setup();
    await user.type(reasonBox(), 'Spam');
    await user.click(send());
    await user.keyboard('{Escape}');
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByTestId('report-backdrop') });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the dialog', async () => {
    const { user } = setup();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    await user.tab();
    expect(reasonBox()).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
  });

  it('works from any page: opened by a button there, and focus goes back to that button when it closes', async () => {
    function Page() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Report
          </button>
          {open ? <ReportDialog targetType="COMMENT" targetId="c1" onClose={() => setOpen(false)} /> : null}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Report' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Report this comment' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByTestId('report-backdrop') });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
