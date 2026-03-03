'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Button, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Input, Select, SelectItem, useDisclosure, Divider, Card, CardBody,
  CardHeader, Skeleton, Tooltip
} from '@heroui/react';
import toast from '@/utils/toast';
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext';
import useAuthedSWR from '@/hooks/useAuthedSWR';
import useApiMutation from '@/hooks/useApiMutation';
import LoadingButton from '@/components/ui/LoadingButton';
import { DataErrorState } from '@/components/ui/ErrorBoundary';
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator';
import {
  FaArrowLeft, FaEdit, FaTrash, FaBriefcase, FaMapMarkerAlt, FaClock,
  FaDollarSign, FaUsers, FaUserPlus, FaGraduationCap, FaCalendarAlt,
  FaCheckCircle, FaChartBar, FaStar, FaBuilding, FaLaptop
} from 'react-icons/fa';

const STATUS_COLORS = {
  open: 'success', draft: 'default', 'on-hold': 'warning', closed: 'danger', cancelled: 'danger',
};

const STAGE_COLORS = {
  applied: 'default', screening: 'primary', shortlisted: 'secondary',
  interview: 'warning', assessment: 'primary', offer: 'success', hired: 'success',
  rejected: 'danger', withdrawn: 'default',
};

const STAGE_LIST = ['applied', 'screening', 'shortlisted', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn'];
const WORK_MODE_LABELS = { 'on-site': 'On-site', remote: 'Remote', hybrid: 'Hybrid' };
const EMPLOYMENT_TYPE_LABELS = {
  'full-time': 'Full-time', 'part-time': 'Part-time', contract: 'Contract',
  internship: 'Internship', freelance: 'Freelance',
};

export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams();

  const { isOpen: isAddOpen, onOpen: onAddOpen, onClose: onAddClose } = useDisclosure();
  const [candidateForm, setCandidateForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    source: 'direct', experience: '', currentCompany: '',
    expectedSalary: '', skills: '',
  });

  const { socket, isConnected, subscribe } = useSocket();

  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  }, []);

  const { data: res, error, isLoading, isValidating, mutate: refresh } = useAuthedSWR(params.id ? `/api/recruitment/${params.id}` : null);
  const job = res?.data || null;

  useEffect(() => {
    if (!socket || !isConnected) return;
    const unsub = subscribe ? subscribe(REALTIME_EVENTS.RECRUITMENT_UPDATE, () => refresh()) : undefined;
    return () => { if (unsub) unsub(); };
  }, [socket, isConnected]);

  const canManage = user && ['admin', 'hr', 'manager'].includes(user.role);

  const deleteMutation = useApiMutation({
    method: 'DELETE',
    onSuccess: () => { toast.success('Job posting deleted'); router.push('/dashboard/recruitment'); },
    onError: (msg) => toast.error(msg || 'Failed to delete job posting'),
  });

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this job posting? This will also remove all associated candidates and interviews.')) return;
    await deleteMutation.execute(`/api/recruitment/${params.id}`);
  };

  const statusMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: [`/api/recruitment/${params.id}`],
    onSuccess: () => toast.success('Status updated'),
    onError: (msg) => toast.error(msg || 'Failed to update status'),
  });

  const handleStatusChange = async (newStatus) => {
    await statusMutation.execute(`/api/recruitment/${params.id}`, { status: newStatus });
  };

  const addCandidateMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: [`/api/recruitment/${params.id}`],
    onSuccess: () => {
      toast.success('Candidate added successfully');
      onAddClose();
      setCandidateForm({ firstName: '', lastName: '', email: '', phone: '', source: 'direct', experience: '', currentCompany: '', expectedSalary: '', skills: '' });
    },
    onError: (msg) => toast.error(msg || 'Failed to add candidate'),
  });

  const handleAddCandidate = async () => {
    if (!candidateForm.firstName || !candidateForm.lastName || !candidateForm.email) {
      toast.error('First name, last name, and email are required');
      return;
    }
    const payload = {
      ...candidateForm,
      jobPosting: params.id,
      experience: candidateForm.experience ? parseFloat(candidateForm.experience) : undefined,
      expectedSalary: candidateForm.expectedSalary ? parseFloat(candidateForm.expectedSalary) : undefined,
      skills: candidateForm.skills ? candidateForm.skills.split(',').map((s) => s.trim()).filter(Boolean) : [],
    };
    await addCandidateMutation.execute('/api/recruitment/candidates', payload);
  };

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="space-y-4 sm:space-y-6">
          <Skeleton className="h-10 w-64 rounded-lg" />
          <Skeleton className="h-6 w-96 rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <DataErrorState message="Failed to load job details" onRetry={() => refresh()} />
      </div>
    );
  }

  if (!job) return null;

  const formatSalary = (range) => {
    if (!range || (!range.min && !range.max)) return null;
    const currency = range.currency || 'INR';
    const fmt = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
    if (range.min && range.max) return `${fmt(range.min)} - ${fmt(range.max)}`;
    if (range.min) return `${fmt(range.min)}+`;
    return `Up to ${fmt(range.max)}`;
  };

  return (
    <div className="page-container">
      <div className="space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex md:justify-between md:items-start md:flex-row flex-col gap-4">
          <div className="flex items-start gap-3">
            <Button isIconOnly variant="light" size="sm" onPress={() => router.push('/dashboard/recruitment')} className="mt-0.5">
              <FaArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-default-800">{job.jobTitle}</h1>
                <Chip size="sm" variant="flat" color={STATUS_COLORS[job.status] || 'default'} className="capitalize">
                  {job.status}
                </Chip>
                {job.jobCode && <Chip size="sm" variant="bordered" className="text-default-500">{job.jobCode}</Chip>}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-default-500">
                {job.department?.name && (
                  <span className="flex items-center gap-1.5"><FaBuilding className="w-3 h-3 text-default-400" />{job.department.name}</span>
                )}
                {job.location && (
                  <span className="flex items-center gap-1.5"><FaMapMarkerAlt className="w-3 h-3 text-default-400" />{job.location}</span>
                )}
                <span className="flex items-center gap-1.5">
                  <FaClock className="w-3 h-3 text-default-400" />{EMPLOYMENT_TYPE_LABELS[job.employmentType] || job.employmentType}
                </span>
                {job.workMode && (
                  <span className="flex items-center gap-1.5"><FaLaptop className="w-3 h-3 text-default-400" />{WORK_MODE_LABELS[job.workMode] || job.workMode}</span>
                )}
              </div>
            </div>
          </div>
          {canManage && (
            <div className="flex items-center gap-2 ml-10 md:ml-0">
              <Button size="sm" color="primary" variant="flat" onPress={onAddOpen} startContent={<FaUserPlus className="w-3.5 h-3.5" />}>
                Add Candidate
              </Button>
              <Tooltip content="Edit">
                <Button size="sm" isIconOnly variant="flat" onPress={() => router.push(`/dashboard/recruitment/edit/${params.id}`)}>
                  <FaEdit className="w-3.5 h-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="Delete">
                <Button size="sm" isIconOnly variant="flat" color="danger" onPress={handleDelete} isLoading={deleteMutation.isLoading}>
                  <FaTrash className="w-3.5 h-3.5" />
                </Button>
              </Tooltip>
            </div>
          )}
        </div>
        <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Main Content — 2/3 */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* Pipeline Stats */}
            {job.pipeline && Object.keys(job.pipeline).length > 0 && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
                  <div className="flex items-center gap-2">
                    <FaChartBar className="w-4 h-4 text-primary" />
                    <h2 className="text-base font-semibold text-default-800">Candidate Pipeline</h2>
                    <Chip size="sm" variant="flat" color="primary">{job.candidateCount || 0} total</Chip>
                  </div>
                </CardHeader>
                <CardBody className="p-4 sm:p-5">
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
                    {STAGE_LIST.map((stage) => {
                      const count = job.pipeline[stage] || 0;
                      if (count === 0 && !['applied', 'screening', 'interview', 'offer', 'hired'].includes(stage)) return null;
                      return (
                        <div key={stage} className="text-center p-2 sm:p-3 rounded-lg bg-default-50">
                          <p className="text-lg sm:text-xl font-bold text-default-800">{count}</p>
                          <Chip size="sm" variant="flat" color={STAGE_COLORS[stage]} className="capitalize mt-1">{stage}</Chip>
                        </div>
                      );
                    })}
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Description */}
            {job.jobDescription && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
                  <h2 className="text-base font-semibold text-default-800">Job Description</h2>
                </CardHeader>
                <CardBody className="p-4 sm:p-5">
                  <p className="text-sm text-default-600 whitespace-pre-wrap leading-relaxed">{job.jobDescription}</p>
                </CardBody>
              </Card>
            )}

            {/* Requirements & Responsibilities — side by side on desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              {job.requirements?.length > 0 && (
                <Card shadow="sm">
                  <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
                    <h2 className="text-base font-semibold text-default-800">Requirements</h2>
                  </CardHeader>
                  <CardBody className="p-4 sm:p-5">
                    <ul className="space-y-2">
                      {job.requirements.map((req, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-default-600">
                          <FaCheckCircle className="w-3.5 h-3.5 text-success mt-0.5 flex-shrink-0" />
                          {req}
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}

              {job.responsibilities?.length > 0 && (
                <Card shadow="sm">
                  <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3">
                    <h2 className="text-base font-semibold text-default-800">Responsibilities</h2>
                  </CardHeader>
                  <CardBody className="p-4 sm:p-5">
                    <ul className="space-y-2">
                      {job.responsibilities.map((resp, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-default-600">
                          <FaCheckCircle className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
                          {resp}
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}
            </div>

            {/* Recent Candidates */}
            {job.recentCandidates?.length > 0 && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 sm:px-5 py-3 flex justify-between items-center">
                  <h2 className="text-base font-semibold text-default-800">Recent Candidates</h2>
                  <Button size="sm" variant="light" color="primary" onPress={() => router.push(`/dashboard/recruitment/candidates?jobPosting=${params.id}`)}>
                    View All
                  </Button>
                </CardHeader>
                <CardBody className="p-0">
                  <div className="divide-y divide-default-100">
                    {job.recentCandidates.map((candidate) => (
                      <div
                        key={candidate._id}
                        className="flex items-center justify-between px-4 sm:px-5 py-3 hover:bg-default-50 cursor-pointer transition-colors"
                        onClick={() => router.push(`/dashboard/recruitment/candidates/${candidate._id}`)}
                      >
                        <div>
                          <p className="text-sm font-medium text-default-800">{candidate.firstName} {candidate.lastName}</p>
                          <p className="text-xs text-default-400">{candidate.email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {candidate.rating > 0 && (
                            <span className="flex items-center gap-1 text-xs text-warning">
                              <FaStar className="w-3 h-3" /> {candidate.rating}
                            </span>
                          )}
                          <Chip size="sm" variant="flat" color={STAGE_COLORS[candidate.stage]} className="capitalize">{candidate.stage}</Chip>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}
          </div>

          {/* Sidebar — 1/3 */}
          <div className="space-y-4 sm:space-y-6">
            {/* Status Actions */}
            {canManage && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-default-700">Status Actions</h3>
                </CardHeader>
                <CardBody className="p-4">
                  <div className="flex flex-wrap gap-2">
                    {job.status === 'draft' && (
                      <Button size="sm" color="success" variant="flat" onPress={() => handleStatusChange('open')}>Publish</Button>
                    )}
                    {job.status === 'open' && (
                      <>
                        <Button size="sm" color="warning" variant="flat" onPress={() => handleStatusChange('on-hold')}>Put on Hold</Button>
                        <Button size="sm" color="danger" variant="flat" onPress={() => handleStatusChange('closed')}>Close</Button>
                      </>
                    )}
                    {(job.status === 'on-hold' || job.status === 'closed') && (
                      <Button size="sm" color="success" variant="flat" onPress={() => handleStatusChange('open')}>Reopen</Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Job Information */}
            <Card shadow="sm">
              <CardHeader className="border-b border-default-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-default-700">Job Information</h3>
              </CardHeader>
              <CardBody className="p-4 space-y-3">
                {job.numberOfPositions > 0 && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <FaUsers className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-500">Positions:</span>
                    <span className="font-medium text-default-800 ml-auto">{job.numberOfPositions}</span>
                  </div>
                )}
                {job.experience && (job.experience.min || job.experience.max) && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <FaBriefcase className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-500">Experience:</span>
                    <span className="font-medium text-default-800 ml-auto">{job.experience.min || 0} - {job.experience.max || 0} years</span>
                  </div>
                )}
                {formatSalary(job.salaryRange) && !job.salaryRange?.isConfidential && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <FaDollarSign className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-500">Salary:</span>
                    <span className="font-medium text-default-800 ml-auto">{formatSalary(job.salaryRange)}</span>
                  </div>
                )}
                {job.educationLevel && job.educationLevel !== 'any' && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <FaGraduationCap className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-500">Education:</span>
                    <span className="font-medium text-default-800 ml-auto capitalize">{job.educationLevel}</span>
                  </div>
                )}
                {job.applicationDeadline && (
                  <div className="flex items-center gap-2.5 text-sm">
                    <FaCalendarAlt className="w-3.5 h-3.5 text-default-400 flex-shrink-0" />
                    <span className="text-default-500">Deadline:</span>
                    <span className="font-medium text-default-800 ml-auto">{new Date(job.applicationDeadline).toLocaleDateString()}</span>
                  </div>
                )}
                <Divider />
                {job.hiringManager && (
                  <div className="text-sm">
                    <span className="text-default-500">Hiring Manager</span>
                    <p className="font-medium text-default-800">{job.hiringManager.firstName} {job.hiringManager.lastName}</p>
                  </div>
                )}
                {job.createdBy && (
                  <div className="text-sm">
                    <span className="text-default-500">Created by</span>
                    <p className="font-medium text-default-800">{job.createdBy.firstName} {job.createdBy.lastName}</p>
                  </div>
                )}
                <div className="text-sm">
                  <span className="text-default-500">Created</span>
                  <p className="font-medium text-default-800">{new Date(job.createdAt).toLocaleDateString()}</p>
                </div>
              </CardBody>
            </Card>

            {/* Skills */}
            {job.skills?.length > 0 && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-default-700">Required Skills</h3>
                </CardHeader>
                <CardBody className="p-4">
                  <div className="flex flex-wrap gap-1.5">
                    {job.skills.map((skill, i) => (
                      <Chip key={i} size="sm" variant="flat" color="primary">{skill}</Chip>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Benefits */}
            {job.benefits?.length > 0 && (
              <Card shadow="sm">
                <CardHeader className="border-b border-default-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-default-700">Benefits</h3>
                </CardHeader>
                <CardBody className="p-4">
                  <ul className="space-y-1.5">
                    {job.benefits.map((benefit, i) => (
                      <li key={i} className="text-sm text-default-600 flex items-start gap-2">
                        <FaCheckCircle className="w-3 h-3 text-success mt-0.5 flex-shrink-0" />
                        {benefit}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}

            {/* Quick Links */}
            <Card shadow="sm">
              <CardHeader className="border-b border-default-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-default-700">Quick Links</h3>
              </CardHeader>
              <CardBody className="p-4 space-y-2">
                <Button size="sm" variant="flat" fullWidth onPress={() => router.push(`/dashboard/recruitment/candidates?jobPosting=${params.id}`)} startContent={<FaUsers className="w-3.5 h-3.5" />}>
                  View Candidates ({job.candidateCount || 0})
                </Button>
                <Button size="sm" variant="flat" fullWidth onPress={() => router.push('/dashboard/recruitment/interviews')} startContent={<FaCalendarAlt className="w-3.5 h-3.5" />}>
                  View Interviews
                </Button>
              </CardBody>
            </Card>
          </div>
        </div>

        {/* Add Candidate Modal */}
        <Modal isOpen={isAddOpen} onClose={onAddClose} size="2xl">
          <ModalContent>
            <ModalHeader>Add Candidate to {job.jobTitle}</ModalHeader>
            <ModalBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="First Name" isRequired size="sm" value={candidateForm.firstName} onValueChange={(v) => setCandidateForm((p) => ({ ...p, firstName: v }))} />
                <Input label="Last Name" isRequired size="sm" value={candidateForm.lastName} onValueChange={(v) => setCandidateForm((p) => ({ ...p, lastName: v }))} />
                <Input label="Email" type="email" isRequired size="sm" value={candidateForm.email} onValueChange={(v) => setCandidateForm((p) => ({ ...p, email: v }))} />
                <Input label="Phone" size="sm" value={candidateForm.phone} onValueChange={(v) => setCandidateForm((p) => ({ ...p, phone: v }))} />
                <Select label="Source" size="sm" selectedKeys={[candidateForm.source]} onSelectionChange={(keys) => setCandidateForm((p) => ({ ...p, source: Array.from(keys)[0] }))}>
                  <SelectItem key="direct">Direct</SelectItem>
                  <SelectItem key="referral">Referral</SelectItem>
                  <SelectItem key="job-portal">Job Portal</SelectItem>
                  <SelectItem key="linkedin">LinkedIn</SelectItem>
                  <SelectItem key="career-page">Career Page</SelectItem>
                  <SelectItem key="recruitment-agency">Agency</SelectItem>
                  <SelectItem key="campus">Campus</SelectItem>
                  <SelectItem key="other">Other</SelectItem>
                </Select>
                <Input label="Experience (years)" type="number" size="sm" value={candidateForm.experience} onValueChange={(v) => setCandidateForm((p) => ({ ...p, experience: v }))} />
                <Input label="Current Company" size="sm" value={candidateForm.currentCompany} onValueChange={(v) => setCandidateForm((p) => ({ ...p, currentCompany: v }))} />
                <Input label="Expected Salary" type="number" size="sm" value={candidateForm.expectedSalary} onValueChange={(v) => setCandidateForm((p) => ({ ...p, expectedSalary: v }))} />
                <div className="sm:col-span-2">
                  <Input label="Skills (comma-separated)" size="sm" value={candidateForm.skills} onValueChange={(v) => setCandidateForm((p) => ({ ...p, skills: v }))} placeholder="React, Node.js, MongoDB..." />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onAddClose}>Cancel</Button>
              <Button color="primary" onPress={handleAddCandidate} isLoading={addCandidateMutation.isLoading}>Add Candidate</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    </div>
  );
}
