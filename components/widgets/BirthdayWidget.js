'use client'

import widgetStyles from './WidgetDesign.module.css'

import { FaBirthdayCake } from 'react-icons/fa'

export default function BirthdayWidget() {
    return (
        <div className={`${widgetStyles.surface} p-4 sm:p-6 flex-1 flex flex-col h-full`}>
            <div className="mb-4">
                <h3 className={`${widgetStyles.title} text-base sm:text-lg font-bold text-default-900`}>Upcoming Birthdays</h3>
            </div>
            <div className="flex flex-col items-center justify-center text-center py-6">
                <div className="w-14 h-14 rounded-full bg-warning-100 flex items-center justify-center mb-3">
                    <FaBirthdayCake className="w-7 h-7 text-warning-500" />
                </div>
                <p className="text-sm text-default-500">No birthdays this week</p>
            </div>
        </div>
    )
}
