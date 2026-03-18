'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button, Input, Select, SelectItem, Chip, Tooltip, Pagination,
  Card, CardBody, CardHeader, Skeleton
} from '@heroui/react';
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext';
import useAuthedSWR from '@/hooks/useAuthedSWR';
import { DataErrorState } from '@/components/ui/ErrorBoundary';
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator';
import {
  FaPlus, FaBriefcase, FaMapMarkerAlt, FaClock, FaUsers,
  FaSearch, FaChartBar, FaEye, FaEdit, FaCalendarAlt,
  FaCheckCircle
} from 'react-icons/fa';

const STATUS_COLOR_MAP = {
  open: 'success',
  draft: 'default',
  'on-hold': 'warning',
  closed: 'danger',
  cancelled: 'danger',
};

const EMPLOYMENT_TYPE_LABELS = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  freelance: 'Freelance',
};

export default function RecruitmentPage() {
  const router = useRouter();
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    department: '',
    employmentType: '',
    page: 1,
  });

  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } }, []);
  const { socket, isConnected, subscribe } = useSocket();

  // SWR: Jobs with pagination + filters
  const jobsParams = useMemo(() => {
    const params = new URLSearchParams({ page: filters.page, limit: 10 });
    if (filters.search) params.set('search', filters.search);
    if (filters.status) params.set('status', filters.status);
    if (filters.department) params.set('department', filters.department);
    if (filters.employmentType) params.set('employmentType', filters.employmentType);
    return params.toString();
  }, [filters]);
  const { data: jobsRes, error: jobsError, isLoading: jobsLoading, isValidating, mutate: refreshJobs } = useAuthedSWR(`/api/recruitment?${jobsParams}`);
  const jobs = jobsRes?.data || [];
  const pagination = jobsRes?.pagination || { total: 0, pages: 1 };

  // SWR: Departments
  const { data: deptsRes } = useAuthedSWR('/api/departments');
  const departments = deptsRes?.data || [];

  // SWR: Stats
  const { data: statsRes, mutate: refreshStats } = useAuthedSWR('/api/recruitment/analytics');
  const stats = statsRes?.data?.overview || null;

  // Socket: real-time updates
  useEffect(() => {
    if (!socket || !isConnected) return;
    const handleUpdate = () => { refreshJobs(); refreshStats(); };
    const unsub = subscribe ? subscribe(REALTIME_EVENTS.RECRUITMENT_UPDATE, handleUpdate) : undefined;
    return () => { if (unsub) unsub(); };
  }, [socket, isConnected]);

  const canManage = user && ['admin', 'hr', 'manager'].includes(user.role);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: key === 'page' ? value : 1 }));
  };

  if (jobsError) {
    return <DataErrorState message="Failed to load jobs" onRetry={() => refreshJobs()} />;
  }

  if (jobsLoading && jobs.length === 0) {
    return (
      <div className="page-container">
        <div className="space-y-4 sm:space-y-6">
          <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-2">
            <Skeleton className="h-10 w-48 rounded-lg" />
            <Skeleton className="h-10 w-64 rounded-lg mt-3 md:mt-0" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <Skeleton className="h-16 rounded-xl" />
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex md:justify-between md:items-center md:flex-row flex-col">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-default-800">Recruitment</h1>
            <p className="text-sm sm:text-base text-default-500 mt-1">Manage job postings and candidates {' '}<BackgroundRefreshIndicator isValidating={isValidating} /></p>
          </div>
          <div className="flex items-center flex-wrap gap-2 mt-4 md:mt-0">
            <Button size="sm" variant="flat" onPress={() => router.push('/dashboard/recruitment/candidates')} startContent={<FaUsers className="w-3.5 h-3.5" />}>
              Candidates
            </Button>
            <Button size="sm" variant="flat" onPress={() => router.push('/dashboard/recruitment/interviews')} startContent={<FaCalendarAlt className="w-3.5 h-3.5" />}>
              Interviews
            </Button>
            <Button size="sm" variant="flat" onPress={() => router.push('/dashboard/recruitment/analytics')} startContent={<FaChartBar className="w-3.5 h-3.5" />}>
              Analytics
            </Button>
            {canManage && (
              <Button color="primary" onPress={() => router.push('/dashboard/recruitment/create')} startContent={<FaPlus className="w-4 h-4" />}>
                Create Job
              </Button>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[
              { label: 'Total Jobs', value: stats.totalJobs || 0, icon: FaBriefcase, iconColor: 'text-primary', bgColor: 'bg-primary-50' },
              { label: 'Open Positions', value: stats.openJobs || 0, icon: FaCheckCircle, iconColor: 'text-success', bgColor: 'bg-success-50' },
              { label: 'Total Candidates', value: stats.totalCandidates || 0, icon: FaUsers, iconColor: 'text-secondary', bgColor: 'bg-secondary-50' },
              { label: 'Hired', value: stats.hiredCount || 0, icon: FaUsers, iconColor: 'text-success', bgColor: 'bg-success-50' },
            ].map((stat) => (
              <Card key={stat.label} shadow="sm">
                <CardBody className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs sm:text-sm font-medium text-default-600 truncate">{stat.label}</h3>
                    <div className={`w-8 h-8 rounded-lg ${stat.bgColor} flex items-center justify-center`}>
                      <stat.icon className={`w-3.5 h-3.5 ${stat.iconColor}`} />
                    </div>
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold text-default-800">{stat.value}</div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <Card shadow="sm">
          <CardBody className="p-3 sm:p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Input
                size="sm" placeholder="Search jobs..."
                value={filters.search}
                onValueChange={(v) => updateFilter('search', v)}
                startContent={<FaSearch className="w-3 h-3 text-default-400" />}
                isClearable onClear={() => updateFilter('search', '')}
              />
              <Select size="sm" placeholder="All Status" selectedKeys={filters.status ? [filters.status] : []} onSelectionChange={(keys) => updateFilter('status', Array.from(keys)[0] || '')}>
                <SelectItem key="open">Open</SelectItem>
                <SelectItem key="draft">Draft</SelectItem>
                <SelectItem key="on-hold">On Hold</SelectItem>
                <SelectItem key="closed">Closed</SelectItem>
                <SelectItem key="cancelled">Cancelled</SelectItem>
              </Select>
              <Select size="sm" placeholder="All Departments" selectedKeys={filters.department ? [filters.department] : []} onSelectionChange={(keys) => updateFilter('department', Array.from(keys)[0] || '')}>
                {departments.map((dept) => <SelectItem key={dept._id}>{dept.name}</SelectItem>)}
              </Select>
              <Select size="sm" placeholder="Employment Type" selectedKeys={filters.employmentType ? [filters.employmentType] : []} onSelectionChange={(keys) => updateFilter('employmentType', Array.from(keys)[0] || '')}>
                <SelectItem key="full-time">Full-time</SelectItem>
                <SelectItem key="part-time">Part-time</SelectItem>
                <SelectItem key="contract">Contract</SelectItem>
                <SelectItem key="internship">Internship</SelectItem>
              </Select>
            </div>
          </CardBody>
        </Card>

        {/* Job Listings */}
        {jobs.length === 0 ? (
          <Card shadow="sm">
            <CardBody className="p-8 sm:p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-default-100 flex items-center justify-center mx-auto mb-4">
                <FaBriefcase className="w-7 h-7 text-default-400" />
              </div>
              <h3 className="text-lg font-semibold text-default-700 mb-1">No job postings found</h3>
              <p className="text-sm text-default-500 mb-4 max-w-md mx-auto">
                {filters.search || filters.status || filters.department || filters.employmentType
                  ? 'Try adjusting your filters to see more results'
                  : 'Create your first job posting to start recruiting talent'}
              </p>
              {canManage && (
                <Button color="primary" size="sm" onPress={() => router.push('/dashboard/recruitment/create')} startContent={<FaPlus className="w-3.5 h-3.5" />}>
                  Create Job
                </Button>
              )}
            </CardBody>
          </Card>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block">
              <Card shadow="sm">
                <CardBody className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-default-50 border-b border-default-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Job</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Department</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Type</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Location</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-default-500 uppercase tracking-wider">Candidates</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-default-500 uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-default-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-content1 divide-y divide-default-100">
                        {jobs.map((job) => (
                          <tr key={job._id} className="hover:bg-default-50 cursor-pointer transition-colors" onClick={() => router.push(`/dashboard/recruitment/${job._id}`)}>
                            <td className="px-4 py-3.5">
                              <p className="text-sm font-semibold text-default-800">{job.jobTitle}</p>
                              {job.jobCode && <p className="text-xs text-default-400 mt-0.5">{job.jobCode}</p>}
                            </td>
                            <td className="px-4 py-3.5 text-sm text-default-600">{job.department?.name || '-'}</td>
                            <td className="px-4 py-3.5 text-sm text-default-600">{EMPLOYMENT_TYPE_LABELS[job.employmentType] || job.employmentType}</td>
                            <td className="px-4 py-3.5 text-sm text-default-600">{job.location || '-'}</td>
                            <td className="px-4 py-3.5 text-center text-sm font-medium text-default-800">{job.candidateCount ?? 0}</td>
                            <td className="px-4 py-3.5 text-center">
                              <Chip size="sm" variant="flat" color={STATUS_COLOR_MAP[job.status] || 'default'} className="capitalize">{job.status}</Chip>
                            </td>
                            <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <Tooltip content="View Details">
                                  <Button size="sm" isIconOnly variant="light" onPress={() => router.push(`/dashboard/recruitment/${job._id}`)}>
                                    <FaEye className="w-3.5 h-3.5 text-default-500" />
                                  </Button>
                                </Tooltip>
                                {canManage && (
                                  <Tooltip content="Edit">
                                    <Button size="sm" isIconOnly variant="light" onPress={() => router.push(`/dashboard/recruitment/edit/${job._id}`)}>
                                      <FaEdit className="w-3.5 h-3.5 text-default-500" />
                                    </Button>
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* Mobile Card View */}
            <div className="block md:hidden space-y-3">
              {jobs.map((job) => (
                <Card key={job._id} shadow="sm" isPressable onPress={() => router.push(`/dashboard/recruitment/${job._id}`)} className="w-full">
                  <CardBody className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-default-800 truncate">{job.jobTitle}</h3>
                        {job.jobCode && <p className="text-xs text-default-400">{job.jobCode}</p>}
                      </div>
                      <Chip size="sm" variant="flat" color={STATUS_COLOR_MAP[job.status] || 'default'} className="capitalize flex-shrink-0">{job.status}</Chip>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-default-500">
                      {job.department?.name && (
                        <span className="flex items-center gap-1"><FaBriefcase className="w-3 h-3 text-default-400" />{job.department.name}</span>
                      )}
                      {job.location && (
                        <span className="flex items-center gap-1"><FaMapMarkerAlt className="w-3 h-3 text-default-400" />{job.location}</span>
                      )}
                      <span className="flex items-center gap-1"><FaClock className="w-3 h-3 text-default-400" />{EMPLOYMENT_TYPE_LABELS[job.employmentType] || job.employmentType}</span>
                      <span className="flex items-center gap-1"><FaUsers className="w-3 h-3 text-default-400" />{job.candidateCount ?? 0} candidates</span>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex justify-center py-2">
            <Pagination total={pagination.pages} page={filters.page} onChange={(p) => updateFilter('page', p)} size="sm" showControls />
          </div>
        )}
      </div>
    </div>
  );
}
