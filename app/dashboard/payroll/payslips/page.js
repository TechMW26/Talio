'use client'

import { useState, useMemo } from 'react'
import toast from '@/utils/toast'
import { FaMoneyBillWave, FaDownload, FaEye, FaCalendarAlt, FaFilter, FaTimes } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import { useDisclosure, Divider, Chip, Skeleton } from '@heroui/react'
import { HRMSCard, HRMSCardHeader, HRMSCardBody, KPICard } from '@/components/ui/heroui/Card'
import { HRMSSelect, HRMSSelectItem } from '@/components/ui/heroui/Input'
import { PrimaryButton, SecondaryButton, GhostButton } from '@/components/ui/heroui/Button'
import { HRMSTable, HRMSTableHeader, HRMSTableColumn, HRMSTableBody, HRMSTableRow, HRMSTableCell, StatusBadge } from '@/components/ui/heroui/Table'
import { HRMSModal, HRMSModalContent, HRMSModalHeader, HRMSModalBody, HRMSModalFooter } from '@/components/ui/heroui/Modal'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function PayslipsPage() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedPayslip, setSelectedPayslip] = useState(null)
  const { isOpen: showModal, onOpen: openModal, onClose: closeModal } = useDisclosure()

  const user = useMemo(() => getCurrentUser(), [])
  const empId = useMemo(() => user ? getEmployeeId(user) : null, [user])

  // SWR: fetch payslips (re-fetches when selectedYear changes via the key)
  const { data: res, error, isLoading, isValidating, mutate: refresh } = useAuthedSWR(
    empId ? `/api/payroll/payslips?employeeId=${empId}&year=${selectedYear}` : null
  )
  const payslips = res?.data || []

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR'
    }).format(amount || 0)
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const getMonthName = (month) => {
    return new Date(0, month - 1).toLocaleString('en-US', { month: 'long' })
  }

  const downloadPayslip = (payslip) => {
    // Generate a simple text-based payslip
    const content = `
PAYSLIP - ${getMonthName(payslip.month)} ${payslip.year}
=====================================

Employee: ${user.employeeId.firstName} ${user.employeeId.lastName}
Employee ID: ${user.employeeId.employeeCode}
Department: ${user.employeeId.department?.name || 'N/A'}
Designation: ${user.employeeId.designation?.name || 'N/A'}

EARNINGS:
---------
Basic Salary: ${formatCurrency(payslip.basicSalary)}
HRA: ${formatCurrency(payslip.hra)}
Allowances: ${formatCurrency(payslip.allowances)}
Overtime: ${formatCurrency(payslip.overtime)}
Bonus: ${formatCurrency(payslip.bonus)}

Gross Salary: ${formatCurrency(payslip.grossSalary)}

DEDUCTIONS:
-----------
Tax: ${formatCurrency(payslip.tax)}
PF: ${formatCurrency(payslip.pf)}
ESI: ${formatCurrency(payslip.esi)}
Other Deductions: ${formatCurrency(payslip.otherDeductions)}

Total Deductions: ${formatCurrency(payslip.totalDeductions)}

NET SALARY: ${formatCurrency(payslip.netSalary)}

Generated on: ${new Date().toLocaleDateString()}
    `

    const blob = new Blob([content], { type: 'text/plain' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payslip-${payslip.month}-${payslip.year}.txt`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 pb-20 md:pb-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <Skeleton className="h-8 w-40 rounded-lg mb-2" />
            <Skeleton className="h-4 w-64 rounded-lg" />
          </div>
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4">
              <Skeleton className="h-4 w-24 rounded mb-3" />
              <Skeleton className="h-7 w-20 rounded" />
            </div>
          ))}
        </div>
        <HRMSCard>
          <HRMSCardHeader>
            <Skeleton className="h-6 w-48 rounded" />
          </HRMSCardHeader>
          <Divider />
          <HRMSCardBody className="p-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3">
                <Skeleton className="h-5 w-32 rounded" />
                <Skeleton className="h-5 w-24 rounded" />
                <Skeleton className="h-5 w-24 rounded" />
                <Skeleton className="h-5 w-24 rounded" />
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-8 w-24 rounded" />
              </div>
            ))}
          </HRMSCardBody>
        </HRMSCard>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 sm:p-6 pb-20 md:pb-6">
        <DataErrorState message="Failed to load payslips" onRetry={() => refresh()} />
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-6 pb-20 md:pb-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">My Payslips</h1>
          <p className="text-default-500 mt-1">View and download your salary statements <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" /></p>
        </div>
        <div className="flex items-center gap-4">
          <HRMSSelect
            label="Year"
            size="sm"
            className="w-32"
            selectedKeys={[selectedYear.toString()]}
            onSelectionChange={(keys) => setSelectedYear(parseInt(Array.from(keys)[0]))}
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(year => (
              <HRMSSelectItem key={year.toString()} textValue={year.toString()}>{year}</HRMSSelectItem>
            ))}
          </HRMSSelect>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title="Total Payslips"
          value={payslips.length}
          icon={<FaCalendarAlt />}
          color="primary"
        />
        <KPICard
          title="YTD Gross"
          value={formatCurrency(payslips.reduce((sum, p) => sum + (p.grossSalary || 0), 0))}
          icon={<FaMoneyBillWave />}
          color="success"
        />
        <KPICard
          title="YTD Deductions"
          value={formatCurrency(payslips.reduce((sum, p) => sum + (p.totalDeductions || 0), 0))}
          icon={<FaMoneyBillWave />}
          color="danger"
        />
        <KPICard
          title="YTD Net Pay"
          value={formatCurrency(payslips.reduce((sum, p) => sum + (p.netSalary || 0), 0))}
          icon={<FaMoneyBillWave />}
          color="secondary"
        />
      </div>

      {/* Payslips List */}
      <HRMSCard>
        <HRMSCardHeader>
          <h3 className="text-lg font-semibold text-foreground">Payslips for {selectedYear}</h3>
        </HRMSCardHeader>
        <Divider />
        <HRMSCardBody className="p-0">
          {payslips.length === 0 ? (
            <div className="p-8 text-center text-default-500">
              <FaMoneyBillWave className="w-12 h-12 mx-auto mb-4 text-default-300" />
              <p>No payslips found for {selectedYear}</p>
            </div>
          ) : (
            <HRMSTable aria-label="Payslips table">
              <HRMSTableHeader>
                <HRMSTableColumn>Month</HRMSTableColumn>
                <HRMSTableColumn>Gross Salary</HRMSTableColumn>
                <HRMSTableColumn>Deductions</HRMSTableColumn>
                <HRMSTableColumn>Net Salary</HRMSTableColumn>
                <HRMSTableColumn>Status</HRMSTableColumn>
                <HRMSTableColumn>Actions</HRMSTableColumn>
              </HRMSTableHeader>
              <HRMSTableBody>
                {payslips.map((payslip) => (
                  <HRMSTableRow key={payslip._id}>
                    <HRMSTableCell>
                      <span className="font-medium text-foreground">
                        {getMonthName(payslip.month)} {payslip.year}
                      </span>
                    </HRMSTableCell>
                    <HRMSTableCell>
                      <span className="text-foreground">{formatCurrency(payslip.grossSalary)}</span>
                    </HRMSTableCell>
                    <HRMSTableCell>
                      <span className="text-danger">{formatCurrency(payslip.totalDeductions)}</span>
                    </HRMSTableCell>
                    <HRMSTableCell>
                      <span className="font-medium text-success">{formatCurrency(payslip.netSalary)}</span>
                    </HRMSTableCell>
                    <HRMSTableCell>
                      <StatusBadge status={payslip.status || 'pending'} />
                    </HRMSTableCell>
                    <HRMSTableCell>
                      <div className="flex items-center gap-2">
                        <GhostButton
                          size="sm"
                          onPress={() => {
                            setSelectedPayslip(payslip)
                            openModal()
                          }}
                          startContent={<FaEye className="w-4 h-4" />}
                        >
                          View
                        </GhostButton>
                        <GhostButton
                          size="sm"
                          color="success"
                          onPress={() => downloadPayslip(payslip)}
                          startContent={<FaDownload className="w-4 h-4" />}
                        >
                          Download
                        </GhostButton>
                      </div>
                    </HRMSTableCell>
                  </HRMSTableRow>
                ))}
              </HRMSTableBody>
            </HRMSTable>
          )}
        </HRMSCardBody>
      </HRMSCard>

      {/* Payslip Details Modal */}
      <HRMSModal isOpen={showModal} onClose={closeModal} size="4xl">
        <HRMSModalContent>
          {selectedPayslip && (
            <>
              <HRMSModalHeader>
                <h2 className="text-xl font-bold text-foreground">
                  Payslip - {getMonthName(selectedPayslip.month)} {selectedPayslip.year}
                </h2>
              </HRMSModalHeader>
              <HRMSModalBody>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Employee Details */}
                  <div className="bg-default-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Employee Details</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-default-500">Name:</span>
                        <span className="font-medium text-foreground">{user?.employeeId?.firstName} {user?.employeeId?.lastName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-500">Employee ID:</span>
                        <span className="font-medium text-foreground">{user?.employeeId?.employeeCode}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-500">Department:</span>
                        <span className="font-medium text-foreground">{user?.employeeId?.department?.name || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-500">Designation:</span>
                        <span className="font-medium text-foreground">{user?.employeeId?.designation?.name || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Earnings */}
                  <div className="bg-success-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Earnings</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-default-600">Basic Salary:</span>
                        <span className="font-medium text-foreground">{formatCurrency(selectedPayslip.basicSalary)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-600">HRA:</span>
                        <span className="font-medium text-foreground">{formatCurrency(selectedPayslip.hra)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-600">Allowances:</span>
                        <span className="font-medium text-foreground">{formatCurrency(selectedPayslip.allowances)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-600">Overtime:</span>
                        <span className="font-medium text-foreground">{formatCurrency(selectedPayslip.overtime)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-600">Bonus:</span>
                        <span className="font-medium text-foreground">{formatCurrency(selectedPayslip.bonus)}</span>
                      </div>
                      <Divider className="my-2" />
                      <div className="flex justify-between font-bold">
                        <span>Gross Salary:</span>
                        <span className="text-success">{formatCurrency(selectedPayslip.grossSalary)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Deductions */}
                  <div className="bg-danger-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Deductions</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-default-600">Tax:</span>
                        <span className="font-medium text-foreground">{formatCurrency(selectedPayslip.tax)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-600">PF:</span>
                        <span className="font-medium text-foreground">{formatCurrency(selectedPayslip.pf)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-600">ESI:</span>
                        <span className="font-medium text-foreground">{formatCurrency(selectedPayslip.esi)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-600">Other Deductions:</span>
                        <span className="font-medium text-foreground">{formatCurrency(selectedPayslip.otherDeductions)}</span>
                      </div>
                      <Divider className="my-2" />
                      <div className="flex justify-between font-bold">
                        <span>Total Deductions:</span>
                        <span className="text-danger">{formatCurrency(selectedPayslip.totalDeductions)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Net Salary */}
                  <div className="bg-primary-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Net Salary</h3>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-primary">
                        {formatCurrency(selectedPayslip.netSalary)}
                      </div>
                      <p className="text-default-500 mt-2">Amount to be paid</p>
                      <div className="mt-4">
                        <StatusBadge status={selectedPayslip.status || 'pending'} />
                      </div>
                    </div>
                  </div>
                </div>
              </HRMSModalBody>
              <HRMSModalFooter>
                <PrimaryButton
                  color="success"
                  onPress={() => downloadPayslip(selectedPayslip)}
                  startContent={<FaDownload className="w-4 h-4" />}
                >
                  Download
                </PrimaryButton>
                <SecondaryButton onPress={closeModal}>
                  Close
                </SecondaryButton>
              </HRMSModalFooter>
            </>
          )}
        </HRMSModalContent>
      </HRMSModal>
    </div>
  )
}
