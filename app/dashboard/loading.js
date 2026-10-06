import PageSkeleton from '@/components/ui/PageSkeleton'

export default function DashboardLoading() {
  return <div role="status" aria-label="Loading page"><PageSkeleton showLoader={false} /></div>
}
