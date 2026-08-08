'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  isPending?: boolean;
  itemLabel?: string;
}

export function PaginationControls({
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
  isPending = false,
  itemLabel = 'records',
}: PaginationControlsProps) {
  if (totalCount === 0) return null;

  const startRecord = (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalCount);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-5 mt-4 border-t border-slate-100 dark:border-slate-800 text-sm">
      {/* Records Count Info */}
      <div className="flex items-center gap-2.5 text-slate-500 font-medium">
        <span>
          Showing <span className="font-semibold text-slate-800 dark:text-slate-200">{startRecord}-{endRecord}</span> of{' '}
          <span className="font-semibold text-slate-800 dark:text-slate-200">{totalCount}</span> {itemLabel}
        </span>
        {isPending && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold text-purple-700 bg-purple-50 dark:bg-purple-950/50 dark:text-purple-300 animate-pulse">
            <Loader2 className="w-3 h-3 animate-spin" />
            Updating...
          </span>
        )}
      </div>

      {/* Pagination Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1 || isPending}
          className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </button>

        <div className="flex items-center gap-1 px-2 font-semibold text-xs text-slate-600 dark:text-slate-400">
          <span>Page</span>
          <span className="px-2 py-0.5 bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-bold rounded-md">
            {currentPage}
          </span>
          <span>of {Math.max(1, totalPages)}</span>
        </div>

        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages || isPending}
          className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
