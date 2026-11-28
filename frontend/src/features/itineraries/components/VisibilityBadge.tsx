import type { Visibility } from '../api';

/** ITN-20: who can see an itinerary, in words (the colour only supports them), plus an admin's hide flag. */
export function VisibilityBadge({ visibility, isHidden }: { visibility: Visibility; isHidden?: boolean }) {
  const isPublic = visibility === 'PUBLIC';
  return (
    <span className="badge-group">
      <span className={`status-badge status-badge-${isPublic ? 'info' : 'neutral'}`}>{isPublic ? 'Public' : 'Private'}</span>
      {isHidden ? <span className="status-badge status-badge-error">Hidden by an admin</span> : null}
    </span>
  );
}
