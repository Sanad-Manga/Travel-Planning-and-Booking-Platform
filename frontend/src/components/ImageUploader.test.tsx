import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { ConfirmProvider } from './ConfirmProvider';
import { ImageUploader, type ImageReference, type ImageUploaderProps } from './ImageUploader';

const jpeg = new File(['jpeg'], 'trip.jpg', { type: 'image/jpeg' });
const png = new File(['png'], 'trip.png', { type: 'image/png' });
const stored = (id: string) => ({ id, url: `/uploads/${id}.jpg` });
const first = stored('first');
const second = stored('second');
const maxBytes = 5 * 1024 * 1024;

function setup({
  images = [],
  upload = vi.fn(async () => second),
  remove = vi.fn(async () => {}),
  ...props
}: Partial<Omit<ImageUploaderProps, 'onChange'>> = {}) {
  function Form() {
    const [current, setImages] = useState(images);
    return <ImageUploader images={current} onChange={setImages} upload={upload} remove={remove} {...props} />;
  }
  const user = userEvent.setup({ applyAccept: false });
  render(<ConfirmProvider><Form /></ConfirmProvider>);
  const input = screen.getByLabelText(props.label ?? 'Images');
  return { user, input, upload, remove };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('ImageUploader', () => {
  it('shows existing images and accepts JPEG and PNG in order', async () => {
    const upload = vi.fn().mockResolvedValueOnce(second).mockResolvedValueOnce(stored('third'));
    const { user, input } = setup({ images: [first], upload });
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png');
    expect(input).toHaveAccessibleDescription(/1 of 5 uploaded/);
    expect(screen.getByRole('img', { name: 'Images preview 1' })).toHaveAttribute('src', first.url);
    await user.upload(input, [jpeg, png]);
    expect(upload.mock.calls).toEqual([[jpeg], [png]]);
    expect(screen.getByRole('img', { name: 'Images preview 2' })).toHaveAttribute('src', second.url);
    expect(input).toHaveAccessibleDescription(/3 of 5 uploaded/);
  });

  it.each([
    [new File(['gif'], 'disguised.jpg', { type: 'image/gif' }), 'must be a JPG or PNG'],
    [new File([], 'empty.jpg', { type: 'image/jpeg' }), 'is empty'],
    [new File([new Uint8Array(maxBytes + 1)], 'large.png', { type: 'image/png' }), 'larger than 5 MB'],
  ])('rejects an entire selection containing %s before uploading', async (invalid, message) => {
    const { user, input, upload } = setup();
    await user.upload(input, [jpeg, invalid]);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(upload).not.toHaveBeenCalled();
  });

  it('accepts exactly 5 MiB locally', async () => {
    const file = new File([new Uint8Array(maxBytes)], 'exact.png', { type: 'image/png' });
    const { user, input, upload } = setup();
    await user.upload(input, file);
    expect(upload).toHaveBeenCalledExactlyOnceWith(file);
  });

  it('counts existing images toward five slots and rejects over-capacity batches', async () => {
    const { user, input, upload } = setup({ images: [first, stored('a'), stored('b'), stored('c')] });
    await user.upload(input, [jpeg, png]);
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at most 1 more image.');
    expect(upload).not.toHaveBeenCalled();
    await user.upload(input, png);
    expect(input).toHaveAccessibleDescription(/5 of 5 uploaded/);
    await user.upload(input, jpeg);
    expect(screen.getByRole('alert')).toHaveTextContent('Remove an image before adding another.');
    expect(upload).toHaveBeenCalledExactlyOnceWith(png);
  });

  it('allows one logo and rejects another while the logo exists', async () => {
    const { user, input, upload } = setup({ maxImages: 1, label: 'Airline logo' });
    expect(input).not.toHaveAttribute('multiple');
    await user.upload(input, png);
    expect(input).toHaveAccessibleDescription(/1 of 1 uploaded/);
    await user.upload(input, jpeg);
    expect(screen.getByRole('alert')).toHaveTextContent('Remove an image before adding another.');
    expect(upload).toHaveBeenCalledExactlyOnceWith(png);
  });

  it('reserves the remaining slots during upload and blocks reentry through both controls', async () => {
    const pending = deferred<ImageReference>();
    const upload = vi.fn(() => pending.promise);
    const { user, input, remove } = setup({ images: [first], maxImages: 2, upload });
    await user.upload(input, jpeg);
    expect(screen.getByRole('status')).toHaveTextContent('Uploading image 1 of 1');
    expect(input).toBeDisabled();
    const button = screen.getByRole('button', { name: 'Delete image 1 from Images' });
    expect(button).toBeDisabled();
    expect(screen.getAllByRole('img')).toHaveLength(1);
    fireEvent.change(input, { target: { files: [png] } });
    await user.click(button);
    expect(upload).toHaveBeenCalledExactlyOnceWith(jpeg);
    expect(remove).not.toHaveBeenCalled();
    await act(async () => pending.resolve(second));
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(input).toBeEnabled();
  });

  it('shows backend error text and stops the batch after a failure', async () => {
    const upload = vi.fn().mockResolvedValueOnce(second).mockRejectedValueOnce(new ApiError(400, 'Image content does not match its MIME type'));
    const { user, input } = setup({ upload });
    await user.upload(input, [jpeg, png, new File(['x'], 'third.jpg', { type: 'image/jpeg' })]);
    expect(screen.getByRole('alert')).toHaveTextContent('Image content does not match its MIME type');
    expect(upload).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAttribute('src', second.url);
  });

  it('lets keyboard users cancel or confirm deletion and removes only the intended image after success', async () => {
    const pending = deferred<void>();
    const remove = vi.fn(() => pending.promise);
    const { user, input } = setup({ images: [first, second], remove });
    const target = screen.getByRole('button', { name: 'Delete image 2 from Images' });
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(target).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(remove).not.toHaveBeenCalled();
    expect(target).toHaveFocus();
    await user.keyboard('{Enter}{Tab}{Enter}');
    expect(remove).toHaveBeenCalledExactlyOnceWith(second);
    expect(screen.getByRole('status')).toHaveTextContent('Deleting image');
    expect(input).toBeDisabled();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    await act(async () => pending.resolve());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', first.url);
    expect(input).toBeEnabled();
  });

  it('keeps the preview and shows the backend message when deletion fails', async () => {
    const remove = vi.fn().mockRejectedValueOnce(new ApiError(403, 'You cannot remove this image'));
    const { user } = setup({ images: [first], remove });
    await user.click(screen.getByRole('button', { name: 'Delete image 1 from Images' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete image' }));
    expect(screen.getByRole('alert')).toHaveTextContent('You cannot remove this image');
    expect(screen.getByRole('img')).toHaveAttribute('src', first.url);
  });

  it('disables selection and deletion when the parent disables it', () => {
    const { input } = setup({ images: [first], disabled: true });
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete image 1 from Images' })).toBeDisabled();
  });
});
