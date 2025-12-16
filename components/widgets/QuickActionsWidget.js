'use client'

import { useRouter } from 'next/navigation'
import { FaUser, FaCalendar, FaDollarSign, FaTasks, FaFileAlt, FaPlane, FaBolt } from 'react-icons/fa'

export default function QuickActionsWidget() {
    const router = useRouter()

    const actions = [
        { icon: FaCalendar, label: 'Request Leave', path: '/dashboard/leave/requests', color: 'bg-primary-500' },
        { icon: FaTasks, label: 'My Tasks', path: '/dashboard/projects', color: 'bg-primary-500' },
        { icon: FaDollarSign, label: 'Payroll', path: '/dashboard/payroll', color: 'bg-primary-500' },
        { icon: FaPlane, label: 'Travel Request', path: '/dashboard/travel', color: 'bg-primary-500' },
        { icon: FaFileAlt, label: 'Documents', path: '/dashboard/documents', color: 'bg-primary-500' },
        { icon: FaUser, label: 'My Profile', path: '/dashboard/profile', color: 'bg-primary-500' },
    ]

    return (
        <div className="p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
                <FaBolt className="w-5 h-5 text-primary-500" />
                <h3 className="text-base sm:text-lg font-bold text-gray-800">Quick Actions</h3>
            </div>

            <div className="grid grid-cols-2 gap-2">
                {actions.map((action, index) => {
                    const Icon = action.icon
                    return (
                        <button
                            key={index}
                            onClick={() => router.push(action.path)}
                            className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors flex flex-col items-center gap-2 text-center"
                        >
                            <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                                <Icon className="w-5 h-5 text-primary-600" />
                            </div>
                            <span className="text-xs font-medium text-gray-700">{action.label}</span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
