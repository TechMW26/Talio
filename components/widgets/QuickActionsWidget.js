'use client'

import widgetStyles from './WidgetDesign.module.css'

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
        <div className={`${widgetStyles.surface} p-4 sm:p-6 flex-1 flex flex-col h-full`}>
            <div className="mb-4">
                <h3 className={`${widgetStyles.title} text-base sm:text-lg font-bold text-default-900`}>Quick Actions</h3>
            </div>

            <div className={`${widgetStyles.quickActionsGrid} grid gap-3 flex-1`}>
                {actions.map((action) => {
                    const Icon = action.icon
                    return (
                        <Button data-widget-card="" data-widget-tone={action.color}
                            key={action.path}
                            variant="flat"
                            color={action.color}
                            onPress={() => router.push(action.path)}
                            className="p-4 sm:p-5 h-auto min-h-[88px] w-full min-w-0 flex flex-row justify-start items-center gap-4 text-left whitespace-normal border border-default-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                            radius="lg"
                        >
                            <div aria-hidden="true" className="w-11 h-11 shrink-0 bg-primary-100 rounded-xl flex items-center justify-center">
                                <Icon className="w-5 h-5 text-primary-600" />
                            </div>
                            <span className="min-w-0 text-base sm:text-lg leading-snug font-semibold text-default-900">{action.label}</span>
                        </Button>
                    )
                })}
            </div>
        </div>
    )
}
