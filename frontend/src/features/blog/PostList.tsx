import Link from 'next/link';
import { postHref, tagHref, type PostListRow } from '@/api/blog';
import { formatInZone } from '@/lib/formatInZone';
import styles from './blog.module.css';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** One published post in a list (BLG-02): title, author, date, excerpt, clickable tags (BLG-08), counts. */
function PostCard({ post }: { post: PostListRow }) {
  return (
    <article className={styles.post}>
      <h2 className={styles.postTitle}>
        <Link href={postHref(post.id)}>{post.title}</Link>
      </h2>
      <p className={styles.meta}>
        By {post.author.name} · <time dateTime={post.publishedAt}>{formatInZone(post.publishedAt, 'UTC', { dateOnly: true })}</time>
      </p>
      {post.excerpt ? <p className={styles.excerpt}>{post.excerpt}</p> : null}
      {post.tags.length > 0 ? (
        <ul className={styles.tags} aria-label="Tags">
          {post.tags.map((tag) => (
            <li key={tag}>
              <Link className={styles.tag} href={tagHref(tag)}>#{tag}</Link>
            </li>
          ))}
        </ul>
      ) : null}
      <p className={styles.counts}>
        {plural(post.likeCount, 'like')} · {plural(post.commentCount, 'comment')}
      </p>
    </article>
  );
}

export function PostList({ posts }: { posts: PostListRow[] }) {
  return (
    <ul className={styles.list}>
      {posts.map((post) => (
        <li key={post.id}>
          <PostCard post={post} />
        </li>
      ))}
    </ul>
  );
}
