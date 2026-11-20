import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** The page's one h1, named for what the person can do or see here. */
  title: string;
  /** One short sentence under the title. */
  description?: string;
  /** The page's one primary action (a button or link), kept in a fixed, visible place. */
  action?: ReactNode;
}

/** GEN-15: the same top of page everywhere: title, a line of help, and the main action. */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1 className="page-header-title">{title}</h1>
        {description ? <p className="page-header-description">{description}</p> : null}
      </div>
      {action ? <div className="page-header-action">{action}</div> : null}
    </header>
  );
}
