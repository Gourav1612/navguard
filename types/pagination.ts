export interface PaginatedResult<T> {
  data: T[];
  count: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: string;
}

export interface ServerActionResponse {
  success: boolean;
  error?: string;
}
