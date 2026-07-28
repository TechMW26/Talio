'use client'

import { useMemo, useState } from 'react'
import { Button, Card, CardBody, Chip, Input, Skeleton, Textarea } from '@heroui/react'
import { FaArrowLeft, FaCalendarCheck } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import { getLocalDateInputValue } from '@/lib/leaveData'

const statusColors = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'default',
}

export default function SpecialRequestPage({ requestType, title, description }) {
  const router = useRouter()
  const today = useMemo(() => getLocalDateInputValue(), [])
  const user = useMemo(() => getCurrentUser(), [])
  const employeeId = useMemo(() => user ? getEmployeeId(user) : null, [user])
  const isEarlyLeave = requestType === 'early_leave'
  const [form, setForm] = useState({
    startDate: '',
    endDate: '',
    earlyLeaveTime: '',
    reason: '',
    handoverNotes: '',
  })

  const endpoint = employeeId
    ? `/api/leave?employeeId=${employeeId}&requestType=${requestType}`
    : null
  const { data, error, isLoading, mutate } = useAuthedSWR(endpoint)
  const requests = data?.data || []

  const submit = useApiMutation({
    method: 'POST',
    invalidateKeys: [/^\/api\/leave/],
    onSuccess: () => {
      toast.success(`${title} request submitted successfully`)
      setForm({ startDate: '', endDate: '', earlyLeaveTime: '', reason: '', handoverNotes: '' })
      mutate()
    },
    onError: err => toast.error(err.message || `Failed to submit ${title.toLowerCase()} request`),
  })

  const handleSubmit = async event => {
    event.preventDefault()
    const endDate = isEarlyLeave ? form.startDate : form.endDate
    if (!form.startDate || !endDate || endDate < form.startDate) {
      toast.error('Please select valid dates')
      return
    }

    await submit.execute('/api/leave', {
      employee: employeeId,
      requestType,
      startDate: form.startDate,
      endDate,
      earlyLeaveTime: isEarlyLeave ? form.earlyLeaveTime : undefined,
      workFromHome: requestType === 'work_from_home',
      reason: form.reason,
      handoverNotes: form.handoverNotes,
    })
  }

  if (error && !requests.length) {
    return <DataErrorState error={error} onRetry={() => mutate()} />
  }

  return (
    <div className="page-container space-y-6 pb-24 md:pb-6">
      <div className="flex items-center gap-4">
        <Button isIconOnly variant="flat" onPress={() => router.back()}>
          <FaArrowLeft />
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-default-800">{title}</h1>
          <p className="text-default-500 mt-1">{description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <Card shadow="sm" className="xl:col-span-2">
          <CardBody className="p-6">
            <h2 className="text-lg font-semibold mb-5">New request</h2>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <Input
                type="date"
                label={isEarlyLeave ? 'Request Date' : 'Start Date'}
                min={today}
                value={form.startDate}
                onValueChange={startDate => setForm(current => ({
                  ...current,
                  startDate,
                  endDate: isEarlyLeave ? startDate : current.endDate,
                }))}
                isRequired
              />
              {!isEarlyLeave && (
                <Input
                  type="date"
                  label="End Date"
                  min={form.startDate || today}
                  value={form.endDate}
                  onValueChange={endDate => setForm(current => ({ ...current, endDate }))}
                  isRequired
                />
              )}
              {isEarlyLeave && (
                <Input
                  type="time"
                  label="Leave Office At"
                  value={form.earlyLeaveTime}
                  onValueChange={earlyLeaveTime => setForm(current => ({ ...current, earlyLeaveTime }))}
                  isRequired
                />
              )}
              <Textarea
                label="Reason"
                minRows={3}
                value={form.reason}
                onValueChange={reason => setForm(current => ({ ...current, reason }))}
                isRequired
              />
              <Textarea
                label="Handover Notes (Optional)"
                minRows={2}
                value={form.handoverNotes}
                onValueChange={handoverNotes => setForm(current => ({ ...current, handoverNotes }))}
              />
              <LoadingButton
                color="primary"
                type="submit"
                className="w-full"
                isLoading={submit.isLoading}
              >
                Submit for approval
              </LoadingButton>
            </form>
          </CardBody>
        </Card>

        <Card shadow="sm" className="xl:col-span-3">
          <CardBody className="p-6">
            <h2 className="text-lg font-semibold mb-5">Request history</h2>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(item => <Skeleton key={item} className="h-24 rounded-xl" />)}
              </div>
            ) : requests.length === 0 ? (
              <div className="py-16 text-center text-default-500">
                <FaCalendarCheck className="mx-auto mb-3 text-4xl text-default-300" />
                <p>No {title.toLowerCase()} requests yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map(request => (
                  <div key={request._id} className="rounded-xl border border-default-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-default-800">
                          {new Date(request.startDate).toLocaleDateString()}
                          {!isEarlyLeave
                            && String(request.endDate).slice(0, 10) !== String(request.startDate).slice(0, 10)
                            ? ` – ${new Date(request.endDate).toLocaleDateString()}`
                            : ''}
                        </p>
                        {isEarlyLeave && request.earlyLeaveTime && (
                          <p className="text-sm text-default-500">Leaving at {request.earlyLeaveTime}</p>
                        )}
                      </div>
                      <Chip size="sm" color={statusColors[request.status]} variant="flat">
                        {request.status}
                      </Chip>
                    </div>
                    <p className="mt-3 text-sm text-default-600">{request.reason}</p>
                    {request.rejectionReason && (
                      <p className="mt-2 text-sm text-danger">Reason: {request.rejectionReason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
