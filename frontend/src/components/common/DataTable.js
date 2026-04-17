import React, { useEffect, useMemo, useState } from 'react';

const DEFAULT_PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

const normalizeText = (value) => String(value ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const parseComparableDate = (value) => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    const timestamp = date.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  return null;
};

const compareValues = (left, right, sortType = 'auto') => {
  if (sortType === 'number') {
    return Number(left || 0) - Number(right || 0);
  }

  if (sortType === 'date') {
    return Number(parseComparableDate(left) || 0) - Number(parseComparableDate(right) || 0);
  }

  if (sortType === 'string') {
    return String(left ?? '').localeCompare(String(right ?? ''), 'fr', { sensitivity: 'base' });
  }

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftIsNumber = Number.isFinite(leftNumber);
  const rightIsNumber = Number.isFinite(rightNumber);

  if (leftIsNumber && rightIsNumber) {
    return leftNumber - rightNumber;
  }

  const leftDate = parseComparableDate(left);
  const rightDate = parseComparableDate(right);
  if (leftDate !== null && rightDate !== null) {
    return leftDate - rightDate;
  }

  return String(left ?? '').localeCompare(String(right ?? ''), 'fr', { sensitivity: 'base' });
};

const resolveValue = (row, column, preferredAccessorKeys = []) => {
  for (const accessorKey of preferredAccessorKeys) {
    const accessor = column?.[accessorKey];
    if (typeof accessor === 'function') {
      return accessor(row);
    }
  }

  if (column?.key) {
    return row?.[column.key];
  }

  return undefined;
};

const resolveColumnLabel = (column) => {
  const candidate = column?.responsiveLabel ?? column?.header ?? column?.key ?? '';
  return typeof candidate === 'string' || typeof candidate === 'number'
    ? String(candidate)
    : String(column?.key ?? '');
};

const DataTable = ({
  columns = [],
  data = [],
  rowKey = 'id',
  emptyMessage = 'Aucune donnée.',
  showSearch = true,
  searchPlaceholder = 'Rechercher...',
  initialSort = null,
  initialPageSize = 10,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  extraControls = null,
  className = '',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(initialPageSize);
  const [sortState, setSortState] = useState(() => {
    if (initialSort?.key) {
      return {
        key: initialSort.key,
        direction: initialSort.direction === 'asc' ? 'asc' : 'desc',
      };
    }

    return { key: null, direction: 'desc' };
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, rowsPerPage, data.length]);

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) {
      return data;
    }

    const normalizedQuery = normalizeText(searchTerm);
    return data.filter((row) => {
      return columns.some((column) => {
        if (column.searchable === false) {
          return false;
        }

        const value = resolveValue(row, column, ['searchAccessor', 'sortAccessor', 'accessor']);
        return normalizeText(value).includes(normalizedQuery);
      });
    });
  }, [columns, data, searchTerm]);

  const sortedRows = useMemo(() => {
    if (!sortState.key) {
      return filteredRows;
    }

    const sortColumn = columns.find((column) => column.key === sortState.key);
    if (!sortColumn) {
      return filteredRows;
    }

    const directionMultiplier = sortState.direction === 'asc' ? 1 : -1;
    return [...filteredRows].sort((left, right) => {
      const leftValue = resolveValue(left, sortColumn, ['sortAccessor', 'accessor', 'searchAccessor']);
      const rightValue = resolveValue(right, sortColumn, ['sortAccessor', 'accessor', 'searchAccessor']);
      return compareValues(leftValue, rightValue, sortColumn.sortType) * directionMultiplier;
    });
  }, [columns, filteredRows, sortState.direction, sortState.key]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(sortedRows.length / rowsPerPage));
  }, [rowsPerPage, sortedRows.length]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return sortedRows.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, rowsPerPage, sortedRows]);

  const handleSort = (column) => {
    if (!column || column.sortable === false) {
      return;
    }

    setSortState((previous) => {
      if (previous.key !== column.key) {
        return { key: column.key, direction: 'asc' };
      }

      return {
        key: column.key,
        direction: previous.direction === 'asc' ? 'desc' : 'asc',
      };
    });
  };

  const resolveRowKey = (row, index) => {
    if (typeof rowKey === 'function') {
      return rowKey(row, index);
    }

    return row?.[rowKey] ?? index;
  };

  return (
    <div className={`datatable ${className}`.trim()}>
      <div className="datatable-toolbar">
        <div className="datatable-toolbar-left">
          {showSearch ? (
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={searchPlaceholder}
              className="datatable-search"
            />
          ) : null}
          {extraControls}
        </div>

        <div className="datatable-toolbar-right">
          <label className="datatable-page-size">
            <span>Lignes</span>
            <select
              value={rowsPerPage}
              onChange={(event) => setRowsPerPage(Number(event.target.value) || initialPageSize)}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <span className="datatable-count">{sortedRows.length} résultat(s)</span>
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => {
                const isActiveSort = sortState.key === column.key;
                const sortIndicator = !isActiveSort
                  ? '↕'
                  : (sortState.direction === 'asc' ? '↑' : '↓');

                return (
                  <th
                    key={column.key}
                    onClick={() => handleSort(column)}
                    className={column.sortable === false ? '' : 'is-sortable'}
                    title={column.sortable === false ? undefined : 'Trier'}
                    style={column.width ? { width: column.width } : undefined}
                  >
                    <span className="datatable-head-label">{column.header || column.key}</span>
                    {column.sortable === false ? null : (
                      <span className={`datatable-sort-indicator ${isActiveSort ? 'is-active' : ''}`}>
                        {sortIndicator}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td className="datatable-empty-cell" colSpan={Math.max(1, columns.length)}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, index) => (
                <tr key={resolveRowKey(row, index)}>
                  {columns.map((column) => (
                    <td
                      key={`${column.key}-${resolveRowKey(row, index)}`}
                      data-label={resolveColumnLabel(column)}
                    >
                      {typeof column.render === 'function'
                        ? column.render(row)
                        : String(resolveValue(row, column, ['accessor']) ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="table-pagination">
        <span className="pagination-info">
          Page {currentPage} / {totalPages}
        </span>
        <div className="pagination-controls">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
          >
            ← Précédent
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
          >
            Suivant →
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataTable;
