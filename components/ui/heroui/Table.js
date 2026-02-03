'use client'

import {
  Table as HeroTable,
  TableHeader as HeroTableHeader,
  TableBody as HeroTableBody,
  TableColumn as HeroTableColumn,
  TableRow as HeroTableRow,
  TableCell as HeroTableCell,
  Pagination,
  Spinner,
  Chip,
} from '@heroui/react'
import { cn } from '@/utils/cn'

// Re-export HeroUI table components with HRMS prefix for composable usage
export const HRMSTableHeader = HeroTableHeader
export const HRMSTableBody = HeroTableBody
export const HRMSTableColumn = HeroTableColumn
export const HRMSTableRow = HeroTableRow
export const HRMSTableCell = HeroTableCell

/**
 * Status Badge Component for tables
 */
export function StatusBadge({ status, className }) {
  const statusConfig = {
    paid: { color: 'success', label: 'Paid' },
    pending: { color: 'warning', label: 'Pending' },
    processing: { color: 'primary', label: 'Processing' },
    failed: { color: 'danger', label: 'Failed' },
    cancelled: { color: 'default', label: 'Cancelled' },
    approved: { color: 'success', label: 'Approved' },
    rejected: { color: 'danger', label: 'Rejected' },
    draft: { color: 'default', label: 'Draft' },
    active: { color: 'success', label: 'Active' },
    inactive: { color: 'default', label: 'Inactive' },
  }

  const config = statusConfig[status?.toLowerCase()] || { color: 'default', label: status || 'Unknown' }

  return (
    <Chip
      size="sm"
      variant="flat"
      color={config.color}
      className={cn('capitalize', className)}
    >
      {config.label}
    </Chip>
  )
}

/**
 * HRMS Table Component
 * Standardized table with consistent styling, pagination, and loading states
 * Supports both data-driven (columns/data props) and composable (children) patterns
 */
export function HRMSTable({
  columns,
  data,
  children,
  isLoading = false,
  isEmpty = false,
  emptyContent = 'No data available',
  selectionMode = 'none',
  selectedKeys,
  onSelectionChange,
  sortDescriptor,
  onSortChange,
  className,
  classNames,
  ...props
}) {
  // If children are provided, use composable pattern
  if (children) {
    return (
      <HeroTable
        aria-label="Data table"
        className={cn('w-full', className)}
        selectionMode={selectionMode}
        selectedKeys={selectedKeys}
        onSelectionChange={onSelectionChange}
        sortDescriptor={sortDescriptor}
        onSortChange={onSortChange}
        classNames={{
          wrapper: 'shadow-none border-0 rounded-xl',
          th: [
            'bg-default-50',
            'text-default-600',
            'font-semibold',
            'text-xs',
            'uppercase',
            'tracking-wider',
          ],
          td: [
            'text-default-700',
            'py-3',
          ],
          tr: 'hover:bg-default-50 transition-colors',
          ...classNames,
        }}
        {...props}
      >
        {children}
      </HeroTable>
    )
  }

  // Data-driven pattern
  return (
    <HeroTable
      aria-label="Data table"
      className={cn('w-full', className)}
      selectionMode={selectionMode}
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
      sortDescriptor={sortDescriptor}
      onSortChange={onSortChange}
      classNames={{
        wrapper: 'shadow-none border border-default-200 rounded-xl',
        th: [
          'bg-default-50',
          'text-default-600',
          'font-semibold',
          'text-xs',
          'uppercase',
          'tracking-wider',
        ],
        td: [
          'text-default-700',
          'py-3',
        ],
        tr: 'hover:bg-default-50 transition-colors',
        ...classNames,
      }}
      {...props}
    >
      <HeroTableHeader columns={columns}>
        {(column) => (
          <HeroTableColumn
            key={column.key}
            allowsSorting={column.sortable}
            align={column.align || 'start'}
          >
            {column.label}
          </HeroTableColumn>
        )}
      </HeroTableHeader>
      <HeroTableBody
        items={data}
        isLoading={isLoading}
        loadingContent={<Spinner color="primary" size="lg" />}
        emptyContent={isEmpty ? emptyContent : null}
      >
        {(item) => (
          <HeroTableRow key={item.id || item._id || item.key}>
            {(columnKey) => (
              <HeroTableCell>
                {columns.find(col => col.key === columnKey)?.render
                  ? columns.find(col => col.key === columnKey).render(item)
                  : item[columnKey]}
              </HeroTableCell>
            )}
          </HeroTableRow>
        )}
      </HeroTableBody>
    </HeroTable>
  )
}

/**
 * Table with pagination
 */
export function PaginatedTable({
  columns,
  data,
  page = 1,
  totalPages = 1,
  onPageChange,
  isLoading,
  isEmpty,
  emptyContent,
  ...props
}) {
  return (
    <div className="flex flex-col gap-4">
      <HRMSTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        isEmpty={isEmpty}
        emptyContent={emptyContent}
        {...props}
      />
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination
            total={totalPages}
            page={page}
            onChange={onPageChange}
            showControls
            color="primary"
            classNames={{
              wrapper: 'gap-1',
              item: 'text-sm font-medium',
            }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Simple table without Hero UI Table (for custom layouts)
 */
export function SimpleTable({ children, className }) {
  return (
    <div className={cn(
      'overflow-x-auto rounded-xl border border-default-200',
      className
    )}>
      <table className="w-full">
        {children}
      </table>
    </div>
  )
}

export function SimpleTableHead({ children, className }) {
  return (
    <thead className={cn('bg-default-50', className)}>
      {children}
    </thead>
  )
}

export function SimpleTableBody({ children, className }) {
  return (
    <tbody className={cn('divide-y divide-default-100', className)}>
      {children}
    </tbody>
  )
}

export function SimpleTableRow({ children, className, isSelected, onClick }) {
  return (
    <tr 
      className={cn(
        'hover:bg-default-50 transition-colors',
        isSelected && 'bg-primary-50',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  )
}

export function SimpleTableCell({ children, className, isHeader }) {
  const Component = isHeader ? 'th' : 'td'
  return (
    <Component 
      className={cn(
        'px-4 py-3 text-left',
        isHeader 
          ? 'text-xs font-semibold text-default-600 uppercase tracking-wider' 
          : 'text-sm text-default-700',
        className
      )}
    >
      {children}
    </Component>
  )
}

export default {
  HRMSTable,
  HRMSTableHeader,
  HRMSTableBody,
  HRMSTableColumn,
  HRMSTableRow,
  HRMSTableCell,
  StatusBadge,
  PaginatedTable,
  SimpleTable,
  SimpleTableHead,
  SimpleTableBody,
  SimpleTableRow,
  SimpleTableCell,
}
