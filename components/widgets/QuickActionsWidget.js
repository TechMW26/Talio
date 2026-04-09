'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@heroui/react'
import { FaUser, FaCalendar, FaDollarSign, FaTasks, FaFileAlt, FaPlane } from 'react-icons/fa'
import { useCompanyFeatures } from '@/contexts/CompanyFeaturesContext'

export default function QuickActionsWidget() {
    const router = useRouter()
    const { isFeatureEnabled } = useCompanyFeatures()

    const actions = [
        { icon: FaCalendar, label: 'Request Leave', path: '/dashboard/leave/requests', color: 'primary', featureKey: 'leaveManagement' },
        { icon: FaTasks, label: 'My Tasks', path: '/dashboard/projects', color: 'secondary', featureKey: 'projects' },
        { icon: FaDollarSign, label: 'Payroll', path: '/dashboard/payroll', color: 'success', featureKey: 'payroll' },
        { icon: FaPlane, label: 'Travel Request', path: '/dashboard/travel', color: 'warning' },
        { icon: FaFileAlt, label: 'Documents', path: '/dashboard/documents', color: 'default', featureKey: 'documents' },
        { icon: FaUser, label: 'My Profile', path: '/dashboard/profile', color: 'primary' },
    ].filter((action) => !action.featureKey || isFeatureEnabled(action.featureKey))

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="mb-4">
                <h3 className="text-base sm:text-lg font-bold text-default-900">Quick Actions</h3>
            </div>

            <div className="grid grid-cols-2 gap-3 flex-1">
                {actions.map((action, index) => {
                    const Icon = action.icon
                    return (
                        <Button
                            key={index}
                            variant="flat"
                            color={action.color}
                            onPress={() => router.push(action.path)}
                            className="p-4 h-auto flex flex-col items-center gap-2 text-center border border-default-100"
                            radius="lg"
                        >
                            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                                <Icon className="w-5 h-5 text-primary-600" />
                            </div>
                            <span className="text-xs font-medium text-default-700">{action.label}</span>
                        </Button>
                    )
                })}
            </div>
        </div>
    )
}
