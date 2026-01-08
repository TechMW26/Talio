'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaDownload, FaArrowLeft, FaPrint, FaEnvelope } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function PayslipDetailPage() {
  const params = useParams()
  const router = useRouter()
  const payslipRef = useRef(null)
  const [payroll, setPayroll] = useState(null)
  const [companySettings, setCompanySettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (params.id) {
      fetchPayrollAndSettings()
    }
  }, [params.id])

  const fetchPayrollAndSettings = async () => {
    try {
      const token = localStorage.getItem('token')
      
      const [payrollRes, settingsRes] = await Promise.all([
        fetch(`/api/payroll/${params.id}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        }),
        fetch('/api/settings/company', {
          headers: { 'Authorization': `Bearer ${token}` },
        })
      ])

      const payrollData = await payrollRes.json()
      const settingsData = await settingsRes.json()

      if (payrollData.success) {
        setPayroll(payrollData.data)
      } else {
        toast.error('Failed to load payslip')
        router.back()
      }

      if (settingsData.success) {
        setCompanySettings(settingsData.data)
      }
    } catch (error) {
      console.error('Fetch error:', error)
      toast.error('Failed to load payslip')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0)
  }

  const formatCurrencyPlain = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 0,
    }).format(amount || 0)
  }

  const getMonthName = (month) => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December']
    return months[month - 1]
  }

  const downloadPDF = async () => {
    if (!payroll) return
    
    setDownloading(true)
    
    try {
      const doc = new jsPDF('p', 'mm', 'a4')
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 15
      let yPos = margin

      // Use employee's company for logo and name, fall back to company settings
      const employeeCompany = payroll.employee?.company
      const companyName = employeeCompany?.name || companySettings?.companyName || 'Company'
      const companyLogo = employeeCompany?.logo || companySettings?.companyLogo
      const companyAddress = employeeCompany?.address || companySettings?.companyAddress

      // Try to add logo
      if (companyLogo) {
        try {
          // Create image element to load the logo
          const img = new Image()
          img.crossOrigin = 'anonymous'
          
          await new Promise((resolve, reject) => {
            img.onload = resolve
            img.onerror = reject
            img.src = companyLogo
          })
          
          // Add logo to PDF
          const logoHeight = 15
          const logoWidth = (img.width / img.height) * logoHeight
          doc.addImage(img, 'PNG', margin, yPos, Math.min(logoWidth, 40), logoHeight)
          yPos += logoHeight + 5
        } catch (logoError) {
          console.log('Could not load logo, using text header')
          doc.setFontSize(18)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(31, 41, 55)
          doc.text(companyName, margin, yPos + 10)
          yPos += 15
        }
      } else {
        doc.setFontSize(18)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(31, 41, 55)
        doc.text(companyName, margin, yPos + 10)
        yPos += 15
      }

      // Company address
      if (companyAddress) {
        const addr = companyAddress
        const addressLine = [addr.street, addr.city, addr.state, addr.zipCode].filter(Boolean).join(', ')
        if (addressLine) {
          doc.setFontSize(9)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(107, 114, 128)
          doc.text(addressLine, margin, yPos)
          yPos += 5
        }
      }

      // Title
      yPos += 5
      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(59, 130, 246)
      doc.text('SALARY SLIP', pageWidth / 2, yPos, { align: 'center' })
      
      yPos += 6
      doc.setFontSize(11)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(107, 114, 128)
      doc.text(`${getMonthName(payroll.month)} ${payroll.year}`, pageWidth / 2, yPos, { align: 'center' })

      // Divider line
      yPos += 8
      doc.setDrawColor(229, 231, 235)
      doc.setLineWidth(0.5)
      doc.line(margin, yPos, pageWidth - margin, yPos)

      // Employee details section
      yPos += 10
      doc.setFillColor(249, 250, 251)
      doc.roundedRect(margin, yPos - 3, pageWidth - 2 * margin, 28, 2, 2, 'F')

      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(31, 41, 55)
      
      const employee = payroll.employee || {}
      const col1 = margin + 5
      const col2 = pageWidth / 2 + 5

      doc.text('Employee Name:', col1, yPos + 5)
      doc.text('Employee ID:', col2, yPos + 5)
      doc.text('Department:', col1, yPos + 15)
      doc.text('Designation:', col2, yPos + 15)

      doc.setFont('helvetica', 'normal')
      doc.text(`${employee.firstName || ''} ${employee.lastName || ''}`, col1 + 35, yPos + 5)
      doc.text(employee.employeeCode || 'N/A', col2 + 30, yPos + 5)
      doc.text(employee.department?.name || 'N/A', col1 + 30, yPos + 15)
      doc.text(employee.designation?.title || 'N/A', col2 + 30, yPos + 15)

      yPos += 35

      // Earnings and Deductions tables side by side
      const tableWidth = (pageWidth - 2 * margin - 10) / 2
      const earnings = payroll.earnings || {}
      const deductions = payroll.deductions || {}

      // Earnings table
      const earningsData = [
        ['Basic Salary', formatCurrencyPlain(earnings.basic)],
        ['HRA', formatCurrencyPlain(earnings.hra)],
        ['Conveyance', formatCurrencyPlain(earnings.conveyance)],
        ['Medical Allowance', formatCurrencyPlain(earnings.medicalAllowance)],
        ['Special Allowance', formatCurrencyPlain(earnings.specialAllowance)],
        ['Overtime', formatCurrencyPlain(earnings.overtime)],
        ['Bonus', formatCurrencyPlain(earnings.bonus)],
      ].filter(row => parseFloat(row[1].replace(/,/g, '')) > 0 || row[0] === 'Basic Salary')

      earningsData.push(['Gross Salary', formatCurrencyPlain(payroll.grossSalary)])

      autoTable(doc, {
        startY: yPos,
        head: [['EARNINGS', 'Amount (₹)']],
        body: earningsData,
        theme: 'grid',
        tableWidth: tableWidth,
        margin: { left: margin },
        headStyles: {
          fillColor: [34, 197, 94],
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: {
          fontSize: 9,
        },
        footStyles: {
          fillColor: [220, 252, 231],
          fontStyle: 'bold',
        },
        columnStyles: {
          0: { cellWidth: tableWidth * 0.6 },
          1: { cellWidth: tableWidth * 0.4, halign: 'right' },
        },
        didParseCell: function(data) {
          if (data.row.index === earningsData.length - 1) {
            data.cell.styles.fillColor = [220, 252, 231]
            data.cell.styles.fontStyle = 'bold'
          }
        }
      })

      const earningsTableFinalY = doc.lastAutoTable.finalY
      const deductionsData = [
        ['Provident Fund (PF)', formatCurrencyPlain(deductions.pf)],
        ['ESI', formatCurrencyPlain(deductions.esi)],
        ['Professional Tax', formatCurrencyPlain(deductions.professionalTax)],
        ['TDS', formatCurrencyPlain(deductions.tds)],
        ['Late/Attendance', formatCurrencyPlain(deductions.lateDeduction)],
        ['Loan Repayment', formatCurrencyPlain(deductions.loanRepayment)],
        ['Other', formatCurrencyPlain(deductions.other)],
      ].filter(row => parseFloat(row[1].replace(/,/g, '')) > 0 || row[0] === 'Provident Fund (PF)')

      deductionsData.push(['Total Deductions', formatCurrencyPlain(payroll.totalDeductions)])

      autoTable(doc, {
        startY: yPos,
        head: [['DEDUCTIONS', 'Amount (₹)']],
        body: deductionsData,
        theme: 'grid',
        tableWidth: tableWidth,
        margin: { left: margin + tableWidth + 10 },
        headStyles: {
          fillColor: [239, 68, 68],
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: {
          fontSize: 9,
        },
        columnStyles: {
          0: { cellWidth: tableWidth * 0.6 },
          1: { cellWidth: tableWidth * 0.4, halign: 'right' },
        },
        didParseCell: function(data) {
          if (data.row.index === deductionsData.length - 1) {
            data.cell.styles.fillColor = [254, 226, 226]
            data.cell.styles.fontStyle = 'bold'
          }
        }
      })

      const deductionsTableFinalY = doc.lastAutoTable.finalY
      yPos = Math.max(earningsTableFinalY, deductionsTableFinalY) + 15

      // Net Salary box
      doc.setFillColor(59, 130, 246)
      doc.roundedRect(margin, yPos, pageWidth - 2 * margin, 25, 3, 3, 'F')
      
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'normal')
      doc.text('NET SALARY', pageWidth / 2, yPos + 8, { align: 'center' })
      
      doc.setFontSize(18)
      doc.setFont('helvetica', 'bold')
      doc.text(formatCurrency(payroll.netSalary), pageWidth / 2, yPos + 18, { align: 'center' })

      yPos += 35

      // Attendance Summary
      if (payroll.workingDays !== undefined || payroll.presentDays !== undefined) {
        doc.setFillColor(249, 250, 251)
        doc.roundedRect(margin, yPos, pageWidth - 2 * margin, 20, 2, 2, 'F')

        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(55, 65, 81)
        doc.text('ATTENDANCE SUMMARY', margin + 5, yPos + 7)

        doc.setFont('helvetica', 'normal')
        const attendanceText = `Working Days: ${payroll.workingDays || 26}  |  Present: ${payroll.presentDays || 0}  |  Absent: ${payroll.absentDays || 0}  |  Leave: ${payroll.leaveDays || 0}`
        doc.text(attendanceText, margin + 5, yPos + 15)
        
        yPos += 25
      }

      // Footer
      yPos = pageHeight - 25
      doc.setDrawColor(229, 231, 235)
      doc.line(margin, yPos, pageWidth - margin, yPos)
      
      yPos += 8
      doc.setFontSize(8)
      doc.setTextColor(156, 163, 175)
      doc.text('This is a system-generated salary slip. For any queries, please contact HR.', pageWidth / 2, yPos, { align: 'center' })
      
      yPos += 5
      doc.text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, pageWidth / 2, yPos, { align: 'center' })

      // Save PDF
      const fileName = `Payslip_${employee.employeeCode || 'EMP'}_${getMonthName(payroll.month)}_${payroll.year}.pdf`
      doc.save(fileName)
      
      toast.success('Payslip downloaded successfully!')
    } catch (error) {
      console.error('PDF generation error:', error)
      toast.error('Failed to generate PDF')
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader size="lg" />
      </div>
    )
  }

  if (!payroll) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Payslip not found</p>
        <button onClick={() => router.back()} className="mt-4 btn-primary">
          Go Back
        </button>
      </div>
    )
  }

  const employee = payroll.employee || {}
  const earnings = payroll.earnings || {}
  const deductions = payroll.deductions || {}

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <FaArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              Salary Slip - {getMonthName(payroll.month)} {payroll.year}
            </h1>
            <p className="text-gray-600">
              {employee.firstName} {employee.lastName} ({employee.employeeCode})
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={downloadPDF}
            disabled={downloading}
            className="btn-primary flex items-center space-x-2"
          >
            {downloading ? (
              <>
                <Loader size="xs" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <FaDownload />
                <span>Download PDF</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Payslip Preview */}
      <div ref={payslipRef} className="bg-white rounded-lg shadow-lg overflow-hidden max-w-4xl mx-auto">
        {/* Company Header - Use employee's assigned company */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {(employee.company?.logo || companySettings?.companyLogo) ? (
                <img
                  src={employee.company?.logo || companySettings?.companyLogo}
                  alt={employee.company?.name || companySettings?.companyName}
                  className="h-12 max-w-[120px] object-contain bg-white rounded p-1"
                />
              ) : (
                <h2 className="text-2xl font-bold">{employee.company?.name || companySettings?.companyName || 'Company'}</h2>
              )}
              {/* Show company name alongside logo */}
              {(employee.company?.logo || companySettings?.companyLogo) && (
                <h2 className="text-xl font-bold">{employee.company?.name || companySettings?.companyName || 'Company'}</h2>
              )}
            </div>
            <div className="text-right">
              <h3 className="text-xl font-semibold">SALARY SLIP</h3>
              <p className="opacity-90">{getMonthName(payroll.month)} {payroll.year}</p>
            </div>
          </div>
        </div>

        {/* Status Banner */}
        <div className={`px-6 py-2 text-center text-sm font-medium ${
          payroll.status === 'paid' ? 'bg-green-100 text-green-800' :
          payroll.status === 'processed' ? 'bg-blue-100 text-blue-800' :
          'bg-gray-100 text-gray-800'
        }`}>
          Status: {payroll.status?.toUpperCase()}
        </div>

        <div className="p-6">
          {/* Employee Details */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase">Employee Name</p>
                <p className="font-medium">{employee.firstName} {employee.lastName}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Employee ID</p>
                <p className="font-medium">{employee.employeeCode || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Company</p>
                <p className="font-medium">{employee.company?.name || companySettings?.companyName || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Department</p>
                <p className="font-medium">{employee.department?.name || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Designation</p>
                <p className="font-medium">{employee.designation?.title || 'N/A'}</p>
              </div>
            </div>
          </div>

          {/* Earnings & Deductions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Earnings */}
            <div className="bg-green-50 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-green-800 mb-4 border-b border-green-200 pb-2">
                EARNINGS
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Basic Salary</span>
                  <span className="font-medium">{formatCurrency(earnings.basic)}</span>
                </div>
                <div className="flex justify-between">
                  <span>HRA</span>
                  <span className="font-medium">{formatCurrency(earnings.hra)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Conveyance</span>
                  <span className="font-medium">{formatCurrency(earnings.conveyance)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Medical Allowance</span>
                  <span className="font-medium">{formatCurrency(earnings.medicalAllowance)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Special Allowance</span>
                  <span className="font-medium">{formatCurrency(earnings.specialAllowance)}</span>
                </div>
                {(earnings.overtime || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Overtime</span>
                    <span className="font-medium">{formatCurrency(earnings.overtime)}</span>
                  </div>
                )}
                {(earnings.bonus || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Bonus</span>
                    <span className="font-medium">{formatCurrency(earnings.bonus)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-green-300 pt-2 mt-2">
                  <span className="font-bold">Gross Salary</span>
                  <span className="font-bold text-green-700">{formatCurrency(payroll.grossSalary)}</span>
                </div>
              </div>
            </div>

            {/* Deductions */}
            <div className="bg-red-50 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-red-800 mb-4 border-b border-red-200 pb-2">
                DEDUCTIONS
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Provident Fund (PF)</span>
                  <span className="font-medium">{formatCurrency(deductions.pf)}</span>
                </div>
                <div className="flex justify-between">
                  <span>ESI</span>
                  <span className="font-medium">{formatCurrency(deductions.esi)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Professional Tax</span>
                  <span className="font-medium">{formatCurrency(deductions.professionalTax)}</span>
                </div>
                <div className="flex justify-between">
                  <span>TDS</span>
                  <span className="font-medium">{formatCurrency(deductions.tds)}</span>
                </div>
                {(deductions.lateDeduction || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Late/Attendance</span>
                    <span className="font-medium">{formatCurrency(deductions.lateDeduction)}</span>
                  </div>
                )}
                {(deductions.loanRepayment || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Loan Repayment</span>
                    <span className="font-medium">{formatCurrency(deductions.loanRepayment)}</span>
                  </div>
                )}
                {(deductions.other || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Other</span>
                    <span className="font-medium">{formatCurrency(deductions.other)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-red-300 pt-2 mt-2">
                  <span className="font-bold">Total Deductions</span>
                  <span className="font-bold text-red-700">{formatCurrency(payroll.totalDeductions)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Net Salary */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-6 text-center text-white">
            <p className="text-sm opacity-90 mb-1">NET SALARY</p>
            <p className="text-4xl font-bold">{formatCurrency(payroll.netSalary)}</p>
          </div>

          {/* Attendance Summary */}
          {(payroll.workingDays || payroll.presentDays) && (
            <div className="mt-6 bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">ATTENDANCE SUMMARY</h3>
              <div className="grid grid-cols-4 gap-4 text-center text-sm">
                <div>
                  <p className="text-gray-500">Working Days</p>
                  <p className="font-bold text-lg">{payroll.workingDays || 26}</p>
                </div>
                <div>
                  <p className="text-gray-500">Present</p>
                  <p className="font-bold text-lg text-green-600">{payroll.presentDays || 0}</p>
                </div>
                <div>
                  <p className="text-gray-500">Absent</p>
                  <p className="font-bold text-lg text-red-600">{payroll.absentDays || 0}</p>
                </div>
                <div>
                  <p className="text-gray-500">Leave</p>
                  <p className="font-bold text-lg text-blue-600">{payroll.leaveDays || 0}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 text-center text-xs text-gray-500 border-t">
          <p>This is a system-generated salary slip. For any queries, please contact HR.</p>
          <p className="mt-1">Generated on: {new Date().toLocaleDateString('en-IN')}</p>
        </div>
      </div>
    </div>
  )
}
