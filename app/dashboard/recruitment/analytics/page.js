'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Chip, Card, CardBody, CardHeader, Skeleton } from '@heroui/react';
import toast from '@/utils/toast';
import {
  FaArrowLeft, FaBriefcase, FaUsers, FaCheckCircle, FaChartBar,
  FaClock, FaPercentage, FaTrophy, FaCalendarAlt
} from 'react-icons/fa';

const STAGE_COLOR = {
  applied: '#3B82F6', screening: '#8B5CF6', shortlisted: '#F59E0B',
  interview: '#2563EB', assessment: '#7C3AED', offer: '#10B981',
  hired: '#059669', rejected: '#EF4444', withdrawn: '#6B7280',
};

export default function RecruitmentAnalyticsPage() {
  const router = useRouter();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAnalytics(); }, []);

  const fetchAnalytics = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/recruitment/analytics', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setAnalytics(data.data);
      } else {
        toast.error(data.message || 'Failed to load analytics');
      }
    } catch (error) {
      console.error('Analytics error:', error);
      toast.error('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="space-y-4 sm:space-y-6">
          <Skeleton className="h-10 w-56 rounded-lg" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
          </div>
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="page-container">
        <Card shadow="sm">
          <CardBody className="p-8 sm:p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-default-100 flex items-center justify-center mx-auto mb-4">
              <FaChartBar className="w-7 h-7 text-default-400" />
            </div>
            <h1 className="text-2xl font-bold text-default-800 mb-2">No Analytics Data</h1>
            <Button color="primary" onPress={() => router.push('/dashboard/recruitment')}>
              Back to Recruitment
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  const { overview, pipeline, sources, departments, interviews: interviewStats } = analytics;

  return (
    <div className="page-container">
      <div className="space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button isIconOnly variant="light" size="sm" onPress={() => router.push('/dashboard/recruitment')}>
            <FaArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-default-800">Recruitment Analytics</h1>
            <p className="text-sm text-default-500">Overview of your hiring metrics</p>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {[
            { label: 'Total Jobs', value: overview.totalJobs, icon: FaBriefcase, iconColor: 'text-primary', bgColor: 'bg-primary-50' },
            { label: 'Open Jobs', value: overview.openJobs, icon: FaBriefcase, iconColor: 'text-success', bgColor: 'bg-success-50' },
            { label: 'Total Candidates', value: overview.totalCandidates, icon: FaUsers, iconColor: 'text-secondary', bgColor: 'bg-secondary-50' },
            { label: 'Hired', value: overview.hiredCount, icon: FaCheckCircle, iconColor: 'text-success', bgColor: 'bg-success-50' },
            { label: 'Conversion Rate', value: `${overview.conversionRate}%`, icon: FaPercentage, iconColor: 'text-warning', bgColor: 'bg-warning-50' },
            { label: 'Avg Time to Hire', value: `${overview.avgTimeToHire}d`, icon: FaClock, iconColor: 'text-secondary', bgColor: 'bg-secondary-50' },
          ].map((metric) => (
            <Card key={metric.label} shadow="sm">
              <CardBody className="p-3 sm:p-4">
                <div className={`w-9 h-9 rounded-lg ${metric.bgColor} flex items-center justify-center mb-3`}>
                  <metric.icon className={`w-4 h-4 ${metric.iconColor}`} />
                </div>
                <p className="text-2xl font-bold text-default-800">{metric.value}</p>
                <p className="text-xs text-default-500 mt-0.5">{metric.label}</p>
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Pipeline Breakdown */}
          <Card shadow="sm">
            <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
              <h3 className="text-base font-semibold text-default-800">Pipeline Breakdown</h3>
            </CardHeader>
            <CardBody className="p-4 sm:p-5">
              {pipeline?.length > 0 ? (
                <div className="space-y-3">
                  {pipeline.map((stage) => {
                    const total = pipeline.reduce((s, p) => s + p.count, 0) || 1;
                    const pct = Math.round((stage.count / total) * 100);
                    return (
                      <div key={stage._id} className="flex items-center gap-3">
                        <span className="w-24 text-sm text-default-600 capitalize">{stage._id}</span>
                        <div className="flex-1 h-6 bg-default-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: STAGE_COLOR[stage._id] || '#6B7280',
                              minWidth: stage.count > 0 ? '24px' : '0',
                            }}
                          />
                        </div>
                        <span className="text-sm font-medium text-default-800 w-10 text-right">{stage.count}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-default-400">No pipeline data yet</p>
              )}
            </CardBody>
          </Card>

          {/* Source Breakdown */}
          <Card shadow="sm">
            <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
              <h3 className="text-base font-semibold text-default-800">Candidate Sources</h3>
            </CardHeader>
            <CardBody className="p-4 sm:p-5">
              {sources?.length > 0 ? (
                <div className="space-y-3">
                  {sources.map((source) => (
                    <div key={source._id} className="flex items-center justify-between p-2.5 bg-default-50 rounded-lg">
                      <span className="text-sm text-default-700 capitalize">{source._id || 'Unknown'}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-default-800">{source.count}</span>
                        <span className="text-xs text-default-400">({source.hired || 0} hired)</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-default-400">No source data yet</p>
              )}
            </CardBody>
          </Card>

          {/* Department Hiring */}
          <Card shadow="sm">
            <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
              <h3 className="text-base font-semibold text-default-800">Hiring by Department</h3>
            </CardHeader>
            <CardBody className="p-4 sm:p-5">
              {departments?.length > 0 ? (
                <div className="space-y-3">
                  {departments.map((dept) => (
                    <div key={dept._id} className="flex items-center justify-between p-2.5 bg-default-50 rounded-lg">
                      <span className="text-sm text-default-700">{dept.departmentName || dept._id}</span>
                      <div className="flex items-center gap-3">
                        <Chip size="sm" variant="flat" color="primary">{dept.totalJobs} jobs</Chip>
                        <Chip size="sm" variant="flat" color="success">{dept.totalHired} hired</Chip>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-default-400">No department data yet</p>
              )}
            </CardBody>
          </Card>

          {/* Interview Stats */}
          <Card shadow="sm">
            <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
              <h3 className="text-base font-semibold text-default-800">Interview Statistics</h3>
            </CardHeader>
            <CardBody className="p-4 sm:p-5">
              {interviewStats ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-primary-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-primary">{interviewStats.total || 0}</p>
                    <p className="text-xs text-default-500 mt-0.5">Total Interviews</p>
                  </div>
                  <div className="p-3 bg-success-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-success">{interviewStats.completed || 0}</p>
                    <p className="text-xs text-default-500 mt-0.5">Completed</p>
                  </div>
                  <div className="p-3 bg-warning-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-warning">{interviewStats.scheduled || 0}</p>
                    <p className="text-xs text-default-500 mt-0.5">Scheduled</p>
                  </div>
                  <div className="p-3 bg-secondary-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-secondary">
                      {interviewStats.avgRating ? interviewStats.avgRating.toFixed(1) : '—'}
                    </p>
                    <p className="text-xs text-default-500 mt-0.5">Avg Rating</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-default-400">No interview data yet</p>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Offer Acceptance */}
        {overview.offerAcceptanceRate !== undefined && (
          <Card shadow="sm">
            <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
              <h3 className="text-base font-semibold text-default-800">Offer Metrics</h3>
            </CardHeader>
            <CardBody className="p-4 sm:p-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-success-50 rounded-xl text-center">
                  <p className="text-3xl font-bold text-success">{overview.offerAcceptanceRate}%</p>
                  <p className="text-sm text-default-600 mt-1">Offer Acceptance Rate</p>
                </div>
                <div className="p-4 bg-primary-50 rounded-xl text-center">
                  <p className="text-3xl font-bold text-primary">{overview.conversionRate}%</p>
                  <p className="text-sm text-default-600 mt-1">Application to Hire Rate</p>
                </div>
                <div className="p-4 bg-secondary-50 rounded-xl text-center">
                  <p className="text-3xl font-bold text-secondary">{overview.avgTimeToHire}</p>
                  <p className="text-sm text-default-600 mt-1">Avg Days to Hire</p>
                </div>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
