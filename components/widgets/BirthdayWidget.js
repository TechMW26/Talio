'use client'

import { FaBirthdayCake } from 'react-icons/fa'

export default function BirthdayWidget() {
    return (
        <div className="p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
                <FaBirthdayCake className="w-5 h-5 text-primary-500" />
                <h3 className="text-base sm:text-lg font-bold text-gray-800">Upcoming Birthdays</h3>
            </div>
            <div className="text-center py-6 text-gray-500">
                <FaBirthdayCake className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm">No birthdays this week</p>
            </div>
        </div>
    )
}
