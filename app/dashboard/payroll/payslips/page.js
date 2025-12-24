'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { FaMoneyBillWave, FaDownload, FaEye, FaCalendarAlt, FaFilter, FaTimes } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'

export default function PayslipsPage() {
  const [payslips, setPayslips] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedPayslip, setSelectedPayslip] = useState(null)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      const empId = getEmployeeId(parsedUser)
      if (empId) {
        fetchPayslips(empId)
      } else {
        toast.error('Employee information not found. Please logout and login again.')
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
  }, [selectedYear])

  const fetchPayslips = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/payroll/payslips?employeeId=${employeeId}&year=${selectedYear}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        setPayslips(data.data)
      }
    } catch (error) {
      console.error('Fetch payslips error:', error)
      toast.error('Failed to fetch payslips')
    } finally {
      setLoading(false)
    }
  }

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">My Payslips</h1>
          <p className="text-gray-600 mt-1">View and download your salary statements</p>
        </div>
        <div className="flex items-center space-x-4">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {[
          { 
            title: 'Total Payslips', 
            value: payslips.length, 
            color: 'bg-blue-500', 
            icon: FaCalendarAlt 
          },
          { 
            title: 'YTD Gross', 
            value: formatCurrency(payslips.reduce((sum, p) => sum + (p.grossSalary || 0), 0)), 
            color: 'bg-green-500', 
            icon: FaMoneyBillWave 
          },
          { 
            title: 'YTD Deductions', 
            value: formatCurrency(payslips.reduce((sum, p) => sum + (p.totalDeductions || 0), 0)), 
            color: 'bg-red-500', 
            icon: FaMoneyBillWave 
          },
          { 
            title: 'YTD Net Pay', 
            value: formatCurrency(payslips.reduce((sum, p) => sum + (p.netSalary || 0), 0)), 
            color: 'bg-purple-500', 
            icon: FaMoneyBillWave 
          },
        ].map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">{stat.title}</p>
                <h3 className="text-2xl font-bold text-gray-900 mt-2">{stat.value}</h3>
              </div>
              <div className={`${stat.color} p-4 rounded-lg`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Payslips List */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Payslips for {selectedYear}</h3>
        </div>
        {payslips.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <FaMoneyBillWave className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No payslips found for {selectedYear}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Month
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Gross Salary
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Deductions
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Net Salary
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {payslips.map((payslip) => (
                  <tr key={payslip._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {getMonthName(payslip.month)} {payslip.year}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(payslip.grossSalary)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">
                      {formatCurrency(payslip.totalDeductions)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                      {formatCurrency(payslip.netSalary)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        payslip.status === 'paid' ? 'bg-green-100 text-green-800' :
                        payslip.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {payslip.status?.charAt(0).toUpperCase() + payslip.status?.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => {
                            setSelectedPayslip(payslip)
                            setShowModal(true)
                          }}
                          className="text-primary-600 hover:text-primary-900 flex items-center space-x-1"
                        >
                          <FaEye className="w-4 h-4" />
                          <span>View</span>
                        </button>
                        <button
                          onClick={() => downloadPayslip(payslip)}
                          className="text-green-600 hover:text-green-900 flex items-center space-x-1"
                        >
                          <FaDownload className="w-4 h-4" />
                          <span>Download</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payslip Details Modal */}
      {showModal && selectedPayslip && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center style={{ zIndex: 99999 }}">
          <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">
                Payslip - {getMonthName(selectedPayslip.month)} {selectedPayslip.year}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <FaTimes className="w-6 h-6" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Employee Details */}
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Employee Details</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Name:</span>
                    <span className="font-medium">{user?.employeeId?.firstName} {user?.employeeId?.lastName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Employee ID:</span>
                    <span className="font-medium">{user?.employeeId?.employeeCode}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Department:</span>
                    <span className="font-medium">{user?.employeeId?.department?.name || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Designation:</span>
                    <span className="font-medium">{user?.employeeId?.designation?.name || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Earnings */}
              <div className="bg-green-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Earnings</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Basic Salary:</span>
                    <span className="font-medium">{formatCurrency(selectedPayslip.basicSalary)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">HRA:</span>
                    <span className="font-medium">{formatCurrency(selectedPayslip.hra)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Allowances:</span>
                    <span className="font-medium">{formatCurrency(selectedPayslip.allowances)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Overtime:</span>
                    <span className="font-medium">{formatCurrency(selectedPayslip.overtime)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Bonus:</span>
                    <span className="font-medium">{formatCurrency(selectedPayslip.bonus)}</span>
                  </div>
                  <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between font-bold">
                      <span>Gross Salary:</span>
                      <span>{formatCurrency(selectedPayslip.grossSalary)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div className="bg-red-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Deductions</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax:</span>
                    <span className="font-medium">{formatCurrency(selectedPayslip.tax)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">PF:</span>
                    <span className="font-medium">{formatCurrency(selectedPayslip.pf)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">ESI:</span>
                    <span className="font-medium">{formatCurrency(selectedPayslip.esi)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Other Deductions:</span>
                    <span className="font-medium">{formatCurrency(selectedPayslip.otherDeductions)}</span>
                  </div>
                  <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between font-bold">
                      <span>Total Deductions:</span>
                      <span>{formatCurrency(selectedPayslip.totalDeductions)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Net Salary */}
              <div className="bg-blue-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Net Salary</h3>
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">
                    {formatCurrency(selectedPayslip.netSalary)}
                  </div>
                  <p className="text-gray-600 mt-2">Amount to be paid</p>
                  <div className="mt-4">
                    <span className={`px-3 py-1 text-sm font-semibold rounded-full ${
                      selectedPayslip.status === 'paid' ? 'bg-green-100 text-green-800' :
                      selectedPayslip.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {selectedPayslip.status?.charAt(0).toUpperCase() + selectedPayslip.status?.slice(1)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-6 space-x-3">
              <button
                onClick={() => downloadPayslip(selectedPayslip)}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center space-x-2"
              >
                <FaDownload className="w-4 h-4" />
                <span>Download</span>
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
