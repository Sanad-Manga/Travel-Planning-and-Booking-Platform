'use client';

import { useState } from 'react';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/ToastProvider';
import { ApiError } from '@/lib/api';
import { toFriendlyError } from '@/lib/apiError';
import { deleteItinerary, updateItinerary, type Visibility } from './api';

interface Target {
  id: string;
  title: string;
  visibility: Visibility;
  isHidden?: boolean;
}

/**
 * The two actions the list and the edit page share: share or unshare (ITN-20) and delete (ITN-01).
 * Publishing and deleting ask first; going back to private is safe, so it happens at once.
 * `onDone` reloads (or leaves) the screen. It also runs after a failure, because the usual cause is that
 * the itinerary changed elsewhere.
 */
export function useItineraryActions() {
  const confirm = useConfirm();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  function report(error: unknown) {
    const { message, hint } = toFriendlyError(error);
    toast.error(`${message} ${hint}`);
  }

  async function toggleVisibility(target: Target, onDone: () => unknown) {
    const next: Visibility = target.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
    if (next === 'PUBLIC') {
      const agreed = await confirm({
        title: `Make “${target.title}” public?`,
        message: target.isHidden
          ? 'An admin hid this itinerary, so others still will not see it.'
          : 'Anyone, including guests, will be able to find it and read its days, activities and budget. Only you can change it.',
        confirmLabel: 'Make public',
        cancelLabel: 'Keep private',
      });
      if (!agreed) return;
    }
    setBusyId(target.id);
    try {
      await updateItinerary(target.id, { visibility: next });
      await onDone();
      toast.success(next === 'PUBLIC' ? 'Your itinerary is now public.' : 'Your itinerary is now private.');
    } catch (error) {
      report(error);
      await onDone();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(target: Target, onDone: () => unknown) {
    try {
      const deleted = await confirm({
        title: `Delete “${target.title}”?`,
        message: 'Its days, activities and budget are deleted too. Copies other people made stay theirs. This cannot be undone.',
        confirmLabel: 'Delete itinerary',
        cancelLabel: 'Keep itinerary',
        destructive: true,
        onConfirm: () => deleteItinerary(target.id),
      });
      if (!deleted) return;
      toast.success('Itinerary deleted.');
      await onDone();
    } catch (error) {
      report(error);
      // Already gone (deleted in another tab): refresh, or the dead row stays on screen.
      if (error instanceof ApiError && error.statusCode === 404) await onDone();
    }
  }

  return { busyId, toggleVisibility, remove };
}
