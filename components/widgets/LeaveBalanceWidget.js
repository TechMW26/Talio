'use client'

import { useState, useEffect } from 'react'
import { FaCalendarAlt } from 'react-icons/fa'

export default function LeaveBalanceWidget({ employeeId }) {
    const [balances, setBalances] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (employeeId) {
            fetchLeaveBalance()
        }
    }, [employeeId])

    const fetchLeaveBalance = async () => {
        try {
            const token = localStorage.getItem('token')
            const response = await fetch(`/api/leave/balance?employeeId=${employeeId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            const data = await response.json()
            if (data.success) {
                setBalances(data.data || [])
            }
        } catch (error) {
            console.error('Error fetching leave balance:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="p-4 sm:p-6 animate-pulse flex-1 flex flex-col h-full">
                <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-16 bg-gray-200 rounded"></div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="mb-4">
                <h3 className="text-base sm:text-lg font-bold text-gray-800">Leave Balance</h3>
            </div>

            <div className="flex-1 flex flex-col">
                {balances.length === 0 ? (
                    <div className="text-center py-6 text-gray-500 flex-1 flex flex-col justify-center">
                        <FaCalendarAlt className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <p className="text-sm">No leave balance data</p>
                    </div>
                ) : (
                    <div className="space-y-2 overflow-y-auto flex-1 max-h-[200px]">
                        {balances.map((balance, index) => (
                            <div
                                key={balance._id || index}
                                className="p-3 bg-gray-50 rounded-lg"
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-gray-800">{balance.leaveType?.name || 'Leave'}</span>
                                    <span className="text-lg font-bold text-primary-600">{balance.remaining || 0} days</span>
                                </div>
                                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary-500 rounded-full transition-all"
                                        style={{
                                            width: `${Math.min(100, ((balance.used || 0) / (balance.total || 1)) * 100)}%`
                                        }}
                                    />
                                </div>
                                <div className="flex justify-between mt-1 text-xs text-gray-500">
                                    <span>Used: {balance.used || 0}</span>
                                    <span>Total: {balance.total || 0}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
