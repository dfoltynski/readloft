export default function UploadOverlay({ dragging, progress }: { dragging: boolean; progress: number | null }) {
  if (!dragging && progress === null) return null;
  return (
    <div className="upload-overlay" role="status" aria-live="polite">
      <div className="upload-box">
        {progress === null ? (
          <>
            <strong>Drop to add to your library</strong>
            <span className="muted">EPUB, PDF, MOBI, AZW3, FB2, CBZ</span>
          </>
        ) : (
          <>
            <strong>Uploading… {Math.round(progress * 100)}%</strong>
            <div className="progress-bar">
              <div style={{ width: `${progress * 100}%` }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
