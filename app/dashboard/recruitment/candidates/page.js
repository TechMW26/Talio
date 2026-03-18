'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button, Chip, Input, Select, SelectItem, Pagination, Tooltip,
  Card, CardBody, CardHeader, Skeleton
} from '@heroui/react';
import toast from '@/utils/toast';
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext';
import useAuthedSWR from '@/hooks/useAuthedSWR';
import { DataErrorState } from '@/components/ui/ErrorBoundary';
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator';
import {
  FaSearch, FaUsers, FaFilter, FaUserPlus, FaChevronRight,
  FaStar, FaEnvelope, FaPhone, FaBriefcase, FaArrowLeft
} from 'react-icons/fa';

const STAGES = [
  'applied', 'screening', 'shortlisted', 'interview',
  'assessment', 'offer', 'hired', 'rejected', 'withdrawn',
];

const STAGE_COLOR = {
  applied: 'primary', screening: 'secondary', shortlisted: 'warning',
  interview: 'primary', assessment: 'secondary', offer: 'success',
  hired: 'success', rejected: 'danger', withdrawn: 'default',
};

const SOURCES = [
  'website', 'linkedin', 'referral', 'naukri', 'indeed', 'agency', 'other',
];

export default function CandidatesPage() {
  const router = useRouter();
  const [filters, setFilters] = useState({
    search: '', stage: '', source: '', jobPosting: '', page: 1,
  });
  const [viewMode, setViewMode] = useState('list');

  const { socket, isConnected, subscribe } = useSocket();

  // --- SWR: Dynamic key for candidates based on filters ---
  const candidatesKey = useMemo(() => {
    const params = new URLSearchParams({ page: filters.page, limit: 20 });
    if (filters.search) params.set('search', filters.search);
    if (filters.stage) params.set('stage', filters.stage);
    if (filters.source) params.set('source', filters.source);
    if (filters.jobPosting) params.set('jobPosting', filters.jobPosting);
    return `/api/recruitment/candidates?${params}`;
  }, [filters]);

  const { data: candidatesResponse, error: candidatesError, isLoading, isValidating, mutate: refreshCandidates } = useAuthedSWR(candidatesKey);
  const candidates = candidatesResponse?.data || [];
  const pagination = candidatesResponse?.pagination || { total: candidates.length, pages: 1 };

  // --- SWR: Jobs (static) ---
  const { data: jobsResponse } = useAuthedSWR('/api/recruitment?limit=100&status=open');
  const jobs = jobsResponse?.data || [];

  // --- Socket: auto-refresh on real-time events ---
  useEffect(() => {
    if (!socket || !isConnected) return;
    const unsub = subscribe?.(REALTIME_EVENTS.RECRUITMENT_CANDIDATE_STAGE_CHANGED, () => refreshCandidates());
    return () => unsub?.();
  }, [socket, isConnected]);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: key === 'page' ? value : 1 }));
  };

  // Group candidates by stage for pipeline view
  const groupedByStage = STAGES.reduce((acc, stage) => {
    acc[stage] = candidates.filter((c) => c.stage === stage);
    return acc;
  }, {});

  // --- Error state ---
  if (candidatesError) {
    return (
      <div className="page-container">
        <DataErrorState
          title="Failed to load candidates"
          message={candidatesError.message}
          onRetry={() => refreshCandidates()}
        />
      </div>
    );
  }

  if (isLoading && candidates.length === 0) {
    return (
      <div className="page-container">
        <div className="space-y-4 sm:space-y-6">
          <div className="flex md:justify-between md:items-center md:flex-row flex-col">
            <Skeleton className="h-10 w-44 rounded-lg" />
            <Skeleton className="h-10 w-48 rounded-lg mt-3 md:mt-0" />
          </div>
          <Skeleton className="h-16 rounded-xl" />
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex md:justify-between md:items-center md:flex-row flex-col gap-4">
          <div className="flex items-center gap-3">
            <Button isIconOnly variant="light" size="sm" onPress={() => router.push('/dashboard/recruitment')}>
              <FaArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-default-800">Candidates</h1>
              <p className="text-sm text-default-500 mt-0.5">
                Manage all candidates across job postings
                <BackgroundRefreshIndicator isValidating={isValidating} />
              </p>
            </div>
          </div>
          <div className="flex gap-2 ml-10 md:ml-0">
            <Card shadow="sm" className="p-0.5">
              <CardBody className="p-0 flex flex-row">
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${viewMode === 'list' ? 'bg-primary text-white shadow-sm' : 'text-default-500 hover:text-default-700'
                    }`}
                >
                  List
                </button>
                <button
                  onClick={() => setViewMode('pipeline')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${viewMode === 'pipeline' ? 'bg-primary text-white shadow-sm' : 'text-default-500 hover:text-default-700'
                    }`}
                >
                  Pipeline
                </button>
              </CardBody>
            </Card>
          </div>
        </div>

        {/* Filters */}
        <Card shadow="sm">
          <CardBody className="p-3 sm:p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Input
                size="sm" placeholder="Search candidates..."
                value={filters.search}
                onValueChange={(v) => updateFilter('search', v)}
                startContent={<FaSearch className="w-3 h-3 text-default-400" />}
                isClearable onClear={() => updateFilter('search', '')}
              />
              <Select size="sm" placeholder="All Stages"
                selectedKeys={filters.stage ? [filters.stage] : []}
                onSelectionChange={(keys) => updateFilter('stage', Array.from(keys)[0] || '')}
              >
                {STAGES.map((s) => (
                  <SelectItem key={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                ))}
              </Select>
              <Select size="sm" placeholder="All Sources"
                selectedKeys={filters.source ? [filters.source] : []}
                onSelectionChange={(keys) => updateFilter('source', Array.from(keys)[0] || '')}
              >
                {SOURCES.map((s) => (
                  <SelectItem key={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                ))}
              </Select>
              <Select size="sm" placeholder="All Jobs"
                selectedKeys={filters.jobPosting ? [filters.jobPosting] : []}
                onSelectionChange={(keys) => updateFilter('jobPosting', Array.from(keys)[0] || '')}
              >
                {jobs.map((j) => (
                  <SelectItem key={j._id}>{j.jobTitle}</SelectItem>
                ))}
              </Select>
            </div>
          </CardBody>
        </Card>

        {/* Pipeline View */}
        {viewMode === 'pipeline' ? (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 min-w-[1200px]">
              {STAGES.filter((s) => s !== 'withdrawn').map((stage) => (
                <div key={stage} className="flex-1 min-w-[200px]">
                  <Card shadow="sm" className="bg-default-50">
                    <CardBody className="p-3">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-default-700 capitalize">{stage}</h3>
                        <Chip size="sm" variant="flat" color={STAGE_COLOR[stage]}>
                          {groupedByStage[stage]?.length || 0}
                        </Chip>
                      </div>
                      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                        {(groupedByStage[stage] || []).map((candidate) => (
                          <Card
                            key={candidate._id}
                            shadow="sm"
                            isPressable
                            onPress={() => router.push(`/dashboard/recruitment/candidates/${candidate._id}`)}
                            className="w-full"
                          >
                            <CardBody className="p-3">
                              <p className="text-sm font-medium text-default-800 truncate">
                                {candidate.firstName} {candidate.lastName}
                              </p>
                              <p className="text-xs text-default-400 truncate mt-0.5">{candidate.email}</p>
                              {candidate.currentCompany && (
                                <p className="text-xs text-default-500 mt-1">
                                  <FaBriefcase className="inline w-3 h-3 mr-1" />
                                  {candidate.currentCompany}
                                </p>
                              )}
                              <div className="flex items-center justify-between mt-2">
                                {candidate.rating ? (
                                  <span className="text-xs text-warning">
                                    <FaStar className="inline w-3 h-3 mr-0.5" />
                                    {candidate.rating}
                                  </span>
                                ) : <span />}
                                <span className="text-[10px] text-default-400">
                                  {candidate.jobPosting?.jobTitle?.substring(0, 20) || ''}
                                </span>
                              </div>
                            </CardBody>
                          </Card>
                        ))}
                        {(groupedByStage[stage] || []).length === 0 && (
                          <p className="text-xs text-default-400 text-center py-4">No candidates</p>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* List View */
          <>
            {candidates.length === 0 ? (
              <Card shadow="sm">
                <CardBody className="p-8 sm:p-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-default-100 flex items-center justify-center mx-auto mb-4">
                    <FaUsers className="w-7 h-7 text-default-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-default-700 mb-1">No candidates found</h3>
                  <p className="text-sm text-default-500">
                    {filters.search || filters.stage || filters.source || filters.jobPosting
                      ? 'Try adjusting your filters'
                      : 'Candidates will appear here once added to job postings'}
                  </p>
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
                              <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Candidate</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Job</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Source</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-default-500 uppercase tracking-wider">Experience</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-default-500 uppercase tracking-wider">Rating</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-default-500 uppercase tracking-wider">Stage</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-default-500 uppercase tracking-wider">Applied</th>
                            </tr>
                          </thead>
                          <tbody className="bg-content1 divide-y divide-default-100">
                            {candidates.map((candidate) => (
                              <tr
                                key={candidate._id}
                                onClick={() => router.push(`/dashboard/recruitment/candidates/${candidate._id}`)}
                                className="hover:bg-default-50 cursor-pointer transition-colors"
                              >
                                <td className="px-4 py-3.5">
                                  <p className="text-sm font-medium text-default-800">{candidate.firstName} {candidate.lastName}</p>
                                  <p className="text-xs text-default-400">{candidate.email}</p>
                                </td>
                                <td className="px-4 py-3.5">
                                  <p className="text-sm text-default-600 truncate max-w-[200px]">{candidate.jobPosting?.jobTitle || '-'}</p>
                                </td>
                                <td className="px-4 py-3.5">
                                  <Chip size="sm" variant="flat" className="capitalize">{candidate.source || '-'}</Chip>
                                </td>
                                <td className="px-4 py-3.5 text-center">
                                  <span className="text-sm text-default-600">
                                    {candidate.totalExperience ? `${candidate.totalExperience} yr` : '-'}
                                  </span>
                                </td>
                                <td className="px-4 py-3.5 text-center">
                                  {candidate.rating ? (
                                    <span className="text-sm text-warning">
                                      <FaStar className="inline w-3 h-3 mr-0.5" />
                                      {candidate.rating}
                                    </span>
                                  ) : (
                                    <span className="text-sm text-default-400">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 text-center">
                                  <Chip size="sm" variant="flat" color={STAGE_COLOR[candidate.stage]} className="capitalize">{candidate.stage}</Chip>
                                </td>
                                <td className="px-4 py-3.5 text-right">
                                  <span className="text-xs text-default-400">
                                    {candidate.createdAt ? new Date(candidate.createdAt).toLocaleDateString() : '-'}
                                  </span>
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
                  {candidates.map((candidate) => (
                    <Card key={candidate._id} shadow="sm" isPressable onPress={() => router.push(`/dashboard/recruitment/candidates/${candidate._id}`)} className="w-full">
                      <CardBody className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-default-800 truncate">{candidate.firstName} {candidate.lastName}</p>
                            <p className="text-xs text-default-400">{candidate.email}</p>
                          </div>
                          <Chip size="sm" variant="flat" color={STAGE_COLOR[candidate.stage]} className="capitalize flex-shrink-0">{candidate.stage}</Chip>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-default-500 mt-1">
                          {candidate.jobPosting?.jobTitle && (
                            <span className="flex items-center gap-1 truncate"><FaBriefcase className="w-3 h-3 text-default-400 flex-shrink-0" />{candidate.jobPosting.jobTitle}</span>
                          )}
                          {candidate.totalExperience && (
                            <span>{candidate.totalExperience} yr experience</span>
                          )}
                          {candidate.rating && (
                            <span className="text-warning"><FaStar className="inline w-3 h-3 mr-0.5" />{candidate.rating}/5</span>
                          )}
                          {candidate.source && (
                            <span className="capitalize">{candidate.source}</span>
                          )}
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
          </>
        )}
      </div>
    </div>
  );
}
