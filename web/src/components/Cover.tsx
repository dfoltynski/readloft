import { useEffect, useRef, useState } from 'react';
import type { Book } from '@shared/types';
import { coverUrl } from '../api';
import { authorLine, generatedCoverBackground } from '../lib/format';

/**
 * 2:3 cover. The generated cover is always rendered as a placeholder; the real
 * image fades in on top of it once loaded.
 */
export default function Cover({ book, large = false }: { book: Book; large?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const src = book.hasCover ? coverUrl(book) : null;

  useEffect(() => {
    // Cached images may finish loading before React attaches onLoad.
    setLoaded(!!img.current?.complete && !!img.current.naturalWidth);
  }, [src]);

  return (
    <div className={`cover${large ? ' cover-large' : ''}`}>
      {(!src || !loaded) && (
        <div className="cover-generated" style={{ background: generatedCoverBackground(book.title) }}>
          <span className="cover-generated-title">{book.title}</span>
          <span className="cover-generated-author">{authorLine(book)}</span>
        </div>
      )}
      {src && (
        <img
          ref={img}
          className={`cover-img${loaded ? ' loaded' : ''}`}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  );
}
