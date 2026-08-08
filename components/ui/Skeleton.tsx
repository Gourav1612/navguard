'use client';

import React from 'react';

interface TableSkeletonProps {
  cols?: number;
  rows?: number;
}

export function TableSkeleton({ cols = 6, rows = 8 }: TableSkeletonProps) {
  return (
    <div className="space-y-6">
      {/* Header Title Shimmer */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-pulse">
        <div className="space-y-2">
          <div className="h-7 w-48 bg-slate-200 rounded-xl" />
          <div className="h-4 w-96 bg-slate-100 rounded-lg" />
        </div>
        <div className="h-11 w-32 bg-slate-200 rounded-xl" />
      </div>

      {/* Filter Row Shimmer */}
      <div className="flex items-center gap-3 bg-white border border-slate-150 p-4 rounded-2xl shadow-sm animate-pulse">
        <div className="h-4 w-28 bg-slate-200 rounded-lg" />
        <div className="h-7 w-32 bg-slate-100 rounded-xl" />
      </div>

      {/* Table Skeleton */}
      <div className="bg-white border border-slate-150 rounded-2xl shadow-sm overflow-hidden animate-pulse">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-150">
                {Array.from({ length: cols }).map((_, i) => (
                  <th key={i} className="px-6 py-4">
                    <div className="h-3 w-16 bg-slate-200 rounded" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Array.from({ length: rows }).map((_, r) => (
                <tr key={r}>
                  {Array.from({ length: cols }).map((_, c) => (
                    <td key={c} className="px-6 py-4.5">
                      {c === 0 ? (
                        // Primary column: avatar + name/email stack
                        <div className="flex flex-col gap-2">
                          <div className="h-4 w-32 bg-slate-200 rounded" />
                          <div className="h-3 w-44 bg-slate-100 rounded" />
                        </div>
                      ) : c === cols - 1 ? (
                        // Actions column
                        <div className="flex justify-end gap-2">
                          <div className="h-8 w-8 bg-slate-200 rounded-lg" />
                          <div className="h-8 w-8 bg-slate-200 rounded-lg" />
                        </div>
                      ) : (
                        // Generic column content
                        <div className="h-4 w-24 bg-slate-150 rounded" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface CardGridSkeletonProps {
  cards?: number;
}

export function CardGridSkeleton({ cards = 6 }: CardGridSkeletonProps) {
  return (
    <div className="space-y-6">
      {/* Header Title Shimmer */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-pulse">
        <div className="space-y-2">
          <div className="h-7 w-48 bg-slate-200 rounded-xl" />
          <div className="h-4 w-96 bg-slate-100 rounded-lg" />
        </div>
        <div className="h-11 w-32 bg-slate-200 rounded-xl" />
      </div>

      {/* Grid Roster */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
        {Array.from({ length: cards }).map((_, idx) => (
          <div
            key={idx}
            className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm flex flex-col justify-between space-y-5"
          >
            <div className="space-y-4">
              {/* Card Top Avatar Header */}
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-slate-200 flex-shrink-0" />
                <div className="space-y-2 flex-grow">
                  <div className="h-4 w-28 bg-slate-200 rounded" />
                  <div className="h-3 w-36 bg-slate-150 rounded" />
                </div>
              </div>

              {/* Card Details Shimmer */}
              <div className="grid grid-cols-2 gap-4 border-y border-slate-100 py-4">
                <div className="space-y-1.5">
                  <div className="h-2.5 w-12 bg-slate-150 rounded" />
                  <div className="h-4 w-16 bg-slate-200 rounded" />
                </div>
                <div className="space-y-1.5">
                  <div className="h-2.5 w-20 bg-slate-150 rounded" />
                  <div className="h-4 w-24 bg-slate-200 rounded" />
                </div>
              </div>

              {/* Card Bottom Shimmer */}
              <div className="space-y-2">
                <div className="h-3 w-16 bg-slate-150 rounded" />
                <div className="h-4 w-48 bg-slate-200 rounded" />
              </div>
            </div>

            {/* Card Buttons Shimmer */}
            <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
              <div className="h-9 flex-1 bg-slate-200 rounded-xl" />
              <div className="h-9 flex-1 bg-slate-200 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
