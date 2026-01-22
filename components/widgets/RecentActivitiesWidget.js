'use client'

import { FaHistory } from 'react-icons/fa'

export default function RecentActivitiesWidget() {
    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="mb-4">
                <h3 className="text-base sm:text-lg font-bold text-default-900">Recent Activities</h3>
            </div>
            <div className="flex flex-col items-center justify-center text-center py-6">
                <div className="w-14 h-14 rounded-full bg-default-100 flex items-center justify-center mb-3">
                    <FaHistory className="w-7 h-7 text-default-400" />
                </div>
                <p className="text-sm text-default-500">No recent activities</p>
            </div>
        </div>
    )
}
