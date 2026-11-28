import { POST_SEARCH_MAX_LENGTH, TAG_MAX_LENGTH } from '@/api/blog';
import styles from './blog.module.css';

/**
 * BLG-09 search and BLG-08 tag filter. A plain GET form: submitting it loads `/blog?q=…&tag=…`, which the
 * server renders, so it also works before JavaScript loads. A blank field arrives as an empty value,
 * which the page ignores.
 */
export function BlogSearchForm({ q, tag }: { q: string; tag: string }) {
  return (
    <form role="search" action="/blog" method="get" className={styles.search}>
      <label>
        Search posts
        <input type="search" name="q" defaultValue={q} maxLength={POST_SEARCH_MAX_LENGTH}
          placeholder="Title, tag or author" />
      </label>
      <label>
        Tag
        <input type="text" name="tag" defaultValue={tag} maxLength={TAG_MAX_LENGTH} placeholder="e.g. cairo" />
      </label>
      <button type="submit" className="btn btn-primary">Search posts</button>
    </form>
  );
}
