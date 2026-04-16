import { useState, useRef, useCallback, type DragEvent } from 'react';
import { Upload, File, X, Image as ImageIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface FileUploadProps {
  accept?: string;
  maxSize?: number; // in bytes
  onFileSelect: (file: File | null) => void;
  currentFile?: File | null;
  className?: string;
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_ACCEPT = 'image/*,.pdf';

export function FileUpload({
  accept = DEFAULT_ACCEPT,
  maxSize = DEFAULT_MAX_SIZE,
  onFileSelect,
  currentFile,
  className,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      if (file.size > maxSize) {
        setError(`File too large. Maximum size is ${formatSize(maxSize)}.`);
        return;
      }

      // Generate preview for images
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setPreview(null);
      }

      onFileSelect(file);
    },
    [maxSize, onFileSelect],
  );

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleRemove = () => {
    setPreview(null);
    setError(null);
    onFileSelect(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const hasFile = !!currentFile;

  return (
    <div className={cn('w-full', className)}>
      {hasFile ? (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
          {/* Preview or file icon */}
          {preview ? (
            <img
              src={preview}
              alt="Preview"
              className="h-12 w-12 rounded object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded bg-muted">
              {currentFile?.type === 'application/pdf' ? (
                <File className="h-6 w-6 text-muted-foreground" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
          )}

          {/* File info */}
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {currentFile?.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {currentFile ? formatSize(currentFile.size) : ''}
            </p>
          </div>

          {/* Remove button */}
          <button
            type="button"
            onClick={handleRemove}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
          )}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              Drop a file here or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Images and PDFs up to {formatSize(maxSize)}
            </p>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
      />
    </div>
  );
}
