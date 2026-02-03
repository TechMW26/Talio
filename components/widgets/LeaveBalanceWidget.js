'use client'

import useAuthedSWR from '@/hooks/useAuthedSWR'
import { FaCalendarAlt } from 'react-icons/fa'
import { Card, CardBody, Progress, Skeleton, ScrollShadow } from '@heroui/react'

export default function LeaveBalanceWidget({ employeeId }) {
    const { data, error, isLoading } = useAuthedSWR(
        employeeId ? `/api/leave/balance?employeeId=${employeeId}` : null,
        { refreshInterval: 300_000 }
    )

    const balances = data?.data || []

    if (isLoading) {
        return (
            <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
                <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <Card key={i} className="bg-transparent">
                            <CardBody className="p-3 space-y-2">
                                <Skeleton className="h-4 w-1/2 rounded-lg" />
                                <Skeleton className="h-2 w-full rounded-full" />
                                <Skeleton className="h-3 w-3/4 rounded-lg" />
                            </CardBody>
                        </Card>
                    ))}
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
                <div className="mb-4">
                    <h3 className="text-base sm:text-lg font-bold text-default-900">Leave Balance</h3>
                </div>
                <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-danger-100 flex items-center justify-center mb-3">
                        <svg className="w-6 h-6 text-danger-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <p className="text-sm text-default-500">Unable to load leave balance</p>
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="mb-4">
                <h3 className="text-base sm:text-lg font-bold text-default-900">Leave Balance</h3>
            </div>

            <div className="flex-1 flex flex-col">
                {balances.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 flex-1">
                        <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center mb-3">
                            <FaCalendarAlt className="w-7 h-7 text-primary-400" />
                        </div>
                        <p className="text-sm text-default-500">No leave balance data</p>
                    </div>
                ) : (
                    <ScrollShadow className="space-y-2 flex-1 max-h-[200px]">
                        {balances.map((balance, index) => {
                            const usedPercentage = Math.min(100, ((balance.used || 0) / (balance.total || 1)) * 100)
                            return (
                                <Card
                                    key={balance._id || index}
                                    className="border border-default-100"
                                >
                                    <CardBody className="p-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold text-default-900">
                                                {balance.leaveType?.name || 'Leave'}
                                            </span>
                                            <span className="text-lg font-bold text-primary-600">
                                                {balance.remaining || 0} <span className="text-xs font-normal text-default-500">days</span>
                                            </span>
                                        </div>
                                        <Progress
                                            value={usedPercentage}
                                            color={usedPercentage > 80 ? 'danger' : usedPercentage > 50 ? 'warning' : 'primary'}
                                            size="sm"
                                            className="mb-1"
                                            classNames={{
                                                track: 'bg-default-200',
                                            }}
                                        />
                                        <div className="flex justify-between text-xs text-default-500">
                                            <span>Used: {balance.used || 0}</span>
                                            <span>Total: {balance.total || 0}</span>
                                        </div>
                                    </CardBody>
                                </Card>
                            )
                        })}
                    </ScrollShadow>
                )}
            </div>
        </div>
    )
}
