'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button, Chip, Input, Select, SelectItem, Pagination,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  useDisclosure, Textarea, Card, CardBody, CardHeader, Skeleton, Tooltip
} from '@heroui/react';
import toast from '@/utils/toast';
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext';
import useAuthedSWR from '@/hooks/useAuthedSWR';
import useApiMutation from '@/hooks/useApiMutation';
import LoadingButton from '@/components/ui/LoadingButton';
import { DataErrorState } from '@/components/ui/ErrorBoundary';
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator';
import {
  FaSearch, FaCalendarAlt, FaPlus, FaClock, FaUser, FaVideo,
  FaPhone, FaMapMarkerAlt, FaLink, FaFilter, FaStar, FaArrowLeft
} from 'react-icons/fa';

const STATUS_COLOR = {
  scheduled: 'primary', 'in-progress': 'warning',
  completed: 'success', cancelled: 'danger', 'no-show': 'default',
};

const TYPE_ICON = {
  phone: FaPhone, video: FaVideo, 'in-person': FaMapMarkerAlt,
  technical: FaClock, hr: FaUser, panel: FaUser, assignment: FaClock,
};

export default function InterviewsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState({ status: '', jobPosting: '', page: 1 });

  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } }, []);

  // Schedule modal
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [scheduleData, setScheduleData] = useState({
    candidate: '', jobPosting: '', type: 'video', title: '',
    scheduledDate: '', duration: 60, location: '', meetingLink: '',
    interviewers: [], notes: '',
  });
  // --- SWR: Candidates for selected job (conditional) ---
  const { data: candidatesRes } = useAuthedSWR(
    scheduleData.jobPosting ? `/api/recruitment/candidates?jobPosting=${scheduleData.jobPosting}&limit=100` : null
  );
  const candidates = candidatesRes?.data || [];

  // Feedback modal
  const { isOpen: isFeedbackOpen, onOpen: onFeedbackOpen, onClose: onFeedbackClose } = useDisclosure();
  const [selectedInterview, setSelectedInterview] = useState(null);
  const [feedback, setFeedback] = useState({
    rating: '', strengths: '', weaknesses: '', comments: '', recommendation: 'maybe',
  });

  const { socket, isConnected, subscribe } = useSocket();

  // --- SWR: Dynamic key for interviews based on filters ---
  const interviewsKey = useMemo(() => {
    const params = new URLSearchParams({ page: filters.page, limit: 20 });
    if (filters.status) params.set('status', filters.status);
    if (filters.jobPosting) params.set('jobPosting', filters.jobPosting);
    return `/api/recruitment/interviews?${params}`;
  }, [filters]);

  const { data: interviewsResponse, error: interviewsError, isLoading, isValidating, mutate: refreshInterviews } = useAuthedSWR(interviewsKey);
  const interviews = interviewsResponse?.data || [];
  const pagination = interviewsResponse?.pagination || { total: interviews.length, pages: 1 };

  // --- SWR: Jobs (static) ---
  const { data: jobsResponse } = useAuthedSWR('/api/recruitment?limit=100');
  const jobs = jobsResponse?.data || [];

  // --- SWR: Employees (static) ---
  const { data: employeesResponse } = useAuthedSWR('/api/employees?limit=1000');
  const employees = employeesResponse?.data || [];

  // --- Mutations ---
  const scheduleMutation = useApiMutation({
    invalidateKeys: [/^\/api\/recruitment\/interviews/],
    onSuccess: (data) => {
      toast.success('Interview scheduled successfully');
      onClose();
      setScheduleData({
        candidate: '', jobPosting: '', type: 'video', title: '',
        scheduledDate: '', duration: 60, location: '', meetingLink: '',
        interviewers: [], notes: '',
      });
    },
    onError: (msg) => toast.error(msg || 'Failed to schedule interview'),
  });

  const feedbackMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: [/^\/api\/recruitment\/interviews/],
    onSuccess: (data) => {
      toast.success('Feedback submitted');
      onFeedbackClose();
    },
    onError: (msg) => toast.error(msg || 'Failed to submit feedback'),
  });

  // --- Socket: auto-refresh on real-time events ---
  useEffect(() => {
    if (!socket || !isConnected) return;
    const unsub = subscribe?.(REALTIME_EVENTS.RECRUITMENT_INTERVIEW_UPDATED, () => refreshInterviews());
    return () => unsub?.();
  }, [socket, isConnected]);

  const canManage = user && ['admin', 'hr', 'manager'].includes(user.role);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: key === 'page' ? value : 1 }));
  };

  const handleSchedule = async () => {
    if (!scheduleData.candidate || !scheduleData.jobPosting || !scheduleData.scheduledDate) {
      toast.error('Candidate, job, and date are required');
      return;
    }
    if (scheduleData.interviewers.length === 0) {
      toast.error('At least one interviewer is required');
      return;
    }
    await scheduleMutation.execute('/api/recruitment/interviews', {
      ...scheduleData, duration: Number(scheduleData.duration),
    });
  };

  const handleFeedbackSubmit = async () => {
    if (!feedback.rating || feedback.rating < 1 || feedback.rating > 5) {
      toast.error('Rating (1-5) is required');
      return;
    }
    await feedbackMutation.execute(`/api/recruitment/interviews/${selectedInterview._id}`, {
      feedback: {
        rating: Number(feedback.rating),
        strengths: feedback.strengths,
        weaknesses: feedback.weaknesses,
        comments: feedback.comments,
        recommendation: feedback.recommendation,
      },
    });
  };

  const openFeedback = (interview) => {
    setSelectedInterview(interview);
    setFeedback({ rating: '', strengths: '', weaknesses: '', comments: '', recommendation: 'maybe' });
    onFeedbackOpen();
  };

  // Group by date
  const grouped = interviews.reduce((acc, interview) => {
    const date = new Date(interview.scheduledDate).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(interview);
    return acc;
  }, {});

  // --- Error state ---
  if (interviewsError) {
    return (
      <div className="page-container">
        <DataErrorState
          title="Failed to load interviews"
          message={interviewsError.message}
          onRetry={() => refreshInterviews()}
        />
      </div>
    );
  }

  if (isLoading && interviews.length === 0) {
    return (
      <div className="page-container">
        <div className="space-y-4 sm:space-y-6">
          <div className="flex md:justify-between md:items-center md:flex-row flex-col">
            <Skeleton className="h-10 w-44 rounded-lg" />
            <Skeleton className="h-10 w-40 rounded-lg mt-3 md:mt-0" />
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
        <div className="flex md:justify-between md:items-center md:flex-row flex-col gap-4">
          <div className="flex items-center gap-3">
            <Button isIconOnly variant="light" size="sm" onPress={() => router.push('/dashboard/recruitment')}>
              <FaArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-default-800">Interviews</h1>
              <p className="text-sm text-default-500 mt-0.5">
                Schedule and manage candidate interviews
                <BackgroundRefreshIndicator isValidating={isValidating} />
              </p>
            </div>
          </div>
          {canManage && (
            <Button color="primary" onPress={onOpen} startContent={<FaPlus className="w-3.5 h-3.5" />}>
              Schedule Interview
            </Button>
          )}
        </div>

        {/* Filters */}
        <Card shadow="sm">
          <CardBody className="p-3 sm:p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select size="sm" placeholder="All Status"
                selectedKeys={filters.status ? [filters.status] : []}
                onSelectionChange={(keys) => updateFilter('status', Array.from(keys)[0] || '')}
              >
                <SelectItem key="scheduled">Scheduled</SelectItem>
                <SelectItem key="in-progress">In Progress</SelectItem>
                <SelectItem key="completed">Completed</SelectItem>
                <SelectItem key="cancelled">Cancelled</SelectItem>
                <SelectItem key="no-show">No Show</SelectItem>
              </Select>
              <Select size="sm" placeholder="All Jobs"
                selectedKeys={filters.jobPosting ? [filters.jobPosting] : []}
                onSelectionChange={(keys) => updateFilter('jobPosting', Array.from(keys)[0] || '')}
              >
                {jobs.map((j) => (
                  <SelectItem key={j._id}>{j.jobTitle}</SelectItem>
                ))}
              </Select>
              <div className="flex items-center justify-end">
                <Chip size="sm" variant="flat" color="primary">{pagination.total} interviews</Chip>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Interview List grouped by date */}
        {Object.keys(grouped).length === 0 ? (
          <Card shadow="sm">
            <CardBody className="p-8 sm:p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-default-100 flex items-center justify-center mx-auto mb-4">
                <FaCalendarAlt className="w-7 h-7 text-default-400" />
              </div>
              <h3 className="text-lg font-semibold text-default-700 mb-1">No interviews found</h3>
              <p className="text-sm text-default-500">
                {filters.status || filters.jobPosting
                  ? 'Try adjusting your filters'
                  : 'Schedule an interview to get started'}
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([date, dateInterviews]) => (
              <div key={date}>
                <h3 className="text-sm font-semibold text-default-500 mb-3">{date}</h3>
                <div className="space-y-3">
                  {dateInterviews.map((interview) => {
                    const TypeIcon = TYPE_ICON[interview.type] || FaCalendarAlt;
                    return (
                      <Card key={interview._id} shadow="sm">
                        <CardBody className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex gap-3 flex-1 min-w-0">
                              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                                <TypeIcon className="w-4 h-4 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-default-800">
                                  {interview.title || `Round ${interview.round} Interview`}
                                </p>
                                <p className="text-xs text-default-500 mt-0.5">
                                  {interview.candidate?.firstName} {interview.candidate?.lastName}
                                  {interview.jobPosting?.jobTitle ? ` - ${interview.jobPosting.jobTitle}` : ''}
                                </p>
                                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-default-400">
                                  <span>
                                    <FaClock className="inline w-3 h-3 mr-0.5" />
                                    {new Date(interview.scheduledDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    {' '}({interview.duration} min)
                                  </span>
                                  <Chip size="sm" variant="flat" className="capitalize">{interview.type}</Chip>
                                  {interview.location && (
                                    <span><FaMapMarkerAlt className="inline w-3 h-3 mr-0.5" />{interview.location}</span>
                                  )}
                                  {interview.meetingLink && (
                                    <a href={interview.meetingLink} target="_blank" rel="noopener noreferrer"
                                      className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                                      <FaLink className="inline w-3 h-3 mr-0.5" /> Join
                                    </a>
                                  )}
                                </div>
                                {interview.interviewers?.length > 0 && (
                                  <div className="flex items-center gap-1 mt-2">
                                    <span className="text-xs text-default-400">Interviewers:</span>
                                    {interview.interviewers.map((iv, i) => (
                                      <span key={i} className="text-xs text-default-600">
                                        {iv.firstName} {iv.lastName}{i < interview.interviewers.length - 1 ? ',' : ''}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Chip size="sm" variant="flat" color={STATUS_COLOR[interview.status]}>
                                {interview.status}
                              </Chip>
                              {interview.status === 'scheduled' && (
                                <Button size="sm" variant="flat" color="primary" onPress={() => openFeedback(interview)}>
                                  Feedback
                                </Button>
                              )}
                              {interview.status === 'completed' && interview.feedback?.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <FaStar className="w-3 h-3 text-warning" />
                                  <span className="text-sm font-medium text-default-700">
                                    {(interview.feedback.reduce((s, f) => s + f.rating, 0) / interview.feedback.length).toFixed(1)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex justify-center py-2">
            <Pagination total={pagination.pages} page={filters.page} onChange={(p) => updateFilter('page', p)} size="sm" showControls />
          </div>
        )}

        {/* Schedule Interview Modal */}
        <Modal isOpen={isOpen} onClose={onClose} size="2xl">
          <ModalContent>
            <ModalHeader>Schedule Interview</ModalHeader>
            <ModalBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select label="Job Posting" isRequired
                  selectedKeys={scheduleData.jobPosting ? [scheduleData.jobPosting] : []}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] || '';
                    setScheduleData((prev) => ({ ...prev, jobPosting: val, candidate: '' }));
                  }}
                >
                  {jobs.map((j) => <SelectItem key={j._id}>{j.jobTitle}</SelectItem>)}
                </Select>
                <Select label="Candidate" isRequired
                  selectedKeys={scheduleData.candidate ? [scheduleData.candidate] : []}
                  onSelectionChange={(keys) => setScheduleData((prev) => ({ ...prev, candidate: Array.from(keys)[0] || '' }))}
                  isDisabled={!scheduleData.jobPosting}
                >
                  {candidates.map((c) => <SelectItem key={c._id}>{c.firstName} {c.lastName}</SelectItem>)}
                </Select>
                <Input label="Title" placeholder="e.g., Technical Interview Round 1"
                  value={scheduleData.title}
                  onValueChange={(v) => setScheduleData((prev) => ({ ...prev, title: v }))}
                />
                <Select label="Type"
                  selectedKeys={[scheduleData.type]}
                  onSelectionChange={(keys) => setScheduleData((prev) => ({ ...prev, type: Array.from(keys)[0] || 'video' }))}
                >
                  <SelectItem key="phone">Phone</SelectItem>
                  <SelectItem key="video">Video</SelectItem>
                  <SelectItem key="in-person">In Person</SelectItem>
                  <SelectItem key="technical">Technical</SelectItem>
                  <SelectItem key="hr">HR</SelectItem>
                  <SelectItem key="panel">Panel</SelectItem>
                  <SelectItem key="assignment">Assignment</SelectItem>
                </Select>
                <Input label="Date & Time" type="datetime-local" isRequired
                  value={scheduleData.scheduledDate}
                  onValueChange={(v) => setScheduleData((prev) => ({ ...prev, scheduledDate: v }))}
                />
                <Input label="Duration (minutes)" type="number" min={15}
                  value={String(scheduleData.duration)}
                  onValueChange={(v) => setScheduleData((prev) => ({ ...prev, duration: v }))}
                />
                <Input label="Location" placeholder="Office / Room name"
                  value={scheduleData.location}
                  onValueChange={(v) => setScheduleData((prev) => ({ ...prev, location: v }))}
                />
                <Input label="Meeting Link" placeholder="https://meet.google.com/..."
                  value={scheduleData.meetingLink}
                  onValueChange={(v) => setScheduleData((prev) => ({ ...prev, meetingLink: v }))}
                />
                <div className="sm:col-span-2">
                  <Select label="Interviewers" selectionMode="multiple" isRequired
                    selectedKeys={new Set(scheduleData.interviewers)}
                    onSelectionChange={(keys) => setScheduleData((prev) => ({ ...prev, interviewers: Array.from(keys) }))}
                  >
                    {employees.map((emp) => <SelectItem key={emp._id}>{emp.firstName} {emp.lastName}</SelectItem>)}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Textarea label="Notes" placeholder="Any additional notes..."
                    value={scheduleData.notes}
                    onValueChange={(v) => setScheduleData((prev) => ({ ...prev, notes: v }))}
                    minRows={2}
                  />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose}>Cancel</Button>
              <LoadingButton color="primary" isLoading={scheduleMutation.isLoading} loadingText="Scheduling..." onPress={handleSchedule}>Schedule Interview</LoadingButton>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* Feedback Modal */}
        <Modal isOpen={isFeedbackOpen} onClose={onFeedbackClose}>
          <ModalContent>
            <ModalHeader>Submit Feedback</ModalHeader>
            <ModalBody className="space-y-3">
              {selectedInterview && (
                <p className="text-sm text-default-500">
                  Feedback for {selectedInterview.candidate?.firstName} {selectedInterview.candidate?.lastName}
                </p>
              )}
              <Input label="Rating (1-5)" type="number" min={1} max={5} isRequired
                value={feedback.rating}
                onValueChange={(v) => setFeedback((prev) => ({ ...prev, rating: v }))}
              />
              <Textarea label="Strengths" placeholder="Candidate's strengths..."
                value={feedback.strengths}
                onValueChange={(v) => setFeedback((prev) => ({ ...prev, strengths: v }))}
              />
              <Textarea label="Weaknesses" placeholder="Areas of improvement..."
                value={feedback.weaknesses}
                onValueChange={(v) => setFeedback((prev) => ({ ...prev, weaknesses: v }))}
              />
              <Textarea label="Comments" placeholder="Additional comments..."
                value={feedback.comments}
                onValueChange={(v) => setFeedback((prev) => ({ ...prev, comments: v }))}
              />
              <Select label="Recommendation"
                selectedKeys={[feedback.recommendation]}
                onSelectionChange={(keys) => setFeedback((prev) => ({ ...prev, recommendation: Array.from(keys)[0] || 'maybe' }))}
              >
                <SelectItem key="strong-yes">Strong Yes</SelectItem>
                <SelectItem key="yes">Yes</SelectItem>
                <SelectItem key="maybe">Maybe</SelectItem>
                <SelectItem key="no">No</SelectItem>
                <SelectItem key="strong-no">Strong No</SelectItem>
              </Select>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onFeedbackClose}>Cancel</Button>
              <LoadingButton color="primary" isLoading={feedbackMutation.isLoading} loadingText="Submitting..." onPress={handleFeedbackSubmit}>Submit Feedback</LoadingButton>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    </div>
  );
}
