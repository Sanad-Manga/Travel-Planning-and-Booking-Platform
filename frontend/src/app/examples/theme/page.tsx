import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { ThemeShowcase } from './ThemeShowcase';

export const metadata: Metadata = {
  title: 'Theme style guide | Travel Planning and Booking Platform',
  robots: { index: false },
};

/**
 * Living style guide: every shared component and state, shown in light and dark side by side.
 * It is driven by the tokens in globals.css, so changing a token there changes this page too.
 * The header and footer around it are the real app shell. See docs/theme.md.
 */
export default function ThemeExamplePage() {
  return (
    <div className="page">
      <PageHeader
        title="Theme style guide"
        description="Every shared component in light and dark. Change a token in globals.css and this page updates."
      />
      <div className="styleguide-panels">
        <section data-theme="light" className="styleguide-panel" aria-label="Light theme">
          <ThemeShowcase name="Light" />
        </section>
        <section data-theme="dark" className="styleguide-panel" aria-label="Dark theme">
          <ThemeShowcase name="Dark" />
        </section>
      </div>
    </div>
  );
}
