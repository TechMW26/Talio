'use client'

import { FaFileAlt, FaDownload, FaChartBar } from 'react-icons/fa'
import { Button, Select, SelectItem, Card, CardBody, Input } from '@heroui/react'
import MobilePageWrapper, { MobileGrid } from '@/components/mobile/MobileComponents'

export default function ReportsPage() {
  const reports = [
    {
      id: 1,
      name: 'Attendance Report',
      description: 'Monthly attendance summary for all employees',
      category: 'Attendance',
      icon: FaChartBar,
    },
    {
      id: 2,
      name: 'Leave Report',
      description: 'Leave balance and usage report',
      category: 'Leave',
      icon: FaFileAlt,
    },
    {
      id: 3,
      name: 'Payroll Report',
      description: 'Monthly payroll summary and breakdown',
      category: 'Payroll',
      icon: FaFileAlt,
    },
    {
      id: 4,
      name: 'Performance Report',
      description: 'Employee performance reviews and ratings',
      category: 'Performance',
      icon: FaChartBar,
    },
    {
      id: 5,
      name: 'Recruitment Report',
      description: 'Hiring statistics and candidate pipeline',
      category: 'Recruitment',
      icon: FaFileAlt,
    },
    {
      id: 6,
      name: 'Employee Directory',
      description: 'Complete list of all employees with details',
      category: 'Employee',
      icon: FaFileAlt,
    },
  ]

  return (
    <MobilePageWrapper
      title="Reports"
      subtitle="Generate and download various reports"
    >
      {/* Reports Grid */}
      <MobileGrid cols={3} className="mb-8">
        {reports.map((report) => {
          const Icon = report.icon
          return (
            <div
              key={report.id}
              className="bg-white rounded-lg shadow-md p-4 sm:p-6 hover:shadow-lg transition-all duration-200 cursor-pointer active:scale-95"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-primary-100 rounded-lg">
                  <Icon className="text-2xl text-primary-500" />
                </div>
                <span className="px-3 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                  {report.category}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">
                {report.name}
              </h3>
              <p className="text-sm text-gray-600 mb-4">{report.description}</p>
              <Button color="primary" className="w-full" startContent={<FaDownload className="w-4 h-4" />}>
                Generate Report
              </Button>
            </div>
          )
        })}
      </MobileGrid>

      {/* Custom Report Section */}
      <Card className="mb-8">
        <CardBody className="p-6">
          <h2 className="text-xl font-bold text-default-800 mb-4">Custom Report</h2>
          <p className="text-sm text-default-500 mb-6">
            Create a custom report with specific parameters
          </p>
          <MobileGrid cols={3} className="mb-6">
            <div>
              <Select
                label="Report Type"
                placeholder="Select Type"
                aria-label="Report Type"
              >
                <SelectItem key="attendance">Attendance</SelectItem>
                <SelectItem key="leave">Leave</SelectItem>
                <SelectItem key="payroll">Payroll</SelectItem>
                <SelectItem key="performance">Performance</SelectItem>
              </Select>
            </div>
            <div>
              <Input
                type="date"
                label="Start Date"
              />
            </div>
            <div>
              <Input
                type="date"
                label="End Date"
              />
            </div>
          </MobileGrid>
          <div className="flex justify-end">
            <Button color="primary" startContent={<FaDownload className="w-4 h-4" />}>
              Generate Custom Report
            </Button>
          </div>
        </CardBody>
      </Card>
    </MobilePageWrapper>
  )
}

